// functions/src/squads.ts
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
function prevDateKey(k: string) {
  const [y, m, d] = k.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return toDateKey(dt);
}

export const onSubmissionCreate = functions.firestore
  .document("submissions/{id}")
  .onCreate(async (snap: functions.firestore.DocumentSnapshot, _ctx: functions.EventContext) => {
    const sub = snap.data() as any;
    const uid: string = sub?.uid;
    if (!uid) return;

    const dateKey: string = sub.dateKey || toDateKey(new Date());

    const user = (await db.doc(`users/${uid}`).get()).data() as any;
    const squadId: string | undefined = user?.squadId;
    if (!squadId) return;

    const squadRef = db.doc(`squads/${squadId}`);
    const squadSnap = await squadRef.get();
    if (!squadSnap.exists) return;
    const squad = squadSnap.data() as any;

    const members: string[] = squad.members || [];
    const membersCount = Math.max(1, members.length);
    const threshold = Math.max(1, Math.ceil(0.75 * membersCount));

    const dayRef = db.doc(`squadDays/${squadId}_${dateKey}`);
    await dayRef.set(
      {
        squadId,
        dateKey,
        membersCount,
        posters: admin.firestore.FieldValue.arrayUnion(uid),
      },
      { merge: true }
    );

    const day = (await dayRef.get()).data() as any;
    const postersCount: number = (day?.posters || []).length;
    if (day?.postersCount !== postersCount) {
      await dayRef.set({ postersCount }, { merge: true });
    }

    if (postersCount >= threshold && squad.lastActiveDateKey !== dateKey) {
      const wasYesterday = squad.lastActiveDateKey === prevDateKey(dateKey);
      const newStreak = wasYesterday ? (squad.streak || 0) + 1 : 1;
      await squadRef.set(
        {
          streak: newStreak,
          lastActiveDateKey: dateKey,
          streakUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  });
