// lib/chat.ts
import { auth, db } from './firebase';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';

export function threadIdFor(a: string, b: string) {
  return [a, b].sort().join('_');
}

export function otherUidFromThread(threadId: string, me?: string | null) {
  const [a, b] = String(threadId).split('_');
  if (!me) return null;
  return a === me ? b : a;
}

/** Crea (si no existe) un thread 1–a–1 y devuelve el threadId (sin leer primero). */
export async function ensureThreadWith(otherUid: string) {
  const me = auth.currentUser?.uid;

  if (!me || !otherUid || me === otherUid) return null;

  const id = threadIdFor(me, otherUid);
  const ref = doc(db, 'chats', id);

  try {
    // 👇 NO getDoc. Crear/actualizar directamente, lo permiten las rules de "create"
    const users = [me, otherUid].sort();
    await setDoc(ref, { users, updatedAt: serverTimestamp() }, { merge: true });
    return id;
  } catch (e) {
    console.error('🔴 ensureThreadWith:error', e);
    return null;
  }
}
