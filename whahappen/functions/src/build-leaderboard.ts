import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "./firebaseAdmin";

const TZ = "America/Matamoros";

type Subm = {
  uid?: string;
  authorId?: string;
  dateKey?: string;      // "YYYY-MM-DD" o "YYYYMMDD"
  status?: string;       // "public" | "private" | undefined
  likesCount?: number;
  viewsCount?: number;
  repostsCount?: number;
  likes?: number;
  views?: number;
  reposts?: number;
  score?: number;
};

function nowTZ() { return new Date(new Date().toLocaleString("en-US", { timeZone: TZ })); }
function toISO(d: Date) {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0"); const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function toCMP(d: Date) { return toISO(d).replace(/-/g, ""); }
function today() { return nowTZ(); }
function yesterday() { const d = nowTZ(); d.setDate(d.getDate() - 1); return d; }

// Peso: si no viene score, calcula con likes/views/reposts
const weight = (s: Subm) => {
  if (typeof s.score === "number") return Math.max(1, s.score);
  const likes = s.likesCount ?? s.likes ?? 0;
  const views = s.viewsCount ?? s.views ?? 0;
  const reposts = s.repostsCount ?? s.reposts ?? 0;
  return 1 + likes * 2 + reposts * 3 + views * 0.05;
};

// Trae submissions para uno o dos dateKeys (ISO/CMP) con un solo índice de campo
async function fetchSubs(keys: string[]) {
  // Firestore limita a 10 valores en "in" (aquí usamos 2)
  const qs = await db.collection("submissions")
    .where("dateKey", "in", keys)
    .limit(5000)
    .get();

  // Incluye: status == "public" o sin status (compatibilidad)
  return qs.docs.filter((d) => {
    const st = (d.get("status") as string | undefined) ?? "public";
    return st === "public";
  });
}

export const buildDailyLeaderboard = onSchedule(
  { schedule: "every 10 minutes", timeZone: TZ },
  async () => {
    const d = today();
    const iso = toISO(d);
    const cmp = toCMP(d);

    // Hoy (ISO/CMP). Si vacío, intenta ayer.
    let docs = await fetchSubs([iso, cmp]);
    if (docs.length === 0) {
      const yd = yesterday();
      docs = await fetchSubs([toISO(yd), toCMP(yd)]);
    }

    const byUser = new Map<string, {
      uid: string; posts: number; likes: number; reposts: number; views: number; score: number;
    }>();

    for (const doc of docs) {
      const s = doc.data() as Subm;
      const uid = s.uid || s.authorId;
      if (!uid) continue;

      const likes = s.likesCount ?? s.likes ?? 0;
      const views = s.viewsCount ?? s.views ?? 0;
      const reposts = s.repostsCount ?? s.reposts ?? 0;
      const w = weight(s);

      const cur = byUser.get(uid) ?? { uid, posts: 0, likes: 0, reposts: 0, views: 0, score: 0 };
      cur.posts += 1;
      cur.likes += likes;
      cur.reposts += reposts;
      cur.views += views;
      cur.score += w;

      byUser.set(uid, cur);
    }

    const topCreators = Array.from(byUser.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);

    const payload = {
      keyISO: iso,
      keyCMP: cmp,
      updatedAt: Timestamp.now(),
      topCreators,
    };

    // Guardar en ambas variantes de ID (ISO y compacta) para que el cliente encuentre el doc
    await Promise.all([
      db.doc(`leaderboardDaily/${iso}`).set(payload, { merge: true }),
      db.doc(`leaderboardDaily/${cmp}`).set(payload, { merge: true }),
    ]);
  }
);
