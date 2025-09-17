// functions/src/counters.ts
import { onDocumentCreated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebaseAdmin";

// Autor del post
async function getAuthorUid(submissionId: string): Promise<string | null> {
  const snap = await db.doc(`submissions/${submissionId}`).get();
  return snap.exists ? (snap.get("uid") as string) ?? null : null;
}

/* ========== LIKES (excluye self-like) ========== */
export const onLikeAdded = onDocumentCreated("submissions/{sid}/likes/{uid}", async (e) => {
  const { sid, uid } = e.params as { sid: string; uid: string };
  const author = await getAuthorUid(sid);
  const ref = db.doc(`submissions/${sid}`);

  const updates: any = { likesCount: FieldValue.increment(1) };
  if (author && uid !== author) updates.likesFromOthersCount = FieldValue.increment(1);

  await ref.set(updates, { merge: true });
});

export const onLikeRemoved = onDocumentDeleted("submissions/{sid}/likes/{uid}", async (e) => {
  const { sid, uid } = e.params as { sid: string; uid: string };
  const author = await getAuthorUid(sid);
  const ref = db.doc(`submissions/${sid}`);

  const updates: any = { likesCount: FieldValue.increment(-1) };
  if (author && uid !== author) updates.likesFromOthersCount = FieldValue.increment(-1);

  await ref.set(updates, { merge: true });
});

/* ========== COMMENTS (excluye self-comment) ========== */
export const onCommentAdded = onDocumentCreated("submissions/{sid}/comments/{cid}", async (e) => {
  const { sid } = e.params as { sid: string; cid: string };
  const comment = e.data?.data() as { uid?: string } | undefined;
  const author = await getAuthorUid(sid);
  const ref = db.doc(`submissions/${sid}`);

  const updates: any = { commentsCount: FieldValue.increment(1) };
  if (author && comment?.uid && comment.uid !== author) {
    updates.commentsFromOthersCount = FieldValue.increment(1);
  }
  await ref.set(updates, { merge: true });
});

export const onCommentRemoved = onDocumentDeleted("submissions/{sid}/comments/{cid}", async (e) => {
  const { sid } = e.params as { sid: string; cid: string };
  const comment = e.data?.data() as { uid?: string } | undefined;
  const author = await getAuthorUid(sid);
  const ref = db.doc(`submissions/${sid}`);

  const updates: any = { commentsCount: FieldValue.increment(-1) };
  if (author && comment?.uid && comment.uid !== author) {
    updates.commentsFromOthersCount = FieldValue.increment(-1);
  }
  await ref.set(updates, { merge: true });
});

/* ========== VIEWS (excluye self-view) ========== */
/**
 * Estructura: submissions/{sid}/views/{viewerUid}
 * => 1 usuario cuenta a lo mucho 1 vista por post.
 * (Si quieres “1 por día”, usa ID `${viewerUid}_${YYYYMMDD}` en el cliente.)
 */
export const onViewAdded = onDocumentCreated("submissions/{sid}/views/{viewerUid}", async (e) => {
  const { sid, viewerUid } = e.params as { sid: string; viewerUid: string };
  const author = await getAuthorUid(sid);
  const ref = db.doc(`submissions/${sid}`);

  const updates: any = { viewsCount: FieldValue.increment(1) };
  if (author && viewerUid !== author) {
    updates.viewsFromOthersCount = FieldValue.increment(1);
  }
  await ref.set(updates, { merge: true });
});
