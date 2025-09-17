// functions/src/scheduled.ts
import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const cutStreakDaily = functions.pubsub
  .schedule("10 6 * * *") // 06:10 local
  .timeZone("America/Matamoros")
  .onRun(async (_ctx) => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yKey = toDateKey(yesterday);

    const qs = await db.collection("squads").get();
    const batch = db.batch();
    qs.forEach((docSnap) => {
      const s = docSnap.data() as any;
      if (s.lastActiveDateKey !== yKey) {
        batch.set(docSnap.ref, { streak: 0 }, { merge: true });
      }
    });
    await batch.commit();
  });
