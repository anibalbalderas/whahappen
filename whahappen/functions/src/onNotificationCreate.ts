// functions/src/onNotificationCreate.ts
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db } from './firebaseAdmin';  // ⬅️ usa el compartido

type Notif = {
  type: 'like' | 'comment' | 'follow' | 'message';
  fromUid: string;
  postId?: string;
  threadId?: string;
  text?: string;
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Dispara cuando se crea cualquier doc en:
 *   notifications/{uid}/items/{notifId}
 */
export const onNotificationCreate = onDocumentCreated(
  'notifications/{uid}/items/{notifId}',
  async (event) => {
    const snap = event.data;               // Firestore document snapshot
    if (!snap) return;

    const { uid } = event.params as { uid: string; notifId: string };
    const notif = snap.data() as Notif;

    // Token del destinatario
    const userDoc = await db.doc(`users/${uid}`).get();
    const pushToken = userDoc.get('pushToken');
    if (!pushToken) return;

    // Nombre de quien generó la notificación
    const fromDoc = await db.doc(`users/${notif.fromUid}`).get();
    const fromName = fromDoc.get('handle') || fromDoc.get('displayName') || 'Alguien';

    const title = fromName;
    const body =
      notif.text ||
      (notif.type === 'like'    ? 'le gustó tu video'
       : notif.type === 'comment' ? 'comentó tu video'
       : notif.type === 'follow'  ? 'comenzó a seguirte'
       :                             'te envió un mensaje');

    // Node 18+ trae fetch global
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{
        to: pushToken,
        sound: 'default',
        title,
        body,
        data: {
          type: notif.type,
          postId: notif.postId,
          threadId: notif.threadId,
          fromUid: notif.fromUid,
        },
      }]),
    });
  }
);
