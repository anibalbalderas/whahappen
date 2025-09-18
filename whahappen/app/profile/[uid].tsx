// app/profile/[uid].tsx
import React, { useEffect, useState, useCallback, memo } from 'react';
import { View, Text, Dimensions, FlatList, TouchableOpacity, Alert, StatusBar, Platform } from 'react-native';
import { useLocalSearchParams, useRouter, useSegments } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { Video } from 'expo-av';
import { auth, db } from '../../lib/firebase';
import {
  collection, doc, onSnapshot, orderBy, query, where, getDoc, setDoc, deleteDoc,
  serverTimestamp, getCountFromServer, addDoc
} from 'firebase/firestore';
import Avatar from '../../components/Avatar';
import BottomNav from '../../components/BottomNav';
import { rankPosts } from '../../lib/ranking';
import { ensureThreadWith } from '../../lib/chat';

const { width } = Dimensions.get('window');
const GAP = 8, PADDING_H = 16;
const TILE = Math.floor((width - PADDING_H * 2 - GAP * 2) / 3);

const BackgroundDecor = () => (
  <View pointerEvents="none" style={{ position:'absolute', left:0, right:0, top:0, bottom:0 }}>
    <LinearGradient colors={['rgba(124,77,255,0.28)','rgba(124,77,255,0.0)']} start={{x:0.1,y:0}} end={{x:0.9,y:1}}
      style={{ position:'absolute', width:320, height:320, borderRadius:160, top:-80, left:-80 }} />
    <LinearGradient colors={['rgba(255,77,222,0.22)','rgba(255,77,222,0.0)']} start={{x:0,y:0}} end={{x:1,y:1}}
      style={{ position:'absolute', width:260, height:260, borderRadius:130, top: 220, right:-70 }} />
  </View>
);

type UserDoc = { handle?: string; displayName?: string; bio?: string; photoURL?: string | null; };
type Post = { id: string; uid: string; videoURL: string; };

export default function ProfileScreen() {
  const { uid } = useLocalSearchParams<{ uid: string }>();
  const router = useRouter();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const me = auth.currentUser?.uid || null;

  const [user, setUser] = useState<UserDoc | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [followers, setFollowers] = useState<number>(0);
  const [following, setFollowing] = useState<number>(0);
  const [iFollow, setIFollow] = useState<boolean>(false);
  const [followsMe, setFollowsMe] = useState<boolean>(false);

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
      const ranked = rankPosts(arr, { me });
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
    } catch {}
  }, [uid]);

  useEffect(() => { refreshCounts(); }, [refreshCounts]);

  // follow mutuo
  useEffect(() => {
    (async () => {
      if (!me || !uid || me === uid) { setIFollow(false); setFollowsMe(false); return; }
      const a = await getDoc(doc(db, 'follows', `${me}_${uid}`));
      const b = await getDoc(doc(db, 'follows', `${uid}_${me}`));
      setIFollow(a.exists());
      setFollowsMe(b.exists());
      ('🟣 [Profile] follow state', { me, uid, iFollow: a.exists(), followsMe: b.exists() });
    })();
  }, [me, uid]);

  const isMe = me === uid;
  const isMutual = iFollow && followsMe;

  const toggleFollow = async () => {
    if (!me || !uid || isMe) return;
    const fid = `${me}_${uid}`;
    const ref = doc(db, 'follows', fid);
    if (iFollow) {
      await deleteDoc(ref);
      setIFollow(false);
      setFollowers(n => Math.max(0, n - 1));
    } else {
      await setDoc(ref, { follower: me, following: uid, createdAt: serverTimestamp() });
      setIFollow(true);
      setFollowers(n => n + 1);
      await addDoc(collection(db, 'notifications', String(uid), 'items'), {
        type: 'follow',
        fromUid: me,
        text: 'comenzó a seguirte',
        createdAt: serverTimestamp(),
        seen: false,
      });
    }
  };

  const openMessage = async () => {
    ('🟣 [Profile] openMessage pressed', { me, uid, isMe, isMutual, segments });
    if (!me || !uid || isMe) { Alert.alert('No puedes enviarte mensajes a ti mismo'); return; }
    if (!isMutual) { Alert.alert('Sigue y que te siga para poder chatear'); return; }

    const id = await ensureThreadWith(String(uid));
    if (!id) { Alert.alert('No se pudo crear el chat'); return; }

    try {
      router.push({ pathname: '/chat/[threadId]', params: { threadId: id } });
      setTimeout(() => {
        router.push(`/chat/${id}`);
      }, 30);
    } catch (e) {
      console.error('🔴 [Profile] router.push error', e);
      Alert.alert('Error al abrir chat', String(e));
    }
  };

  const handle = user?.handle ? `@${user.handle}` : `@user-${String(uid).slice(0, 5)}`;
  const name = user?.displayName || '';

  const Header = memo(() => (
    <View style={{ paddingHorizontal: PADDING_H, marginTop: (insets.top || 12), marginBottom: 14 }}>
      <BlurView intensity={40} tint="dark" style={{ borderRadius: 22, overflow: 'hidden' }}>
        <View style={{ borderRadius: 22, borderWidth: 1, borderColor: '#1f2126', padding: 18, alignItems: 'center', backgroundColor: '#0e1015aa' }}>
          <Avatar uid={String(uid)} size={100} />
          <Text style={{ color: 'white', fontWeight: '900', fontSize: 22, marginTop: 12 }}>{handle}</Text>
          {!!name && <Text style={{ color: '#c6cbd2', marginTop: 4 }} numberOfLines={1}>{name}</Text>}

          <View style={{ flexDirection: 'row', gap: 24, marginTop: 12 }}>
            <View style={{ alignItems: 'center' }}><Text style={{ color: 'white', fontWeight: '900' }}>{followers}</Text><Text style={{ color: '#9aa0a6' }}>seguidores</Text></View>
            <View style={{ alignItems: 'center' }}><Text style={{ color: 'white', fontWeight: '900' }}>{following}</Text><Text style={{ color: '#9aa0a6' }}>siguiendo</Text></View>
          </View>

          <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 14 }}>
            <TouchableOpacity onPress={isMe ? () => router.push('/profile/edit') : toggleFollow} activeOpacity={0.9} style={{ flex: 1 }}>
              <View style={{ backgroundColor: 'white', paddingVertical: 12, borderRadius: 12, alignItems: 'center' }}>
                <Text style={{ color: 'black', fontWeight: '900' }}>{isMe ? 'Editar perfil' : iFollow ? 'Siguiendo' : 'Seguir'}</Text>
              </View>
            </TouchableOpacity>

            {!isMe && isMutual && (
              <TouchableOpacity onPress={openMessage} activeOpacity={0.9} style={{ width: 56 }}>
                <View style={{ backgroundColor: '#1d2330', borderWidth: 1, borderColor: '#2a3242', paddingVertical: 9, borderRadius: 12, alignItems: 'center' }}>
                  <Ionicons name="chatbubble-ellipses-outline" size={20} color="#fff" />
                </View>
              </TouchableOpacity>
            )}
          </View>

          {!isMe && !isMutual && followsMe && (
            <Text style={{ color: '#9aa0a6', marginTop: 8 }}>Te sigue. Síguelo para poder enviar mensajes.</Text>
          )}
        </View>
      </BlurView>
    </View>
  ));

  const GridItem = memo(({ item }: { item: Post }) => (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={() => router.push(`/watch/${uid}?sid=${item.id}`)}
      style={{
        width: TILE, height: TILE * 1.4, borderRadius: 10, overflow: 'hidden',
        backgroundColor: '#0f1116', borderWidth: 1, borderColor: '#1f232c'
      }}>
      <Video source={{ uri: item.videoURL }} style={{ width: '100%', height: '100%' }} resizeMode="cover" shouldPlay={false} isMuted />
    </TouchableOpacity>
  ));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }} edges={['top','bottom']}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
      <LinearGradient colors={['#000', '#000']} style={{ flex: 1, paddingTop: Platform.OS === 'android' ? 0 : 0 }}>
        <BackgroundDecor />

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

        <BottomNav />
      </LinearGradient>
    </SafeAreaView>
  );
}
