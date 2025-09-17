// functions/src/build-leaderboard.ts
import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "./firebaseAdmin";

const TZ = "America/Matamoros";

type Subm = {
  uid?: string;
  authorId?: string;
  dateKey?: string; // "YYYY-MM-DD" o "YYYYMMDD"
  status?: string;
  likesCount?: number; likesFromOthersCount?: number;
  commentsCount?: number; commentsFromOthersCount?: number;
  repostsCount?: number; reposts?: number;
  viewsCount?: number; viewsFromOthersCount?: number;
  likes?: number; views?: number;
  score?: number;
};

function nowTZ() { return new Date(new Date().toLocaleString("en-US",{ timeZone: TZ })); }
function toISO(d: Date) { const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${day}`; }
function toCMP(d: Date) { return toISO(d).replace(/-/g,""); }
function today() { return nowTZ(); }
function yesterday() { const d=nowTZ(); d.setDate(d.getDate()-1); return d; }

// pesos (ajústalos si quieres)
const W = { base: 1, likeOther: 2, commentOther: 1.5, repost: 3, viewOther: 0.05 };

const weight = (s: Subm) => {
  if (typeof s.score === "number") return Math.max(1, s.score);
  const likes = s.likesFromOthersCount ?? s.likesCount ?? s.likes ?? 0;
  const comments = s.commentsFromOthersCount ?? s.commentsCount ?? 0;
  const reposts = s.repostsCount ?? s.reposts ?? 0;
  const views = s.viewsFromOthersCount ?? s.viewsCount ?? s.views ?? 0;
  return W.base + likes*W.likeOther + comments*W.commentOther + reposts*W.repost + views*W.viewOther;
};

// lee submissions de hoy por ISO/CMP; si vacío, intenta ayer; acepta status ausente
async function fetchSubs(keys: string[]) {
  const qs = await db.collection("submissions").where("dateKey","in",keys).limit(5000).get();
  return qs.docs.filter(d => ((d.get("status") as string|undefined) ?? "public") === "public");
}

export const buildDailyLeaderboard = onSchedule(
  { schedule: "every 10 minutes", timeZone: TZ },
  async () => {
    const d = today();
    const iso = toISO(d), cmp = toCMP(d);

    let docs = await fetchSubs([iso, cmp]);
    if (docs.length === 0) {
      const yd = yesterday();
      docs = await fetchSubs([toISO(yd), toCMP(yd)]);
    }

    const byUser = new Map<string, { uid: string; posts: number; likes: number; comments: number; reposts: number; views: number; score: number }>();

    for (const doc of docs) {
      const s = doc.data() as Subm;
      const uid = s.uid || s.authorId; if (!uid) continue;

      const likes = s.likesFromOthersCount ?? s.likesCount ?? s.likes ?? 0;
      const comments = s.commentsFromOthersCount ?? s.commentsCount ?? 0;
      const reposts = s.repostsCount ?? s.reposts ?? 0;
      const views = s.viewsFromOthersCount ?? s.viewsCount ?? s.views ?? 0;
      const w = weight(s);

      const cur = byUser.get(uid) ?? { uid, posts: 0, likes: 0, comments: 0, reposts: 0, views: 0, score: 0 };
      cur.posts += 1;
      cur.likes += likes;
      cur.comments += comments;
      cur.reposts += reposts;
      cur.views += views;
      cur.score += w;
      byUser.set(uid, cur);
    }

    const topCreators = Array.from(byUser.values()).sort((a,b)=>b.score-a.score).slice(0,50);
    const payload = { keyISO: iso, keyCMP: cmp, updatedAt: Timestamp.now(), topCreators };

    await Promise.all([
      db.doc(`leaderboardDaily/${iso}`).set(payload, { merge: true }),
      db.doc(`leaderboardDaily/${cmp}`).set(payload, { merge: true }),
    ]);
  }
);
