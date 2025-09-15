import { db } from "./firebase";
import { doc, onSnapshot, getDoc } from "firebase/firestore";
import { todayKey } from "./date";

export type CreatorRow = {
  uid: string;
  posts: number;
  likes: number;
  reposts: number;
  views: number;
  score: number;
};

export function listenTodayTopCreators(cb: (rows: CreatorRow[]) => void) {
  const ref = doc(db, "leaderboardDaily", todayKey()); // ✅
  return onSnapshot(ref, (snap) => {
    const data = snap.data() as any;
    cb(Array.isArray(data?.topCreators) ? data.topCreators : []);
  });
}

export async function fetchUsersByUids(uids: string[]) {
  const out = new Map<string, any>();
  for (let i = 0; i < uids.length; i += 10) {
    const chunk = uids.slice(i, i + 10);
    const qs = await getDocs(query(collection(db, "users"), where("uid", "in", chunk)));
    qs.forEach((d) => {
      const u = d.data();
      out.set(u.uid, u);
    });
  }
  return out;
}
