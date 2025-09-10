// app/profile/[uid].tsx
import React, { useEffect, useState, useCallback, memo } from 'react';
import { View, Text, Dimensions, FlatList, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { Video } from 'expo-av';
import { auth, db } from '../../lib/firebase';
import {
  collection, doc, onSnapshot, orderBy, query, where, getDoc, setDoc, deleteDoc,
  serverTimestamp, getCountFromServer
} from 'firebase/firestore';
import Avatar from '../../components/Avatar';
import BottomNav from '../../components/BottomNav';
import { rankPosts } from '../../lib/ranking';

const { width } = Dimensions.get('window');
const GAP = 8, PADDING_H = 16;
const TILE = Math.floor((width - PADDING_H * 2 - GAP * 2) / 3);

/** 🔮 Fondo decorativo estilo login/register */
const BackgroundDecor = memo(() => (
  <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
    <LinearGradient
      colors={['rgba(124,77,255,0.28)', 'rgba(124,77,255,0.0)']}
      start={{ x: 0.1, y: 0.0 }} end={{ x: 0.9, y: 1 }}
      style={{ position: 'absolute', width: 320, height: 320, borderRadius: 160, top: -80, left: -80, transform: [{ rotate: '18deg' }] }}
    />
    <LinearGradient
      colors={['rgba(255,77,222,0.22)', 'rgba(255,77,222,0.0)']}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ position: 'absolute', width: 260, height: 260, borderRadius: 130, top: 220, right: -70, transform: [{ rotate: '-12deg' }] }}
    />
    <LinearGradient
      colors={['rgba(0,210,255,0.18)', 'rgba(0,210,255,0.0)']}
      start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }}
      style={{ position: 'absolute', width: 420, height: 420, borderRadius: 210, bottom: -140, left: width * 0.15, transform: [{ rotate: '25deg' }] }}
    />
  </View>
));

type UserDoc = { handle?: string; displayName?: string; bio?: string; photoURL?: string | null; };
type Post = { id: string; uid: string; videoURL: string; };

export default function ProfileScreen() {
  const { uid } = useLocalSearchParams<{ uid: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const me = auth.currentUser?.uid || null;

  const [user, setUser] = useState<UserDoc | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [followers, setFollowers] = useState<number>(0);
  const [following, setFollowing] = useState<number>(0);
  const [isFollowing, setIsFollowing] = useState<boolean>(false);

  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(doc(db, 'users', String(uid)), (snap) => setUser((snap.data() as any) || {}));
    return () => unsub();
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    const qy = query(collection(db, 'submissions'), where('uid', '==', String(uid)), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(qy, (snap) => {
      const arr = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Post[];
      const ranked = rankPosts(arr, { me }); // ordenar grid por popularidad (además de createdAt)
      setPosts(ranked);
    });
    return () => unsub();
  }, [uid, me]);

  const refreshCounts = useCallback(async () => {
    try {
      const cFollowers = await getCountFromServer(query(collection(db, 'follows'), where('following', '==', String(uid))));
      const cFollowing = await getCountFromServer(query(collection(db, 'follows'), where('follower', '==', String(uid))));
      setFollowers(cFollowers.data().count || 0);
      setFollowing(cFollowing.data().count || 0);
    } catch { setFollowers(v => v || 0); setFollowing(v => v || 0); }
  }, [uid]);

  useEffect(() => { refreshCounts(); }, [refreshCounts]);

  useEffect(() => {
    if (!me || !uid || me === uid) { setIsFollowing(false); return; }
    getDoc(doc(db, 'follows', `${me}_${uid}`)).then(s => setIsFollowing(s.exists()));
  }, [me, uid]);

  const toggleFollow = async () => {
    if (!me || !uid || me === uid) return;
    const fid = `${me}_${uid}`; const ref = doc(db, 'follows', fid);
    if (isFollowing) { await deleteDoc(ref); setIsFollowing(false); setFollowers(n => Math.max(0, n - 1)); }
    else { await setDoc(ref, { follower: me, following: uid, createdAt: serverTimestamp() }); setIsFollowing(true); setFollowers(n => n + 1); }
  };

  const back = () => { if ((router as any).canGoBack?.()) router.back(); else router.replace('/feed'); };
  const openWatch = (sid: string) => router.push(`/watch/${uid}?sid=${sid}`);

  const Header = memo(() => {
    const handle = user?.handle ? `@${user.handle}` : `@user-${String(uid).slice(0, 5)}`;
    const name = user?.displayName || '';
    const isMe = me === uid;

    return (
      <View style={{ paddingHorizontal: PADDING_H, marginTop: (insets.top || 12) + 42, marginBottom: 14 }}>
        <BlurView intensity={40} tint="dark" style={{ borderRadius: 22, overflow: 'hidden' }}>
          <View style={{ borderRadius: 22, borderWidth: 1, borderColor: '#1f2126', padding: 18, alignItems: 'center', backgroundColor: '#0e1015aa' }}>
            <Avatar uid={String(uid)} size={100} />
            <Text style={{ color: 'white', fontWeight: '900', fontSize: 22, marginTop: 12 }}>{handle}</Text>
            {!!name && <Text style={{ color: '#c6cbd2', marginTop: 4 }} numberOfLines={1}>{name}</Text>}

            <View style={{ flexDirection: 'row', gap: 24, marginTop: 12 }}>
              <View style={{ alignItems: 'center' }}><Text style={{ color: 'white', fontWeight: '900' }}>{followers}</Text><Text style={{ color: '#9aa0a6' }}>seguidores</Text></View>
              <View style={{ alignItems: 'center' }}><Text style={{ color: 'white', fontWeight: '900' }}>{following}</Text><Text style={{ color: '#9aa0a6' }}>siguiendo</Text></View>
            </View>

            {!!user?.bio && <Text style={{ color: '#e3e5e8', textAlign: 'center', marginTop: 10 }} numberOfLines={3}>{user.bio}</Text>}

            <TouchableOpacity onPress={isMe ? () => router.push('/profile/edit') : toggleFollow} activeOpacity={0.9} style={{ alignSelf: 'stretch', marginTop: 14 }}>
              <View style={{ backgroundColor: 'white', paddingVertical: 12, borderRadius: 12, alignItems: 'center' }}>
                <Text style={{ color: 'black', fontWeight: '900' }}>{isMe ? 'Editar perfil' : isFollowing ? 'Siguiendo' : 'Seguir'}</Text>
              </View>
            </TouchableOpacity>
          </View>
        </BlurView>
      </View>
    );
  });

  const GridItem = memo(({ item }: { item: Post }) => (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={() => openWatch(item.id)}
      style={{
        width: TILE, height: TILE * 1.4, borderRadius: 10, overflow: 'hidden',
        backgroundColor: '#0f1116', borderWidth: 1, borderColor: '#1f232c'
      }}>
      <Video source={{ uri: item.videoURL }} style={{ width: '100%', height: '100%' }} resizeMode="cover" shouldPlay={false} isMuted />
    </TouchableOpacity>
  ));

  return (
    <LinearGradient colors={['#0b0b0d', '#000']} style={{ flex: 1 }}>
      {/* Decor de fondo */}
      <BackgroundDecor />

      {/* Back arriba, fuera de la card */}
      <View style={{ position: 'absolute', top: (insets.top || 12) + 8, left: 12, zIndex: 10 }}>
        <TouchableOpacity onPress={back} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={posts}
        keyExtractor={(x) => x.id}
        numColumns={3}
        columnWrapperStyle={{ gap: GAP, paddingHorizontal: PADDING_H }}
        contentContainerStyle={{ paddingBottom: (insets.bottom || 12) + 24 }}
        ListHeaderComponent={<Header />}
        ListFooterComponent={<View style={{ height: 12 }} />}
        ItemSeparatorComponent={() => <View style={{ height: GAP }} />}
        renderItem={({ item }) => <GridItem item={item} />}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        initialNumToRender={9}
        windowSize={7}
      />

      {/* Menú inferior */}
      <BottomNav />
    </LinearGradient>
  );
}
