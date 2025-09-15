// functions/src/trending.ts
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { OPENAI_API_KEY, generateChallengeIdeas } from "./ai";

// 👇 Usa el SDK modular de Firestore Admin
import {
  getFirestore,
  FieldValue,
  Timestamp,
} from "firebase-admin/firestore";
import * as admin from "firebase-admin";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = getFirestore();

const CATEGORIES = [
  "global",
  "caritativo",
  "picaro",
  "creativo",
  "rebelde",
  "troll",
  "chill",
] as const;

type CategoryKey = (typeof CATEGORIES)[number];

type SignalExample = {
  caption?: string;
  tag?: string;
  mood?: string;
  sample?: string;
};

type SignalSummary = {
  topTags: string[];
  topMoods: string[];
  examples: SignalExample[];
};

function dateKey(d = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

/** Score con decay temporal (comentarios pesan más que likes). */
function scoreOf(
  x: FirebaseFirestore.DocumentData,
  nowMs: number
): number {
  const likes = Number(x.likesCount || 0);
  const comments = Number(x.commentsCount || 0);

  let createdMs = nowMs;
  const ca = x.createdAt as Timestamp | undefined;
  if (ca && typeof ca.toDate === "function") {
    createdMs = ca.toDate().getTime();
  }

  const ageH = Math.max(1, (nowMs - createdMs) / 3_600_000); // horas
  const decay = 1 / Math.sqrt(ageH); // más nuevo = más peso
  return (likes * 1 + comments * 2) * decay;
}

/** Lee últimos N días de submissions y resume señales. */
async function collectSignals(days = 7): Promise<SignalSummary> {
  const startTS = Timestamp.fromDate(daysAgo(days));
  const now = Date.now();

  const sumsTags = new Map<string, number>();
  const sumsMoods = new Map<string, number>();
  const examples: SignalExample[] = [];

  const snap = await db
    .collection("submissions")
    .where("createdAt", ">=", startTS)
    .get();

  for (const doc of snap.docs) {
    const x = doc.data();
    const s = scoreOf(x, now);
    if (s <= 0) continue;

    const tag = String(x.challengeTag || x.tag || x.challenge || "")
      .trim()
      .toLowerCase();
    const mood = String(x.mood || x.category || "")
      .trim()
      .toLowerCase();

    if (tag) sumsTags.set(tag, (sumsTags.get(tag) || 0) + s);
    if (mood) sumsMoods.set(mood, (sumsMoods.get(mood) || 0) + s);

    examples.push({
      caption: x.caption ? String(x.caption).slice(0, 140) : undefined,
      tag,
      mood,
      sample: String(x.caption || tag || mood || "").slice(0, 80),
    });
  }

  const topTags = [...sumsTags.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k]) => k);

  const topMoods = [...sumsMoods.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k]) => k);

  return { topTags, topMoods, examples: examples.slice(0, 12) };
}

function fallback(category: CategoryKey): string {
  const map: Record<CategoryKey, string> = {
    global: "Graba algo que te haga reír en menos de 10s.",
    caritativo: "Haz una buena acción en cámara (algo simple y sincero).",
    picaro: "Comparte un truco o life-hack que pocos conocen.",
    creativo: "Transforma un objeto común en algo inesperado.",
    rebelde: "Rompe una regla cotidiana de forma divertida e inofensiva.",
    troll: "Trolea con respeto: cambia algo y graba la reacción.",
    chill: "Muestra tu momento zen favorito de hoy.",
  };
  return map[category];
}

/** Escribe /challenges/{YYYYMMDD} con categorías, señales y metadatos. */
async function writeChallengeDoc(
  dateKeyStr: string,
  ideas: Record<string, string>,
  signals: SignalSummary
): Promise<void> {
  const payload: {
    generatedAt: FirebaseFirestore.FieldValue;
    basedOn: {
      days: number;
      windowStart: FirebaseFirestore.Timestamp;
      windowEnd: FirebaseFirestore.FieldValue;
    };
    signals: SignalSummary;
    categories: Record<CategoryKey, { instruction: string }>;
  } = {
    generatedAt: FieldValue.serverTimestamp(),
    basedOn: {
      days: 7,
      windowStart: Timestamp.fromDate(daysAgo(7)),
      windowEnd: FieldValue.serverTimestamp(),
    },
    signals,
    categories: {} as Record<CategoryKey, { instruction: string }>,
  };

  for (const k of CATEGORIES) {
    const text =
      (ideas[k] ||
        ideas[k.toUpperCase()] ||
        ideas[k[0].toUpperCase() + k.slice(1)] ||
        "").toString().trim();
    payload.categories[k] = {
      instruction: text || fallback(k),
    };
  }

  await db.collection("challenges").doc(dateKeyStr).set(payload, { merge: true });
}

/** Orquesta: señales → IA → escribir doc del día. */
async function composeAndWriteFor(date: Date) {
  const key = dateKey(date);
  const signals = await collectSignals(7);

  const ideas = await generateChallengeIdeas({
    topStyles: signals.topMoods,
    topTags: signals.topTags,
    wantCategories: [...CATEGORIES],
  });

  await writeChallengeDoc(key, ideas, signals);
  return { key, ideas, signals };
}

/* ===================== EXPORTED FUNCTIONS ===================== */

/** CRON diario 06:00 America/Matamoros */
export const generateDailyChallenges = onSchedule(
  {
    schedule: "0 6 * * *",
    timeZone: "America/Matamoros",
    region: "us-central1",
    secrets: [OPENAI_API_KEY],
  },
  async () => {
    await composeAndWriteFor(new Date());
  }
);

/** HTTP para probar manualmente: ?date=YYYYMMDD (opcional) */
export const generateChallengesNow = onRequest(
  { region: "us-central1", secrets: [OPENAI_API_KEY] },
  async (req, res) => {
    try {
      const q = (req.query?.date as string) || dateKey();
      let d = new Date();
      if (q && /^\d{8}$/.test(q)) {
        d = new Date(+q.slice(0, 4), +q.slice(4, 6) - 1, +q.slice(6, 8));
      }
      const out = await composeAndWriteFor(d);
      res.json({ ok: true, ...out });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }
);
