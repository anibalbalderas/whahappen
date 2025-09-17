// app/top-creators.tsx
// Ranking diario por creador (posts de HOY):
// - Score = likes * 5 + comments * 8 + views * 0.2
// - Views: conteo REAL desde /views (total; no registramos self-view)
// - Comments: conteo REAL desde /comments EXCLUYENDO al autor (otros = total - autor)
// - Likes: doc (likesFromOthersCount ?? likesCount) como hasta ahora
// - Ignora leaderboardDaily del backend para evitar datos desactualizados

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../lib/firebase';
import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where, getCountFromServer
} from 'firebase/firestore';
import Avatar from '../components/Avatar';
import BottomNav from '../components/BottomNav';

type CreatorRow = {
  uid: string;
  posts: number;
  likes: number;
  comments: number;
  reposts: number;
  views: number;
  score: number;
};

type UsersMap = Record<string, { handle?: string; displayName?: string; photoURL?: string }>;

async function fetchUsersByUids(uids: string[]): Promise<UsersMap> {
  const entries = await Promise.all(
    Array.from(new Set(uids)).map(async (uid) => {
      const snap = await getDoc(doc(db, 'users', uid));
      return [uid, (snap.data() as any) || {}] as const;
    })
  );
  return Object.fromEntries(entries);
}

export default function TopCreators() {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<CreatorRow[]>([]);
  const [users, setUsers] = useState<UsersMap>({});
  const [loading, setLoading] = useState(true);
  const unsubRef = useRef<() => void>();

  useEffect(() => {
    // Siempre calculamos localmente los posts de HOY para asegurar frescura
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const dateKey = `${y}${m}${d}`;

    // Suscripción “dummy” para refrescar cada que haya cambios en submissions de hoy
    const q = query(
      collection(db, 'submissions'),
      where('dateKey', '==', dateKey),
      orderBy('createdAt', 'desc'),
      limit(500)
    );

    unsubRef.current = onSnapshot(q, async (snap) => {
      // 1) Lista de posts de hoy
      const posts = snap.docs.map((dx) => ({ id: dx.id, ...(dx.data() as any) }));

      // 2) Para cada post: likes (doc), comments (subcolección sin autor), views (subcolección)
      const perPost = await Promise.all(posts.map(async (p: any) => {
        const id: string = p.id;
        const authorUid: string = String(p.uid || 'unknown');

        // likes desde doc
        const likes = Number(p.likesFromOthersCount ?? p.likesCount ?? 0);

        // comments desde subcolección (otros = total - autor)
        let comments = 0;
        try {
          const comColl = collection(db, 'submissions', id, 'comments');
          const totalSnap = await getCountFromServer(comColl);
          const total = Number(totalSnap.data().count || 0);
          const authorSnap = await getCountFromServer(query(comColl, where('uid', '==', authorUid)));
          const authorCount = Number(authorSnap.data().count || 0);
          comments = Math.max(0, total - authorCount);
        } catch {
          // fallback doc
          comments = Number(p.commentsFromOthersCount ?? p.commentsCount ?? 0);
        }

        // views desde subcolección (/views no registra self-view → ya son “de otros”)
        let views = 0;
        try {
          const vCnt = await getCountFromServer(collection(db, 'submissions', id, 'views'));
          views = Number(vCnt.data().count || 0);
        } catch {
          views = Number(p.viewsFromOthersCount ?? p.viewsCount ?? 0);
        }

        return { id, uid: authorUid, likes, comments, views };
      }));

      // 3) Agregar por creador y calcular score
      const agg = new Map<string, CreatorRow>();
      perPost.forEach(({ uid, likes, comments, views }) => {
        const row = agg.get(uid) || { uid, posts: 0, likes: 0, comments: 0, views: 0, score: 0, reposts: 0 };
        row.posts += 1;
        row.likes += likes;
        row.comments += comments;
        row.views += views;
        row.score += likes * 5 + comments * 8 + views * 0.2;
        agg.set(uid, row);
      });

      const list = Array.from(agg.values()).sort((a, b) => b.score - a.score);
      setRows(list);
      setUsers(await fetchUsersByUids(list.map(x => x.uid)));
      setLoading(false);
    });

    return () => { unsubRef.current?.(); };
  }, []);

  const renderItem = ({ item, index }: { item: CreatorRow; index: number }) => {
    const u = users[item.uid] || {};
    const display = u?.handle ? `@${u.handle}` : (u?.displayName ?? `user-${item.uid.slice(0, 6)}`);

    return (
      <View style={{
        marginHorizontal: 16,
        marginBottom: 12,
        backgroundColor: '#111317',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#232732',
        padding: 12,
        flexDirection: 'row',
        alignItems: 'center',
      }}>
        <View style={{
          width: 28, height: 28, borderRadius: 14, backgroundColor: index === 0 ? '#f9d64e' : '#2a2e36',
          alignItems: 'center', justifyContent: 'center', marginRight: 10
        }}>
          <Text style={{ color: index === 0 ? '#111' : '#ddd', fontWeight: '800' }}>{index + 1}</Text>
        </View>

        <View style={{ marginRight: 12 }}>
          <Avatar uid={item.uid} size={38} />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={{ color: '#fff', fontWeight: '800', marginBottom: 4 }}>{display}</Text>
          <Text style={{ color: '#9aa0a6', fontSize: 12 }}>
            {item.posts} posts • {item.likes} likes • {item.comments} comments • {Math.round(item.views)} views
          </Text>
        </View>

        <View style={{
          minWidth: 54, paddingHorizontal: 10, paddingVertical: 6,
          backgroundColor: '#171a20', borderWidth: 1, borderColor: '#2b3040',
          borderRadius: 10, alignItems: 'center'
        }}>
          <Text style={{ color: '#9aa0a6', fontSize: 10, marginBottom: 2 }}>score</Text>
          <Text style={{ color: '#fff', fontWeight: '900' }}>{Math.round(item.score)}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={{ paddingTop: (insets.top || 12) + 6, paddingBottom: 12, paddingHorizontal: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Ionicons name="trophy" size={20} color="#f9d64e" />
          <Text style={{ color: '#fff', fontWeight: '900', fontSize: 20 }}>Top de creadores</Text>
        </View>
        <Text style={{ color: '#9aa0a6' }}>Ranking diario · datos en vivo</Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(x) => x.uid}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: (insets.bottom || 12) + 90 }}
        />
      )}

      <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <BottomNav />
      </View>
    </View>
  );
}
