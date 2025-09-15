// lib/likes.ts
import { auth, db } from './firebase';
import {
  doc, getDoc, setDoc, deleteDoc, serverTimestamp,
  onSnapshot, collection, Unsubscribe
} from 'firebase/firestore';

/** Observa si YO (auth.uid) le di like a este post. */
export function observeMyLike(sid: string, cb: (liked: boolean)=>void): Unsubscribe | undefined {
  const me = auth.currentUser?.uid;
  if (!me) return;
  const ref = doc(db, 'submissions', sid, 'likes', me);
  return onSnapshot(ref, snap => cb(snap.exists()));
}

/**
 * Contador robusto: usamos el tamaño de la subcolección en tiempo real,
 * así la UI no depende de que la Cloud Function ya haya actualizado likesCount.
 */
export function observeLikesCount(sid: string, cb: (n: number)=>void): Unsubscribe {
  const likesCol = collection(db, 'submissions', sid, 'likes');
  return onSnapshot(likesCol, snap => cb(snap.size));
}

/** Alterna mi like (sin tocar likesCount en el cliente). Devuelve el nuevo estado. */
export async function toggleLike(sid: string): Promise<boolean> {
  const me = auth.currentUser?.uid;
  if (!me) throw new Error('No auth');

  const likeRef = doc(db, 'submissions', sid, 'likes', me);
  const exists = (await getDoc(likeRef)).exists();
  if (exists) {
    await deleteDoc(likeRef); // la Function hará -1
    return false;
  } else {
    await setDoc(likeRef, { uid: me, createdAt: serverTimestamp() }); // la Function hará +1
    return true;
  }
}
