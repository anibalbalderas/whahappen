import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "./firebaseAdmin";
import { generateChallengeIdeas, OPENAI_SECRET } from "./ai";

const TZ = "America/Matamoros";

type Subm = {
  id?: string;
  uid?: string;
  mode?: string;
  dateKey?: string;
  status?: string;
  tags?: string[];
  style?: string;
  likesCount?: number;
  viewsCount?: number;
  repostsCount?: number;
  score?: number;
};

function nowTZ() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
}
function keyFrom(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function todayKey() {
  return keyFrom(nowTZ());
}

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

async function computeTrending(dateKey: string) {
  const qs = await db
    .collection("submissions")
    .where("dateKey", "==", dateKey)
    .where("status", "==", "public")
    .limit(5000)
    .get();

  const items: (Required<Pick<Subm, "uid" | "mode">> & {
    id: string;
    score: number;
    likes: number;
    views: number;
    reposts: number;
  })[] = [];

  const tagC: CountMap = new Map();
  const styC: CountMap = new Map();
  const modeC: CountMap = new Map();

  qs.forEach((doc) => {
    const s = doc.data() as Subm;
    const id = doc.id;
    const w = weight(s);
    const likes = s.likesCount ?? 0;
    const views = s.viewsCount ?? 0;
    const reposts = s.repostsCount ?? 0;
    const uid = s.uid || "anon";
    const mode = s.mode || "global";

    items.push({ id, uid, mode, score: w, likes, views, reposts });
    (s.tags ?? []).forEach((t) => add(tagC, (t || "").toLowerCase(), w));
    if (s.style) add(styC, (s.style || "").toLowerCase(), w);
    if (s.mode) add(modeC, s.mode, w);
  });

  items.sort((a, b) => b.score - a.score);
  const topItems = items.slice(0, 100);

  return {
    topItems,
    topTags: topK(tagC, 8),
    topStyles: topK(styC, 8),
    bestMode: topK(modeC, 1)[0] ?? "global",
  };
}

/**
 * Programado: (antes llamado buildTrending)
 * Renombrado a generateDailyChallenges para coincidir con tu index.ts
 */
export const generateDailyChallenges = onSchedule(
  { schedule: "every 30 minutes", timeZone: TZ, secrets: [OPENAI_SECRET] },
  async () => {
    const key = todayKey();
    const { topItems, topTags, topStyles, bestMode } = await computeTrending(key);

    // Opcional: ideas para banners/promos
    const ideas = await generateChallengeIdeas({
      seedInstruction: null,
      topTags,
      topStyles,
      wantCategories: ["global"],
      preferCategory: bestMode,
    });

    await db.doc(`trending/daily/${key}`).set(
      {
        key,
        updatedAt: Timestamp.now(),
        topItems,
        aggregates: { topTags, topStyles, bestMode },
        ideas,
      },
      { merge: true }
    );
  }
);

/**
 * Callable: (antes llamado recomputeTrending)
 * Renombrado a generateChallengesNow para coincidir con tu index.ts
 */
export const generateChallengesNow = onCall(
  { secrets: [OPENAI_SECRET] },
  async (_req) => {
    const key = todayKey();
    const { topItems, topTags, topStyles, bestMode } = await computeTrending(key);

    const ideas = await generateChallengeIdeas({
      seedInstruction: null,
      topTags,
      topStyles,
      wantCategories: ["global"],
      preferCategory: bestMode,
    });

    await db.doc(`trendingDaily/${key}`).set(
      {
        key,
        updatedAt: Timestamp.now(),
        topItems,
        aggregates: { topTags, topStyles, bestMode },
        ideas,
      },
      { merge: true }
    );

    return {
      ok: true,
      key,
      counts: { items: topItems.length },
      aggregates: { topTags, topStyles, bestMode },
    };
  }
);
