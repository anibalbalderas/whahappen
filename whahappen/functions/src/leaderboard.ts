// functions/src/leaderboard.ts
import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export const monthlyLeaderboard = functions.pubsub
  .schedule("15 6 1 * *") // 06:15 día 1 del mes
  .timeZone("America/Matamoros")
  .onRun(async (_ctx) => {
    const now = new Date();
    const month = now.getMonth() === 0 ? 12 : now.getMonth();
    const year = month === 12 ? now.getFullYear() - 1 : now.getFullYear();
    const yyyyMM = `${year}-${String(month).padStart(2, "0")}`;

    const start = new Date(`${yyyyMM}-01T00:00:00-06:00`);
    const end = new Date(start);
    end.setMonth(start.getMonth() + 1);

    const qs = await db
      .collection("submissions")
      .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(start))
      .where("createdAt", "<", admin.firestore.Timestamp.fromDate(end))
      .get();

    const agg: Record<string, { likes: number; comments: number; views: number }> = {};
    qs.forEach((d) => {
      const x = d.data() as any;
      const uid = x.uid;
      agg[uid] ||= { likes: 0, comments: 0, views: 0 };
      agg[uid].likes += x.likesCount || 0;
      agg[uid].comments += x.commentsCount || 0;
      agg[uid].views += x.viewsCount || 0;
    });

    const top10 = Object.entries(agg)
      .map(([uid, v]) => ({
        uid,
        likes: v.likes,
        comments: v.comments,
        views: v.views,
        score: v.likes * 2 + v.comments * 1 + v.views * 0.2,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((x, i) => ({ ...x, rank: i + 1 }));

    await db.doc(`leaderboards_month/${yyyyMM}`).set({
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      top10,
    });
  });
