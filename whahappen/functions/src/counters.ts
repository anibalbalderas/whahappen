// functions/src/counters.ts
import { onDocumentCreated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { db } from "./firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export const onLikeAdded = onDocumentCreated("submissions/{sid}/likes/{uid}", async (event) => {
  const { sid } = event.params as { sid: string };
  await db.doc(`submissions/${sid}`).set(
    { likesCount: FieldValue.increment(1) },
    { merge: true }
  );
});

export const onLikeRemoved = onDocumentDeleted("submissions/{sid}/likes/{uid}", async (event) => {
  const { sid } = event.params as { sid: string };
  await db.doc(`submissions/${sid}`).set(
    { likesCount: FieldValue.increment(-1) },
    { merge: true }
  );
});
