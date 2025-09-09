// lib/choices.ts
import { auth, db } from './firebase';
import { doc, getDoc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { todayKey } from './date';

export type ChoiceDoc = {
  mode: string;
  selectedAt: any;       // serverTimestamp()
  expiresAt: Timestamp;  // fin de la ventana
  completed?: boolean;   // se marca true al publicar
};

// Lee la elección de hoy
export async function getTodayChoice(): Promise<{ choice: ChoiceDoc | null, dateKey: string }> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('No auth');
  const dk = todayKey();
  const snap = await getDoc(doc(db, 'users', uid, 'choices', dk));
  return { choice: snap.exists() ? (snap.data() as ChoiceDoc) : null, dateKey: dk };
}

// Crea el lock del día (si no existe). Por defecto 30 minutos.
export async function lockTodayChoice(mode: string, windowMinutes = 30): Promise<ChoiceDoc> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('No auth');
  const dk = todayKey();
  const now = new Date();
  const expires = new Date(now.getTime() + windowMinutes * 60 * 1000);
  const payload: ChoiceDoc = {
    mode,
    selectedAt: serverTimestamp(),
    expiresAt: Timestamp.fromDate(expires),
    completed: false,
  };
  await setDoc(doc(db, 'users', uid, 'choices', dk), payload, { merge: false });
  return payload;
}

// Marca como completado (al publicar)
export async function markTodayChoiceCompleted(): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('No auth');
  const dk = todayKey();
  await setDoc(
    doc(db, 'users', uid, 'choices', dk),
    { completed: true },
    { merge: true }
  );
}

export function millisLeft(expiresAt: Timestamp): number {
  const ms = expiresAt.toDate().getTime() - Date.now();
  return Math.max(0, ms);
}

export function formatCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
