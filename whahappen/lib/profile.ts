// lib/profile.ts
import { auth, db } from './firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

export type PublicUser = {
  uid: string;
  handle: string;
  displayName: string;
  photoURL?: string | null;
  bio?: string;
};

function slugifyHandle(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9_]+/g, '').slice(0, 18) || `user${Math.random().toString(36).slice(2,8)}`;
}

export async function ensureProfileDoc() {
  const u = auth.currentUser;
  if (!u) return;
  const ref = doc(db, 'users', u.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return;

  const base = (u.email || '').split('@')[0] || 'user';
  const handle = slugifyHandle(base);
  const displayName = base.charAt(0).toUpperCase() + base.slice(1);

  await setDoc(ref, {
    uid: u.uid,
    handle,
    displayName,
    photoURL: u.photoURL ?? null,
    bio: '',
    createdAt: serverTimestamp(),
  });
}

export async function getPublicUser(uid: string): Promise<PublicUser | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  const d = snap.data() as any;
  return { uid, handle: d.handle || 'user', displayName: d.displayName || 'User', photoURL: d.photoURL ?? null, bio: d.bio ?? '' };
}
