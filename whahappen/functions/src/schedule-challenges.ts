import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { db } from "./firebaseAdmin";
import { generateChallengeIdeas } from "./ai";

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

setGlobalOptions({
  region: "us-central1",
  secrets: [OPENAI_API_KEY],
});

type Subm = {
  dateKey?: string;
  mode?: string;              // "global" | "caritativo" | ...
  tags?: string[];            // ["duet","remix",...]
  style?: string;             // "humor" | "cinematico" | ...
  likesCount?: number;
  viewsCount?: number;
  repostsCount?: number;
  score?: number;             // si ya calculas un score, úsalo
  status?: string;            // "public" o similar
};

const TZ = "America/Matamoros";
const WANT_CATEGORIES = [
  "global", "caritativo", "picaro", "creativo", "rebelde", "troll", "chill",
];

function nowInTZ(tz: string): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
}
function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function todayKey(): string {
  return dayKey(nowInTZ(TZ));
}
function yesterdayKey(): string {
  const z = nowInTZ(TZ);
  z.setDate(z.getDate() - 1);
  return dayKey(z);
}
function endOfTomorrow(): Timestamp {
  const z = nowInTZ(TZ);
  z.setDate(z.getDate() + 1);
  z.setHours(23, 59, 59, 999);
  return Timestamp.fromDate(z);
}

// -------- helpers de agregación --------
type CountMap = Map<string, number>;

function add(counts: CountMap, key: string, w: number) {
  if (!key) return;
  counts.set(key, (counts.get(key) ?? 0) + w);
}

function sortTop(counts: CountMap, limit = 5): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k);
}

function weightFrom(sub: Subm): number {
  // Pondera engagement; ajusta a tu gusto.
  const likes = sub.likesCount ?? 0;
  const views = sub.viewsCount ?? 0;
  const reposts = sub.repostsCount ?? 0;
  const base = 1;
  // Si ya tienes un score calculado, priorízalo:
  if (typeof sub.score === "number") return Math.max(base, sub.score);
  return base + likes * 2 + reposts * 3 + views * 0.05;
}

async function fetchTopSignals(fromKey: string, lookbackDays = 0) {
  // Lee submissions de un día; si lookbackDays > 0, lee rango [fromKey - lookbackDays, fromKey]
  const tagCounts: CountMap = new Map();
  const styleCounts: CountMap = new Map();
  const modeScores: CountMap = new Map(); // suma de weights por modo

  const keys: string[] = [];
  if (lookbackDays <= 0) {
    keys.push(fromKey);
  } else {
    const start = nowInTZ(TZ);
    for (let i = lookbackDays; i >= 0; i--) {
      const d = new Date(start);
      d.setDate(d.getDate() - i);
      keys.push(dayKey(d));
    }
  }

  // Nota: si tu colección es grande, considera paginar por dateKey+status con índices compuestos.
  for (const k of keys) {
    const q = await db.collection("submissions")
      .where("dateKey", "==", k)
      .where("status", "==", "public") // ajusta si usas otro campo
      .limit(2000) // defensa básica
      .get();

    q.forEach(doc => {
      const sub = doc.data() as Subm;
      const w = weightFrom(sub);

      (sub.tags ?? []).forEach(t => add(tagCounts, t.toLowerCase(), w));
      if (sub.style) add(styleCounts, sub.style.toLowerCase(), w);
      if (sub.mode) add(modeScores, sub.mode, w);
    });
  }

  const topTags = sortTop(tagCounts, 6);
  const topStyles = sortTop(styleCounts, 6);
  const bestMode = sortTop(modeScores, 1)[0] ?? "global";

  return { topTags, topStyles, bestMode };
}

async function fetchSeedInstruction(prevKey: string, bestMode: string): Promise<string | null> {
  const snap = await db.doc(`challenges/${prevKey}`).get();
  if (!snap.exists) return null;
  const data = snap.data() as any;
  if (bestMode === "global") {
    return data?.global?.instruction ?? null;
  }
  return data?.categories?.[bestMode]?.instruction ?? null;
}

// ------------- CRON -------------
export const ensureDailyChallenges = onSchedule(
  { schedule: "1 0 * * *", timeZone: TZ },
  async () => {
    const key = todayKey();
    const ref = db.doc(`challenges/${key}`);
    const exists = await ref.get();
    if (exists.exists) return;

    const prevKey = yesterdayKey();

    // 1) Señales de AYER
    let { topTags, topStyles, bestMode } = await fetchTopSignals(prevKey, 0);

    // Fallback: 7 días si ayer estuvo flojo
    if (topTags.length === 0 && topStyles.length === 0) {
      const { topTags: t2, topStyles: s2, bestMode: m2 } = await fetchTopSignals(prevKey, 7);
      topTags = t2;
      topStyles = s2;
      bestMode = m2;
    }

    // 2) Semilla: instrucción del reto del modo ganador de AYER
    const seedInstruction = await fetchSeedInstruction(prevKey, bestMode);

    // 3) Generar ideas NUEVAS con base en la semilla y señales reales
    const ideas = await generateChallengeIdeas({
      seedInstruction,             // ← si es null, la IA debe manejar fallback
      topTags,                     // ← provenientes de submissions
      topStyles,                   // ← provenientes de submissions
      wantCategories: WANT_CATEGORIES,
      preferCategory: bestMode,    // ← sugiere priorizar ese “tono” o línea
    });

    // 4) Armar doc de hoy
    const docData: any = {
      key,
      createdAt: Timestamp.now(),
      expiresAt: endOfTomorrow(),
      global: {
        instruction:
          ideas["global"] ??
          (seedInstruction
            ? `Remix del reto: ${seedInstruction}`
            : "Reto global del día: crea un clip corto que atrape en 3s."),
    };
    docData.categories = {};
    for (const c of WANT_CATEGORIES.filter(c => c !== "global")) {
      docData.categories[c] = {
        instruction:
          ideas[c] ??
          (seedInstruction
            ? `Versión ${c} del reto de ayer: ${seedInstruction}`
            : `Reto #${c}: sube tu take en <30s.`),
      };
    }

    await ref.set(docData, { merge: false });
  }
);
