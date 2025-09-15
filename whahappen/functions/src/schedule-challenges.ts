// functions/src/schedule-challenges.ts
import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "./firebaseAdmin";
import { generateChallengeIdeas, OPENAI_SECRET } from "./ai";

/**
 * Ajustes clave:
 * - DocID de challenges = YYYYMMDD (compat con UI vieja)
 * - Campo key (ISO) = YYYY-MM-DD
 * - Incluye generatedAt, basedOn, signals
 * - Sanitiza '#' en instrucciones
 */

const TZ = "America/Matamoros";
const CATEGORIES = ["global", "caritativo", "picaro", "creativo", "rebelde", "troll", "chill"];

// ---------- helpers de tiempo ----------
function nowTZ() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
}
function startOfDayTZ(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDayTZ(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function keyIso(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function keyCompact(d: Date) {
  return keyIso(d).replace(/-/g, "");
}
function todayIso() {
  return keyIso(nowTZ());
}
function todayCompact() {
  return keyCompact(nowTZ());
}
function yesterdayCompact() {
  const y = nowTZ();
  y.setDate(y.getDate() - 1);
  return keyCompact(y);
}
function endOfTomorrowTS() {
  const z = nowTZ();
  z.setDate(z.getDate() + 1);
  return Timestamp.fromDate(endOfDayTZ(z));
}

// ---------- helpers de agregación ----------
type Subm = {
  uid?: string;
  authorId?: string;
  mode?: string;
  dateKey?: string; // esperamos YYYYMMDD
  status?: string;
  tags?: string[];
  style?: string;
  likesCount?: number;
  viewsCount?: number;
  repostsCount?: number;
  score?: number;
};

type CountMap = Map<string, number>;
const add = (m: CountMap, k: string, w: number) => {
  if (!k) return;
  m.set(k, (m.get(k) ?? 0) + w);
};
const topK = (m: CountMap, k = 5) =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([x]) => x);
const weight = (s: Subm) =>
  typeof s.score === "number"
    ? Math.max(1, s.score!)
    : 1 + (s.likesCount ?? 0) * 2 + (s.repostsCount ?? 0) * 3 + (s.viewsCount ?? 0) * 0.05;

async function collectSignals(dateKeyCompact: string) {
  const tagC: CountMap = new Map();
  const styC: CountMap = new Map();
  const modeC: CountMap = new Map();

  const qs = await db
    .collection("submissions")
    .where("dateKey", "==", dateKeyCompact) // ✅ compact
    .where("status", "==", "public")
    .limit(5000)
    .get();

  qs.forEach((doc) => {
    const s = doc.data() as Subm;
    const w = weight(s);
    (s.tags ?? []).forEach((t) => add(tagC, (t || "").toLowerCase(), w));
    if (s.style) add(styC, (s.style || "").toLowerCase(), w);
    if (s.mode) add(modeC, s.mode, w);
  });

  return {
    topTags: topK(tagC, 6),
    topStyles: topK(styC, 6),
    bestMode: topK(modeC, 1)[0] ?? "global",
  };
}

async function seedFromYesterday(prevCompact: string, mode: string) {
  const snap = await db.doc(`challenges/${prevCompact}`).get(); // ✅ compact
  if (!snap.exists) return null;
  const data = snap.data() as any;
  if (mode === "global") return data?.global?.instruction ?? null;
  return data?.categories?.[mode]?.instruction ?? null;
}

const stripHash = (s: string) => (s ? s.replace(/[#\uFF03]/g, "") : s);

// ---------- función programada ----------
export const ensureDailyChallenges = onSchedule(
  { schedule: "1 0 * * *", timeZone: TZ, secrets: [OPENAI_SECRET] },
  async () => {
    // Claves
    const keyISO = todayIso(); // e.g. 2025-09-15
    const keyCMP = todayCompact(); // e.g. 20250915

    // Si ya existe, no rehacer
    const ref = db.doc(`challenges/${keyCMP}`); // ✅ compact ID
    const exists = await ref.get();
    if (exists.exists) return;

    // Señales de ayer (o fallback 7 días)
    const prev = yesterdayCompact();
    let { topTags, topStyles, bestMode } = await collectSignals(prev);

    if (topTags.length === 0 && topStyles.length === 0) {
      const start = nowTZ(); // hoy
      const tagC: CountMap = new Map();
      const styC: CountMap = new Map();
      const modeC: CountMap = new Map();

      for (let i = 7; i >= 1; i--) {
        const d = new Date(start);
        d.setDate(d.getDate() - i);
        const k = keyCompact(d);
        const qs = await db
          .collection("submissions")
          .where("dateKey", "==", k)
          .where("status", "==", "public")
          .limit(2000)
          .get();
        qs.forEach((doc) => {
          const s = doc.data() as Subm;
          const w = weight(s);
          (s.tags ?? []).forEach((t) => add(tagC, (t || "").toLowerCase(), w));
          if (s.style) add(styC, (s.style || "").toLowerCase(), w);
          if (s.mode) add(modeC, s.mode, w);
        });
      }
      topTags = topK(tagC, 6);
      topStyles = topK(styC, 6);
      bestMode = topK(modeC, 1)[0] ?? "global";
    }

    // Semilla: mejor reto de ayer en el modo ganador
    const seedInstruction = await seedFromYesterday(prev, bestMode);

    // Pide ideas al modelo
    const ideas = await generateChallengeIdeas({
      seedInstruction,
      topTags,
      topStyles,
      wantCategories: CATEGORIES,
      preferCategory: bestMode,
    });

    // Construye documento con compatibilidad vieja + nueva
    const today = nowTZ();
    const windowStart = startOfDayTZ(new Date(today)); // hoy 00:00 (ajusta si quieres 7 días reales)
    windowStart.setDate(windowStart.getDate() - 7);
    const windowEnd = nowTZ();

    const doc: any = {
      // claves y tiempos
      key: keyISO,                 // ISO (nuevo)
      keyCompact: keyCMP,          // compacto (aux)
      generatedAt: Timestamp.now(),// ✅ compat viejo
      createdAt: Timestamp.now(),
      expiresAt: endOfTomorrowTS(),

      // compat viejo
      basedOn: {
        days: 7,
        windowStart: Timestamp.fromDate(windowStart),
        windowEnd: Timestamp.fromDate(windowEnd),
      },
      signals: {
        topTags,
        topStyles,
        bestMode,
        examples: [] as string[],
      },

      // instrucciones
      global: { instruction: stripHash(ideas["global"] ?? "Cuenta algo épico en 15s.") },
      categories: {},
    };

    for (const c of CATEGORIES.filter((c) => c !== "global")) {
      const line = ideas[c] ?? `Reto #${c}: sube tu take en <30s.`;
      doc.categories[c] = { instruction: stripHash(line) };
    }

    await ref.set(doc, { merge: false });
  }
);
