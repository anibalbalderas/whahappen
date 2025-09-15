// app/feed.tsx
import React, { useCallback, useEffect, useRef, useState, memo } from 'react';
import {
  View, Text, TouchableOpacity, Dimensions, FlatList, TextInput,
  KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Animated, StyleSheet
} from 'react-native';
import { Video } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { auth, db } from '../lib/firebase';
import {
  collection, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, deleteDoc,
  getDoc, addDoc, limit, updateDoc, increment
} from 'firebase/firestore';
import Avatar from '../components/Avatar';
import BottomNav from '../components/BottomNav';
import { observeMyLike, observeLikesCount, toggleLike as toggleLikeApi } from '../lib/likes';
import OverlaysRenderer from '../components/OverlaysRenderer';
import OverlaysAudio from '../components/OverlaysAudio';

const { height: SCREEN_H, width: SCREEN_W } = Dimensions.get('screen');

type Post = {
  id: string;
  uid?: string;
  videoURL: string;
  caption?: string;
  likesCount?: number;
  commentsCount?: number;
  createdAt?: any;
  challengeTag?: string;
  tag?: string;
  challenge?: string;
  edits?: any;
  trim?: { startMs: number; endMs: number };
  overlays?: any[];
  audio?: { url: string; title?: string; volume?: number } | null;
  voice?: { url: string; startMs?: number; endMs?: number; volume?: number } | null;
  muteOriginal?: boolean;
};
type UserDoc = { handle?: string; displayName?: string };

const S = StyleSheet.create({
  fill: StyleSheet.absoluteFillObject,
});

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

/** ── helpers para extraer ediciones ───────────────────────── */
function safeJSON<T = any>(x: any): T | null {
  if (!x) return null as any;
  if (typeof x === 'object') return x as T;
  if (typeof x === 'string') {
    try { return JSON.parse(x) as T; } catch { return null; }
  }
  return null;
}
function normalizeOverlays(raw: any[] | null | undefined) {
  const list = Array.isArray(raw) ? raw : [];
  return list.map((o: any) => {
    let s = o.startMs ?? o.start ?? 0;
    let e = o.endMs ?? o.end ?? (s + 2000);
    const factor = (e > 0 && e <= 600) ? 1000 : 1; // segundos → ms si vienen chicos
    return { ...o, startMs: Math.max(0, Math.round(s * factor)), endMs: Math.max(0, Math.round(e * factor)) };
  });
}
function getEditsFromPost(p: Post) {
  const editsObj = safeJSON(p.edits) || {};
  const trim = editsObj.trim ?? p.trim ?? null;
  const overlays =
    normalizeOverlays(editsObj.overlays) ||
    normalizeOverlays(p.overlays) ||
    [];
  const audio = editsObj.audio ?? p.audio ?? null;
  const voice = editsObj.voice ?? p.voice ?? null;
  const muteOriginal = !!(editsObj.muteOriginal ?? p.muteOriginal);
  return { trim, overlays, audio, voice, muteOriginal };
}

/** Fondo */
const BackgroundDecor = memo(() => (
  <View pointerEvents="none" style={S.fill}>
    <LinearGradient
      colors={['rgba(124,77,255,0.28)', 'rgba(124,77,255,0.0)']}
      start={{ x: 0.1, y: 0.0 }} end={{ x: 0.9, y: 1 }}
      style={{ position: 'absolute', width: 320, height: 320, borderRadius: 160, top: -80, left: -80 }}
    />
    <LinearGradient
      colors={['rgba(255,77,222,0.22)', 'rgba(255,77,222,0.0)']}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ position: 'absolute', width: 260, height: 260, borderRadius: 130, top: SCREEN_H * 0.25, right: -70 }}
    />
  </View>
));

/** Video + Ediciones (trim / overlays / audio) */
const VideoWithEdits = memo(function VideoWithEdits({
  item, playing, onTap,
}: { item: Post; playing: boolean; onTap: () => void }) {
  const videoRef = useRef<Video>(null);
  const [curMs, setCurMs] = useState(0);
  const seekedOnceRef = useRef(false);

  const { trim, overlays, audio: bgm, voice, muteOriginal } = getEditsFromPost(item);
  const startMs = trim?.startMs ?? 0;
  const endMs = trim?.endMs ?? Number.MAX_SAFE_INTEGER;

  const onStatus = async (st: any) => {
    if (!st?.isLoaded) return;
    const p = st.positionMillis ?? 0;
    const dur = st.durationMillis ?? Number.MAX_SAFE_INTEGER;
    const E = Math.min(endMs, dur);

    if (!seekedOnceRef.current) {
      seekedOnceRef.current = true;
      if (startMs > 0) {
        try { await videoRef.current?.setPositionAsync(startMs); } catch {}
        setCurMs(startMs);
        return;
      }
    }
    if (p < startMs - 15) { try { await videoRef.current?.setPositionAsync(startMs); } catch {}; setCurMs(startMs); return; }
    if (p > E - 40)       { try { await videoRef.current?.setPositionAsync(startMs); } catch {}; setCurMs(startMs); return; }
    setCurMs(p);
  };

  return (
    <View style={{ width: SCREEN_W, height: SCREEN_H }}>
      <TouchableWithoutFeedback onPress={onTap}>
        <Video
          ref={videoRef}
          source={{ uri: item.videoURL }}
          style={S.fill}
          resizeMode="cover"
          shouldPlay={playing}
          isLooping
          isMuted={muteOriginal}
          onPlaybackStatusUpdate={onStatus}
          progressUpdateIntervalMillis={80}
        />
      </TouchableWithoutFeedback>

      {/* overlays (textos, emojis, etc.) */}
      <View style={S.fill} pointerEvents="none">
        <OverlaysRenderer overlays={overlays} currentMs={curMs} />
      </View>

      {/* audio/voice */}
      <OverlaysAudio
        bgm={bgm ?? undefined}
        voice={voice ?? undefined}
        playing={playing}
        positionMs={curMs}
      />
    </View>
  );
});

/** Item del feed */
const PostItem = memo(function PostItem({
  item,
  playing,
  liked,
  likesCount,
  onPressAvatar,
  onToggleLike,
  onOpenComments,
  onTapVideo,
  username,
  heartStyle,
  CAPTION_BOTTOM,
  showFollowPlus,
  onPressFollowPlus,
}: {
  item: Post;
  playing: boolean;
  liked: boolean;
  likesCount: number;
  onPressAvatar: () => void;
  onToggleLike: () => void;
  onOpenComments: () => void;
  onTapVideo: () => void;
  username: string;
  heartStyle: any;
  CAPTION_BOTTOM: number;
  showFollowPlus: boolean;
  onPressFollowPlus: () => void;
}) {
  const insets = useSafeAreaInsets();
  const tag = item.challengeTag || item.tag || (item.challenge ? `#${item.challenge}` : undefined);

  return (
    <View style={{ width: SCREEN_W, height: SCREEN_H, backgroundColor: 'black' }}>
      <LinearGradient
        colors={['rgba(11,11,13,0.35)', 'rgba(0,0,0,0)']}
        style={S.fill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        pointerEvents="none"
      />

      <VideoWithEdits item={item} playing={playing} onTap={onTapVideo} />

      <Animated.View pointerEvents="none" style={[S.fill, { alignItems: 'center', justifyContent: 'center' }, heartStyle]}>
        <Ionicons name="heart" size={120} color="#ff2d55" />
      </Animated.View>

      {/* buscar */}
      <View style={{ position:'absolute', top:(insets.top||12)+8, right:12, zIndex:20 }}>
        <TouchableOpacity onPress={()=>useRouter().push('/search')} hitSlop={{top:8,bottom:8,left:8,right:8}}>
          <Ionicons name="search" size={30} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* texto izquierda */}
      <View style={{ position: 'absolute', left: 14, bottom: CAPTION_BOTTOM, right: 110 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <TouchableOpacity onPress={onPressAvatar}>
            <Text style={{ color: 'white', fontWeight: '900' }}>{username}</Text>
          </TouchableOpacity>
          {!!tag && (
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: '#ffffff22' }}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{tag}</Text>
            </View>
          )}
        </View>
        {!!item.caption && <Text style={{ color: 'white' }} numberOfLines={2}>{item.caption}</Text>}
      </View>

      {/* columna derecha */}
      <View style={{ position: 'absolute', right: 10, top: SCREEN_H * 0.54, alignItems: 'center' }}>
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <TouchableOpacity onPress={onPressAvatar} activeOpacity={0.9} style={{ position: 'relative' }}>
            {!!item.uid && <Avatar uid={item.uid} size={42} />}
            {showFollowPlus && (
              <TouchableOpacity
                onPress={onPressFollowPlus}
                activeOpacity={0.9}
                style={{
                  position: 'absolute',
                  right: -6, bottom: -6,
                  width: 22, height: 22, borderRadius: 11,
                  backgroundColor: '#ff2d55',
                  alignItems: 'center', justifyContent: 'center',
                  borderWidth: 2, borderColor: '#fff'
                }}
              >
                <Ionicons name="add" size={14} color="#fff" />
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={onToggleLike} activeOpacity={0.8} style={{ alignItems: 'center', marginBottom: 18 }}>
          <Ionicons name={liked ? 'heart' : 'heart-outline'} size={32} color={liked ? '#ff2d55' : 'white'} />
          <Text style={{ color: 'white', marginTop: 4 }}>{likesCount}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onOpenComments} activeOpacity={0.8} style={{ alignItems: 'center', marginBottom: 18 }}>
          <Ionicons name="chatbubble-outline" size={30} color="white" />
          <Text style={{ color: 'white', marginTop: 4 }}>{item.commentsCount || 0}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => { /* compartir */ }} activeOpacity={0.8} style={{ alignItems: 'center' }}>
          <Ionicons name="share-outline" size={28} color="white" />
        </TouchableOpacity>
      </View>
    </View>
  );
});

export default function Feed() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const me = auth.currentUser?.uid || null;

  const CAPTION_BOTTOM = (insets.bottom || 12) + 90;

  const [posts, setPosts] = useState<Post[]>([]);
  const [active, setActive] = useState(0);

  const likeUnsubRef = useRef<(() => void) | null>(null);
  const countUnsubRef = useRef<(() => void) | null>(null);
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});
  const [countMap, setCountMap] = useState<Record<string, number>>({});

  const [authors, setAuthors] = useState<Record<string, UserDoc>>({});
  const [followingMap, setFollowingMap] = useState<Record<string, boolean>>({});

  // Comentarios
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, any[]>>({});
  const [newComment, setNewComment] = useState('');
  const [meDoc, setMeDoc] = useState<any>(null);

  // Pausa por tap
  const [pausedId, setPausedId] = useState<string | null>(null);

  // doble tap like
  const lastTapRef = useRef<number>(0);
  const bigLike = useRef(new Animated.Value(0)).current;

  const pulseHeart = () => {
    bigLike.stopAnimation(); bigLike.setValue(0);
    Animated.sequence([
      Animated.timing(bigLike, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.timing(bigLike, { toValue: 0, duration: 260, delay: 320, useNativeDriver: true }),
    ]).start();
  };
  const heartStyle = { opacity: bigLike, transform: [{ scale: bigLike.interpolate({ inputRange:[0,1], outputRange:[0.6,1] }) }] };

  const scoreOf = useCallback((p: Post) => {
    const likes = p.likesCount ?? 0;
    const commentsN = p.commentsCount ?? 0;
    const ms = p.createdAt?.toMillis?.() ?? (typeof p.createdAt === 'number' ? p.createdAt : 0);
    const ageHours = ms ? Math.max(0, (Date.now() - ms) / 36e5) : 1e6;
    const recency = 1 / (1 + ageHours / 48);
    const engagement = likes * 5 + commentsN * 8;
    const isMyFresh = me && p.uid === me && ageHours <= (5/60);
    return engagement * (1 + 2 * recency) + (isMyFresh ? 1000 : 0);
  }, [me]);

  // cargar feed
  useEffect(() => {
    const qy = query(collection(db, 'submissions'), orderBy('createdAt', 'desc'), limit(50));
    const unsub = onSnapshot(qy, (snap) => {
      const docs = snap?.docs ?? [];
      let arr: Post[] = docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      arr.sort((a, b) => scoreOf(b) - scoreOf(a));
      setPosts(arr);

      setCountMap(m => {
        const mm = { ...m };
        arr.forEach(p => { mm[p.id] = p.likesCount ?? mm[p.id] ?? 0; });
        return mm;
      });

      // perfiles
      arr.forEach(p => {
        if (p?.uid && !authors[p.uid]) {
          onSnapshot(doc(db, 'users', p.uid), (s2) =>
            setAuthors(prev => ({ ...prev, [p.uid]: (s2.data() as any) || {} }))
          );
        }
      });
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoreOf]);

  // like/contador del activo
  const primeActiveLike = useCallback((postId?: string) => {
    likeUnsubRef.current?.();
    countUnsubRef.current?.();
    if (!postId) return;
    likeUnsubRef.current = observeMyLike(postId, (liked) => setLikedMap(m => ({ ...m, [postId]: liked }))) || null;
    countUnsubRef.current = observeLikesCount(postId, (n) => setCountMap(m => ({ ...m, [postId]: n })));
  }, []);
  useEffect(() => { primeActiveLike(posts[active]?.id); }, [posts, active, primeActiveLike]);

  // estado follow
  const ensureFollowingState = useCallback(async (authorUid?: string) => {
    if (!me || !authorUid || me === authorUid || followingMap[authorUid] !== undefined) return;
    const snap = await getDoc(doc(db, 'follows', `${me}_${authorUid}`));
    setFollowingMap(m => ({ ...m, [authorUid]: snap.exists() }));
  }, [me, followingMap]);
  useEffect(() => { const p = posts[active]; if (p?.uid) ensureFollowingState(p.uid); }, [posts, active, ensureFollowingState]);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    const idx = viewableItems?.[0]?.index ?? 0;
    setActive(idx);
    // al cambiar de post, quitamos pausa
    setPausedId(null);
  }).current;

  const toggleFollow = async (authorUid?: string) => {
    if (!me || !authorUid || me === authorUid) return;
    const fid = `${me}_${authorUid}`;
    const ref = doc(db, 'follows', fid);
    const following = !!followingMap[authorUid];
    setFollowingMap(m => ({ ...m, [authorUid]: !following }));
    if (following) await deleteDoc(ref);
    else {
      await setDoc(ref, { follower: me, following: authorUid, createdAt: serverTimestamp() });
      await addDoc(collection(db, 'notifications', authorUid, 'items'), {
        type: 'follow', fromUid: me, text: 'comenzó a seguirte', createdAt: serverTimestamp(), seen: false,
      });
    }
  };

  // Likes
  const toggleLike = async (post: Post) => {
    if (!me) return;
    const newState = await toggleLikeApi(post.id);
    setLikedMap(s => ({ ...s, [post.id]: newState }));
    setCountMap(c => ({ ...c, [post.id]: Math.max(0, (c[post.id] ?? 0) + (newState ? 1 : -1)) }));
    if (newState && post.uid && post.uid !== me) {
      await addDoc(collection(db, 'notifications', post.uid, 'items'), {
        type: 'like', fromUid: me, postId: post.id, text: 'le gustó tu video', createdAt: serverTimestamp(), seen: false,
      });
      pulseHeart();
    }
  };

  // mi doc
  useEffect(() => {
    if (!me) return;
    return onSnapshot(doc(db, 'users', me), (snap) => setMeDoc(snap.data()));
  }, [me]);

  // abrir comentarios
  const openCommentsForPost = (postId: string) => {
    setOpenComments(postId);
    if (!comments[postId]) {
      onSnapshot(
        query(collection(db, 'submissions', postId, 'comments'), orderBy('createdAt', 'desc')),
        (snap) => setComments(prev => ({ ...prev, [postId]: snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) }))
      );
    }
  };

  const sendComment = async (post: Post) => {
    if (!me || !newComment.trim()) return;
    const username = meDoc?.handle || meDoc?.displayName || `user-${me.slice(0, 6)}`;
    await addDoc(collection(db, 'submissions', post.id, 'comments'), {
      uid: me, username, text: newComment.trim(), createdAt: serverTimestamp(),
    });
    setNewComment('');
    await updateDoc(doc(db, 'submissions', post.id), { commentsCount: increment(+1) } as any);
  };

  const usernameFor = (uid?: string) => {
    if (!uid) return '@user';
    const u = authors[uid] || {};
    if (u?.handle) return `@${u.handle}`;
    if (u?.displayName) return `@${u.displayName}`;
    return `@user-${uid.slice(0, 5)}`;
  };

  // Sheet de comentarios con backdrop que cierra al tocar fuera
  const CommentSheet = memo(({ postId }: { postId: string }) => {
    const list = comments[postId] || [];
    const post = posts.find(p => p.id === postId)!;
    return (
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: 'padding', android: undefined })}
        keyboardVerticalOffset={(insets.top || 0) + 8}
        style={{
          position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
          zIndex: 9999,
          justifyContent: 'flex-end',
        }}
      >
        {/* Backdrop tocable */}
        <TouchableWithoutFeedback onPress={() => setOpenComments(null)}>
          <View style={{ flex: 1, backgroundColor: '#00000066' }} />
        </TouchableWithoutFeedback>

        {/* Sheet */}
        <View style={{
          backgroundColor: '#0f1116f2',
          borderTopLeftRadius: 18, borderTopRightRadius: 18,
          paddingTop: 10, paddingBottom: (insets.bottom || 12) + 90,
        }}>
          <View style={{ alignItems: 'center', marginBottom: 6 }}>
            <View style={{ width: 60, height: 6, borderRadius: 3, backgroundColor: '#2a2e36' }} />
          </View>
          <Text style={{ color: '#fff', fontWeight: '900', fontSize: 20, paddingHorizontal: 16, marginBottom: 4 }}>
            Comentarios ({list.length})
          </Text>

          <View style={{ maxHeight: SCREEN_H * 0.6 }}>
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
                          <Text style={{ color: '#fff', fontWeight: '900' }}>{c?.username ? `@${c.username}` : usernameFor(c.uid)}</Text>
                        </TouchableOpacity>
                        {!!ts && <Text style={{ color: '#9aa0a6' }}>{timeAgo(ts)}</Text>}
                      </View>
                      <View style={{ backgroundColor: '#171a20', borderColor: '#242834', borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14 }}>
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
              style={{ flex: 1, backgroundColor: '#13161c', color: 'white', borderRadius: 18, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: '#252a36' }}
            />
            <TouchableOpacity onPress={() => sendComment(post)} activeOpacity={0.8}>
              <Ionicons name="send" size={22} color="white" />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    );
  });

  // tap en video: single → pausa/reanuda; double → like
  const handleTapVideo = (post: Post) => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) { // doble tap
      toggleLike(post);
      pulseHeart();
      lastTapRef.current = 0;
      return;
    }
    lastTapRef.current = now;

    if (openComments) { setOpenComments(null); return; }
    setPausedId((cur) => (cur === post.id ? null : post.id));
  };

  const renderItem = ({ item, index }: { item: Post; index: number }) => {
    const isActive = index === active;
    const playing = isActive && pausedId !== item.id;
    const liked = !!likedMap[item.id];
    const likesCount = countMap[item.id] ?? item.likesCount ?? 0;
    const authorName = usernameFor(item.uid);

    const canFollow = !!(me && item.uid && me !== item.uid);
    const isFollowing = !!(item.uid && followingMap[item.uid]);
    const showFollowPlus = canFollow && !isFollowing;

    return (
      <View style={{ width: SCREEN_W, height: SCREEN_H, backgroundColor: 'black' }}>
        <PostItem
          item={item}
          playing={playing}
          liked={liked}
          likesCount={likesCount}
          onPressAvatar={() => item.uid && router.push(`/profile/${item.uid}`)}
          onToggleLike={() => toggleLike(item)}
          onOpenComments={() => openCommentsForPost(item.id)}
          onTapVideo={() => handleTapVideo(item)}
          username={authorName}
          heartStyle={heartStyle}
          CAPTION_BOTTOM={CAPTION_BOTTOM}
          showFollowPlus={showFollowPlus}
          onPressFollowPlus={() => toggleFollow(item.uid)}
        />
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <BackgroundDecor />

      <FlatList
        data={posts}
        pagingEnabled
        decelerationRate="fast"
        snapToInterval={SCREEN_H}
        snapToAlignment="start"
        showsVerticalScrollIndicator={false}
        keyExtractor={(x) => x.id}
        renderItem={renderItem}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 80 }}
        windowSize={4}
        initialNumToRender={3}
        removeClippedSubviews
        getItemLayout={(_, index) => ({ length: SCREEN_H, offset: SCREEN_H * index, index })}
      />

      {openComments && <CommentSheet postId={openComments} />}

      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 1 }}
      >
        <BottomNav />
      </View>
    </View>
  );
}
