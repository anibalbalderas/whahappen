// lib/follow.ts
import { db, auth } from './firebase';
import {
  doc, setDoc, deleteDoc, getDoc, collection, query, where,
  getCountFromServer, serverTimestamp
} from 'firebase/firestore';

const fid = (follower: string, following: string) => `${follower}_${following}`;

export async function follow(targetUid: string) {
  const me = auth.currentUser!.uid;
  await setDoc(doc(db, 'follows', fid(me, targetUid)), {
    follower: me,
    following: targetUid,
    createdAt: serverTimestamp(),
  });
}

export async function unfollow(targetUid: string) {
  const me = auth.currentUser!.uid;
  await deleteDoc(doc(db, 'follows', fid(me, targetUid)));
}

export async function isFollowing(targetUid: string) {
  const me = auth.currentUser!.uid;
  const snap = await getDoc(doc(db, 'follows', fid(me, targetUid)));
  return snap.exists();
}

export async function followersCount(uid: string) {
  const q = query(collection(db, 'follows'), where('following', '==', uid));
  const s = await getCountFromServer(q);
  return s.data().count || 0;
}

export async function followingCount(uid: string) {
  const q = query(collection(db, 'follows'), where('follower', '==', uid));
  const s = await getCountFromServer(q);
  return s.data().count || 0;
}
