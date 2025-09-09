// app/feed.tsx
import React, { useCallback, useEffect, useRef, useState, memo } from 'react';
import {
  View, Text, TouchableOpacity, Dimensions, FlatList, TextInput,
  KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Animated
} from 'react-native';
import { Video } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { auth, db } from '../lib/firebase';
import {
  collection, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, deleteDoc,
  getDoc, addDoc, limit, increment, updateDoc
} from 'firebase/firestore';
import Avatar from '../components/Avatar';

const { height, width } = Dimensions.get('window');

type Post = {
  id: string;
  uid: string;
  videoURL: string;
  caption?: string;
  challengeTag?: string;
  tag?: string;
  challenge?: string;
  likesCount?: number;
  commentsCount?: number;
  createdAt?: any;
};

type UserDoc = { handle?: string; displayName?: string };

function timeAgo(d?: Date) {
  if (!d) return '';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const dd = Math.floor(h / 24);
  return `${dd}d`;
}

/** 🔮 Fondo decorativo estilo login/register (blobs morados/fucsia/azul) */
const BackgroundDecor = memo(() => (
  <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
    {/* Blob morado arriba-izq */}
    <LinearGradient
      colors={['rgba(124,77,255,0.28)', 'rgba(124,77,255,0.0)']}
      start={{ x: 0.1, y: 0.0 }} end={{ x: 0.9, y: 1 }}
      style={{
        position: 'absolute', width: 320, height: 320, borderRadius: 160,
        top: -80, left: -80, transform: [{ rotate: '18deg' }]
      }}
    />
    {/* Blob fucsia centro-der */}
    <LinearGradient
      colors={['rgba(255,77,222,0.22)', 'rgba(255,77,222,0.0)']}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{
        position: 'absolute', width: 260, height: 260, borderRadius: 130,
        top: height * 0.25, right: -70, transform: [{ rotate: '-12deg' }]
      }}
    />
    {/* Halo azul abajo */}
    <LinearGradient
      colors={['rgba(0,210,255,0.18)', 'rgba(0,210,255,0.0)']}
      start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }}
      style={{
        position: 'absolute', width: 420, height: 420, borderRadius: 210,
        bottom: -140, left: width * 0.15, transform: [{ rotate: '25deg' }]
      }}
    />
  </View>
));

export default function Feed() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const me = auth.currentUser?.uid || null;

  const [posts, setPosts] = useState<Post[]>([]);
  const [active, setActive] = useState(0);
  const [likes, setLikes] = useState<Record<string, boolean>>({});
  const [localCounts, setLocalCounts] = useState<Record<string, { likes: number; comments: number }>>({});
  const [authors, setAuthors] = useState<Record<string, UserDoc>>({});
  const [followingMap, setFollowingMap] = useState<Record<string, boolean>>({});
  const [openCommentsFor, setOpenCommentsFor] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, any[]>>({});
  const [newComment, setNewComment] = useState('');
  const lastTapRef = useRef<number>(0);

  // ❤️ overlay anim
  const bigLike = useRef(new Animated.Value(0)).current;
  const pulseHeart = () => {
    bigLike.stopAnimation();
    bigLike.setValue(0);
    Animated.sequence([
      Animated.timing(bigLike, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.timing(bigLike, { toValue: 0, duration: 260, delay: 320, useNativeDriver: true }),
    ]).start();
  };
  const heartStyle = {
    opacity: bigLike,
    transform: [{ scale: bigLike.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
  };

  // Feed
  useEffect(() => {
    const qy = query(collection(db, 'submissions'), orderBy('createdAt', 'desc'), limit(30));
    const unsub = onSnapshot(qy, (snap) => {
      let arr = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Post[];
      if (me) arr = [...arr].sort((a, b) => (a.uid === me ? -1 : 0) - (b.uid === me ? -1 : 0));
      setPosts(arr);

      const lc: Record<string, { likes: number; comments: number }> = {};
      arr.forEach(p => lc[p.id] = { likes: p.likesCount || 0, comments: p.commentsCount || 0 });
      setLocalCounts(lc);

      arr.forEach(p => {
        if (!authors[p.uid]) {
          onSnapshot(doc(db, 'users', p.uid), (snap2) => {
            setAuthors(prev => ({ ...prev, [p.uid]: (snap2.data() as any) || {} }));
          });
        }
      });
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  const primeLikes = useCallback(async (post: Post) => {
    if (!me) return;
    const likeDoc = await getDoc(doc(db, 'submissions', post.id, 'likes', me));
    setLikes(prev => ({ ...prev, [post.id]: likeDoc.exists() }));
  }, [me]);

  useEffect(() => {
    const p = posts[active];
    if (p) primeLikes(p);
  }, [active, posts, primeLikes]);

  const ensureFollowingState = useCallback(async (authorUid: string) => {
    if (!me || me === authorUid || followingMap[authorUid] !== undefined) return;
    const snap = await getDoc(doc(db, 'follows', `${me}_${authorUid}`));
    setFollowingMap(m => ({ ...m, [authorUid]: snap.exists() }));
  }, [me, followingMap]);

  useEffect(() => {
    const p = posts[active];
    if (p) ensureFollowingState(p.uid);
  }, [posts, active, ensureFollowingState]);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    const idx = viewableItems?.[0]?.index ?? 0;
    setActive(idx);
  }).current;

  const toggleFollow = async (authorUid: string) => {
    if (!me || me === authorUid) return;
    const fid = `${me}_${authorUid}`;
    const ref = doc(db, 'follows', fid);
    const following = !!followingMap[authorUid];
    setFollowingMap(m => ({ ...m, [authorUid]: !following }));
    if (following) await deleteDoc(ref);
    else await setDoc(ref, { follower: me, following: authorUid, createdAt: serverTimestamp() });
  };

  // Likes
  const toggleLike = async (post: Post) => {
    if (!me) return;
    const liked = !!likes[post.id];
    const likeRef = doc(db, 'submissions', post.id, 'likes', me);
    const subRef = doc(db, 'submissions', post.id);

    setLikes(s => ({ ...s, [post.id]: !liked }));
    setLocalCounts(c => ({
      ...c,
      [post.id]: { ...c[post.id], likes: Math.max(0, c[post.id].likes + (liked ? -1 : +1)) }
    }));

    if (liked) {
      await deleteDoc(likeRef);
      await updateDoc(subRef, { likesCount: increment(-1) } as any);
    } else {
      await setDoc(likeRef, { uid: me, createdAt: serverTimestamp() });
      await updateDoc(subRef, { likesCount: increment(+1) } as any);
      pulseHeart();
    }
  };

  const handleDoubleTap = (post: Post) => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      toggleLike(post);
      pulseHeart();
    }
    lastTapRef.current = now;
  };

  // Comentarios
  const openComments = (postId: string) => {
    setOpenCommentsFor(postId);
    if (!comments[postId]) {
      onSnapshot(
        query(collection(db, 'submissions', postId, 'comments'), orderBy('createdAt', 'desc')),
        (snap) => setComments(prev => ({ ...prev, [postId]: snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) }))
      );
    }
  };
  const tapVideo = () => { if (openCommentsFor) setOpenCommentsFor(null); };

  const [meDoc, setMeDoc] = useState<any>(null);
  useEffect(() => {
    if (!me) return;
    return onSnapshot(doc(db, 'users', me), (snap) => setMeDoc(snap.data()));
  }, [me]);

  const sendComment = async (post: Post) => {
    if (!me || !newComment.trim()) return;
    const username = meDoc?.handle || meDoc?.displayName || `user-${me.slice(0, 6)}`;
    await addDoc(collection(db, 'submissions', post.id, 'comments'), {
      uid: me, username, text: newComment.trim(), createdAt: serverTimestamp(),
    });
    setNewComment('');
    await updateDoc(doc(db, 'submissions', post.id), { commentsCount: increment(+1) } as any);
    setLocalCounts(c => ({
      ...c,
      [post.id]: { ...c[post.id], comments: Math.max(0, (c[post.id]?.comments || 0) + 1) }
    }));
  };

  const usernameFor = (uid: string, inline?: boolean) => {
    const u = authors[uid] || {};
    if (u?.handle) return inline ? `@${u.handle}` : `@${u.handle}`;
    if (u?.displayName) return inline ? `@${u.displayName}` : `@${u.displayName}`;
    return inline ? `@user-${uid.slice(0, 5)}` : `@user`;
  };

  // --- UI: Comentarios (sin cambios de lógica) ---
  const CommentSheet = memo(({ postId }: { postId: string }) => {
    const list = comments[postId] || [];
    return (
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: 'padding', android: undefined })}
        keyboardVerticalOffset={(insets.top || 0) + 8}
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          backgroundColor: '#0f1116ee',
          borderTopLeftRadius: 18, borderTopRightRadius: 18,
          paddingTop: 10, paddingBottom: (insets.bottom || 12) + 22
        }}>
        <View style={{ alignItems: 'center', marginBottom: 6 }}>
          <View style={{ width: 60, height: 6, borderRadius: 3, backgroundColor: '#2a2e36' }} />
        </View>
        <Text style={{ color: '#fff', fontWeight: '900', fontSize: 20, paddingHorizontal: 16, marginBottom: 4 }}>
          Comentarios ({localCounts[postId]?.comments ?? list.length})
        </Text>

        <View style={{ height: height * 0.30 }}>
          <FlatList
            inverted
            data={list}
            keyExtractor={(c: any) => c.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }}
            renderItem={({ item: c }: any) => {
              const ts = c?.createdAt?.toDate?.() as Date | undefined;
              return (
                <View style={{ flexDirection: 'row', gap: 10, paddingVertical: 10 }}>
                  <Avatar uid={c.uid} size={36} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <TouchableOpacity onPress={() => router.push(`/profile/${c.uid}`)}>
                        <Text style={{ color: '#fff', fontWeight: '900' }}>
                          {c?.username ? `@${c.username}` : usernameFor(c.uid, true)}
                        </Text>
                      </TouchableOpacity>
                      {!!ts && <Text style={{ color: '#9aa0a6' }}>{timeAgo(ts)}</Text>}
                    </View>
                    <View style={{
                      backgroundColor: '#171a20',
                      borderColor: '#242834',
                      borderWidth: 1,
                      paddingHorizontal: 14, paddingVertical: 10,
                      borderRadius: 14
                    }}>
                      <Text style={{ color: '#e6e6e6' }}>{c.text}</Text>
                    </View>
                  </View>
                </View>
              );
            }}
          />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginTop: 8 }}>
          <TextInput
            value={newComment}
            onChangeText={setNewComment}
            placeholder="Escribe un comentario..."
            placeholderTextColor="#8a8f98"
            style={{
              flex: 1, backgroundColor: '#13161c', color: 'white',
              borderRadius: 18, paddingHorizontal: 16, paddingVertical: 12,
              borderWidth: 1, borderColor: '#252a36'
            }}
          />
          <TouchableOpacity onPress={() => sendComment(posts.find(p => p.id === postId)!)} activeOpacity={0.8}>
            <Ionicons name="send" size={22} color="white" />
          </TouchableOpacity>
        </View>
        <View style={{ height: (insets.bottom || 0) + 8 }} />
      </KeyboardAvoidingView>
    );
  });

  const renderItem = ({ item, index }: { item: Post; index: number }) => {
    const playing = index === active;
    const liked = !!likes[item.id];
    const count = localCounts[item.id] || { likes: item.likesCount || 0, comments: item.commentsCount || 0 };
    const authorName = usernameFor(item.uid, true);
    const tag = item.challengeTag || item.tag || (item.challenge ? `#${item.challenge}` : undefined);

    return (
      <View style={{ width, height, backgroundColor: 'black' }}>
        {/* Overlay suave para tintar el video, no tapa interacción */}
        <LinearGradient
          colors={['rgba(11,11,13,0.35)', 'rgba(0,0,0,0)']}
          style={{ position: 'absolute', width, height }}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        />
        <TouchableWithoutFeedback onPress={() => { handleDoubleTap(item); tapVideo(); }}>
          <Video
            source={{ uri: item.videoURL }}
            style={{ width, height }}
            resizeMode="cover"
            shouldPlay={playing}
            isLooping
            isMuted={false}
          />
        </TouchableWithoutFeedback>

        {/* Corazón grande */}
        <Animated.View pointerEvents="none" style={{
          position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
          alignItems: 'center', justifyContent: 'center', ...heartStyle
        }}>
          <Ionicons name="heart" size={120} color="#ff2d55" />
        </Animated.View>

        {/* Info (username + caption + hashtag) */}
        <View style={{ position: 'absolute', left: 14, bottom: 72, right: 110 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <TouchableOpacity onPress={() => router.push(`/profile/${item.uid}`)}>
              <Text style={{ color: 'white', fontWeight: '900' }}>{authorName}</Text>
            </TouchableOpacity>
            {!!tag && (
              <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: '#ffffff22' }}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{tag}</Text>
              </View>
            )}
          </View>
          {!!item.caption && <Text style={{ color: 'white' }} numberOfLines={2}>{item.caption}</Text>}
        </View>

        {/* Columna derecha */}
        <View style={{ position: 'absolute', right: 10, top: height * 0.54, alignItems: 'center' }}>
          <TouchableOpacity onPress={() => router.push(`/profile/${item.uid}`)} style={{ alignItems: 'center', marginBottom: 16 }}>
            <Avatar uid={item.uid} size={42} />
            {me && me !== item.uid && !followingMap[item.uid] && (
              <View style={{
                position: 'absolute', bottom: -4, right: 8, width: 18, height: 18,
                borderRadius: 9, backgroundColor: '#ff2d55', borderWidth: 2, borderColor: '#000',
                alignItems: 'center', justifyContent: 'center'
              }}>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '900', lineHeight: 16 }}>+</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => toggleLike(item)} activeOpacity={0.8} style={{ alignItems: 'center', marginBottom: 18 }}>
            <Ionicons name={liked ? 'heart' : 'heart-outline'} size={32} color={liked ? '#ff2d55' : 'white'} />
            <Text style={{ color: 'white', marginTop: 4 }}>{count.likes}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => openComments(item.id)} activeOpacity={0.8} style={{ alignItems: 'center', marginBottom: 18 }}>
            <Ionicons name="chatbubble-outline" size={30} color="white" />
            <Text style={{ color: 'white', marginTop: 4 }}>{count.comments}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => { /* compartir */ }} activeOpacity={0.8} style={{ alignItems: 'center' }}>
            <Ionicons name="share-outline" size={28} color="white" />
          </TouchableOpacity>
        </View>

        {/* Comentarios */}
        {openCommentsFor === item.id && <CommentSheet postId={item.id} />}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <BackgroundDecor />
      <FlatList
        data={posts}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        keyExtractor={(x) => x.id}
        renderItem={renderItem}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 80 }}
        windowSize={4}
        initialNumToRender={3}
        removeClippedSubviews
      />
    </View>
  );
}
