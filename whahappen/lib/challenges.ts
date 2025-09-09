// lib/challenges.ts
import { db } from './firebase';
import { doc, getDoc } from 'firebase/firestore';
import { candidateKeysForToday } from './date';

export async function getChallengeInstruction(mode: string): Promise<{ text: string | null, usedKey: string | null }> {
  const keys = candidateKeysForToday();
  for (const k of keys) {
    const snap = await getDoc(doc(db, 'challenges', k));
    if (!snap.exists()) continue;
    const data = snap.data() as any;
    const src = mode === 'global' ? data?.global : data?.categories?.[mode];
    const text = src?.instruction ?? src?.title ?? null;
    if (text) return { text, usedKey: k };
  }
  return { text: null, usedKey: null };
}
