// app/watch/[uid].tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, useWindowDimensions, FlatList, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Animated,
  Keyboard, StyleSheet, Modal, StatusBar
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Video } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';

import { auth, db } from '../../lib/firebase';
import {
  addDoc, collection, deleteDoc, doc, getDoc, getCountFromServer, increment, limit,
  onSnapshot, orderBy, query, runTransaction, serverTimestamp, updateDoc, where
} from 'firebase/firestore';

import Avatar from '../../components/Avatar';
import BottomNav from '../../components/BottomNav';
import OverlaysRenderer from '../../components/OverlaysRenderer';
import OverlaysAudio from '../../components/OverlaysAudio';
import { observeLikesCount, observeMyLike, toggleLike as toggleLikeApi } from '../../lib/likes';

const S = StyleSheet.create({ fill: StyleSheet.absoluteFillObject });

// ---------- TIPOS ----------
type Post = {
  id: string;
  uid: string;
  username?: string;
  videoURL: string;
  caption?: string;
  challenge?: string;
  challengeTag?: string;
  overlays?: any;
  audio?: any;
  createdAt?: any;
  likes?: number;
  views?: number;
};

type UserDoc = {
  handle?: string;
  displayName?: string;
  photoURL?: string;
  followersCount?: number;
  followingCount?: number;
};

const usernameFor = (uid: string, authors: Record<string, UserDoc> = {}) => {
  const u = authors[uid];
  return u?.handle || u?.displayName || `user-${uid.slice(0, 6)}`;
};

// ---------- MODAL COMENTARIOS ----------
function CommentsModal({
  visible, post, comments, onClose, onSend, insets,
}: {
  visible: boolean; post: Post | null; comments: any[];
  onClose: () => void; onSend: (text: string) => void;
  insets: { top: number; bottom: number } & any;
}) {
  const { height: H } = useWindowDimensions();
  const [text, setText] = useState('');
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [visible]);

  if (!visible || !post) return null;
  const COMPOSER_H = 56;

  return (
    <Modal visible animationType="slide" transparent statusBarTranslucent presentationStyle="overFullScreen" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={(insets.top || 0) + 8}
        style={{ flex: 1 }}
      >
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={{ position:'absolute', left:0, right:0, top:0, bottom:0, backgroundColor:'#00000066' }} />
        </TouchableWithoutFeedback>

        <View
          style={{
            position:'absolute', left:0, right:0, bottom:0,
            backgroundColor:'#0f1116f2',
            borderTopLeftRadius:18, borderTopRightRadius:18,
            paddingTop:10,
            paddingBottom:(insets.bottom || 12) + 10,
            maxHeight: H * 0.7,
          }}
        >
          <View style={{ alignItems:'center', marginBottom:6 }}>
            <View style={{ width:60, height:6, borderRadius:3, backgroundColor:'#2a2e36' }} />
          </View>

          <Text style={{ color:'#fff', fontWeight:'900', fontSize:20, paddingHorizontal:16, marginBottom:4 }}>
            Comentarios ({comments.length})
          </Text>

          <FlatList
            inverted
            data={comments}
            keyExtractor={(c:any) => c.id}
            keyboardShouldPersistTaps="always"
            contentContainerStyle={{ paddingHorizontal:16, paddingBottom:8 }}
            renderItem={({ item:c }:any) => (
              <View style={{ flexDirection:'row', gap:10, paddingVertical:10 }}>
                <Avatar uid={c.uid} size={36} />
                <View style={{ flex:1 }}>
                  <View style={{ flexDirection:'row', alignItems:'baseline', gap:8 }}>
                    <Text style={{ color:'#9aa0a6', fontWeight:'800' }}>{c.username || usernameFor(c.uid)}</Text>
                    <Text style={{ color:'#6e7681', fontSize:12 }}>{new Date(c.createdAt?.toMillis?.() || Date.now()).toLocaleString()}</Text>
                  </View>
                  <Text style={{ color:'#fff' }}>{c.text}</Text>
                </View>
              </View>
            )}
          />

          <View style={{ flexDirection:'row', alignItems:'center', gap:10, paddingHorizontal:16, height:COMPOSER_H }}>
            <TextInput
              ref={inputRef}
              autoFocus
              showSoftInputOnFocus
              placeholder="Escribe un comentario…"
              placeholderTextColor="#8a8f98"
              style={{ flex:1, backgroundColor:'#13161c', color:'#fff', borderRadius:12, paddingHorizontal:16, paddingVertical:12, borderWidth:1, borderColor:'#252a36' }}
              returnKeyType="send"
              onSubmitEditing={(e) => {
                const v = e.nativeEvent.text?.trim();
                if (v) onSend(v);
              }}
            />
            <TouchableOpacity onPress={() => {
              if (inputRef.current) {
                const v = (inputRef.current as any)._lastNativeText?.trim?.() || '';
                if (v) onSend(v);
              }
            }} activeOpacity={0.9}>
              <View style={{ backgroundColor:'#fff', paddingHorizontal:16, paddingVertical:10, borderRadius:12 }}>
                <Text style={{ color:'#000', fontWeight:'900' }}>Enviar</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function Watch() {
  const { height: H, width: W } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ uid?: string }>();
  const me = auth.currentUser?.uid || null;

  const [items, setItems] = useState<Post[]>([]);
  const [active, setActive] = useState(0);
  const [authors, setAuthors] = useState<Record<string, UserDoc>>({});
  const [followingMap, setFollowingMap] = useState<Record<string, boolean>>({});

  const likeUnsubRef = useRef<(() => void) | null>(null);
  const countUnsubRef = useRef<(() => void) | null>(null);
  const docUnsubRef = useRef<(() => void) | null>(null);
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});
  const [likesCountMap, setLikesCountMap] = useState<Record<string, number>>({});
  const [rowH, setRowH] = useState<number | null>(null);

  const [viewsMap, setViewsMap] = useState<Record<string, number>>({});
  const [openCommentsFor, setOpenCommentsFor] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, any[]>>({});
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [pausedId, setPausedId] = useState<string | null>(null);
  const [bgmByPost, setBgmByPost] = useState<Record<string, any>>({});

  // ✅ mapa global (por componente) para la posición de reproducción por postId
  const msByPost = useRef<Record<string, number>>({});

  // teclado
  useEffect(() => {
    const sh = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
    const hd = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => { sh.remove(); hd.remove(); };
  }, []);

  // cargar items (por uid o feed general)
  useEffect(() => {
    let unsub: any = null;
    (async () => {
      const uid = params.uid;
      if (uid) {
        const q = query(collection(db, 'submissions'), where('uid', '==', uid), orderBy('createdAt', 'desc'), limit(40));
        unsub = onSnapshot(q, async (snap) => {
          const arr: Post[] = [];
          const au: Record<string, UserDoc> = {};
          for (const docSnap of snap.docs) {
            const d = docSnap.data() as any;
            arr.push({ id: docSnap.id, ...d });
            if (d?.uid && !au[d.uid]) {
              const us = await getDoc(doc(db, 'users', d.uid));
              if (us.exists()) au[d.uid] = us.data() as UserDoc;
            }
          }
          setItems(arr);
          setAuthors(au);
        });
      } else {
        const q = query(collection(db, 'submissions'), orderBy('createdAt', 'desc'), limit(40));
        unsub = onSnapshot(q, async (snap) => {
          const arr: Post[] = [];
          const au: Record<string, UserDoc> = {};
          for (const docSnap of snap.docs) {
            const d = docSnap.data() as any;
            arr.push({ id: docSnap.id, ...d });
            if (d?.uid && !au[d.uid]) {
              const us = await getDoc(doc(db, 'users', d.uid));
              if (us.exists()) au[d.uid] = us.data() as UserDoc;
            }
          }
          setItems(arr);
          setAuthors(au);
        });
      }
    })();
    return () => { if (unsub) unsub(); };
  }, [params.uid]);

  const primeActive = useCallback((postId?: string) => {
    likeUnsubRef.current?.(); countUnsubRef.current?.(); docUnsubRef.current?.();
    if (!postId) return;

    likeUnsubRef.current = observeMyLike(postId, (liked) => setLikedMap(m => ({ ...m, [postId]: liked }))) || null;
    countUnsubRef.current = observeLikesCount(postId, (n) => setLikesCountMap(m => ({ ...m, [postId]: n })));
    docUnsubRef.current = onSnapshot(doc(db, 'submissions', postId), async (s) => {
      const d = s.data() as Post | undefined;
      try {
        const cntSnap = await getCountFromServer(collection(db, 'submissions', postId, 'views'));
        const total = Number(cntSnap.data().count || 0);
        setViewsMap(m => ({ ...m, [postId]: total }));
      } catch {
        const v = d?.viewsFromOthersCount ?? d?.viewsCount ?? 0;
        setViewsMap(m => ({ ...m, [postId]: v }));
      }
    });
  }, []);
  useEffect(() => { if (!openCommentsFor) primeActive(items[active]?.id); }, [items, active, primeActive, openCommentsFor]);
  useEffect(() => {
    if (openCommentsFor) { likeUnsubRef.current?.(); countUnsubRef.current?.(); }
    else { primeActive(items[active]?.id); }
  }, [openCommentsFor]);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (!viewableItems?.length) return;
    const top = viewableItems.find((v:any) => v.isViewable);
    if (top?.index != null) setActive(top.index);
  }).current;

  const toggleFollow = async (uid: string) => {
    const me = auth.currentUser?.uid || null;
    if (!me || !uid || me === uid) return;
    try {
      await runTransaction(db, async (tx) => {
        const meRef = doc(db, 'users', me);
        const otherRef = doc(db, 'users', uid);
        const meSnap = await tx.get(meRef);
        const iFollow = !!meSnap.data()?.following?.[uid];

        tx.update(meRef, {
          [`following.${uid}`]: iFollow ? deleteDoc : true,
          followingCount: increment(iFollow ? -1 : 1),
        } as any);
        tx.update(otherRef, {
          [`followers.${me}`]: iFollow ? deleteDoc : true,
          followersCount: increment(iFollow ? -1 : 1),
        } as any);
      });
      setFollowingMap(m => ({ ...m, [uid]: !m[uid] }));
    } catch {}
  };

  const onToggleLike = useCallback(async (p: Post) => {
    const me = auth.currentUser?.uid || null;
    if (!me) return;
    try { await toggleLikeApi(p.id); } catch {}
  }, []);

  const openComments = useCallback((postId: string) => {
    setOpenCommentsFor(postId);
    if (!comments[postId]) {
      onSnapshot(
        query(collection(db, 'submissions', postId, 'comments'), orderBy('createdAt', 'desc'), limit(80)),
        (snap) => {
          const arr = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
          setComments(m => ({ ...m, [postId]: arr }));
        }
      );
    }
  }, [comments]);

  const sendComment = async (post: Post, text: string) => {
    const my = auth.currentUser?.uid || null;
    if (!my || !text.trim()) return;
    const username = authors[my]?.handle || authors[my]?.displayName || `user-${my.slice(0, 6)}`;

    await addDoc(collection(db, 'submissions', post.id, 'comments'), {
      uid: my, username, text: text.trim(), createdAt: serverTimestamp(),
    });
    try {
      await updateDoc(doc(db, 'submissions', post.id), { commentsCount: increment(1) });
    } catch {}
  };

  // corazón flotante al dar like
  const heart = useRef(new Animated.Value(0)).current;
  const heartStyle = {
    opacity: heart.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
    transform: [{ scale: heart.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }],
  };
  const pulseHeart = () => {
    Animated.sequence([
      Animated.timing(heart, { toValue: 1, duration: 120, useNativeDriver: true }),
      Animated.timing(heart, { toValue: 0, duration: 240, useNativeDriver: true }),
    ]).start();
  };

  // ---------- RENDER ITEM ----------
  const renderItem = ({ item, index }: { item: Post; index: number }) => {
    const playing = openCommentsFor ? false : (pausedId ? pausedId !== item.id : index === active);
    const likesN = likesCountMap[item.id] ?? 0;
    const viewsN = viewsMap[item.id] ?? 0;
    const canFollow = !!(me && item.uid && me !== item.uid);
    const isFollowing = !!(item.uid && followingMap[item.uid]);
    const showFollowPlus = canFollow && !isFollowing;
    const tag = item.challengeTag || item.tag || (item.challenge ? `#${item.challenge}` : undefined);

    const handleTap = () => {
      const now = Date.now();
      if (now - (handleTap as any)._last < 300) { onToggleLike(item); pulseHeart(); (handleTap as any)._last = 0; return; }
      (handleTap as any)._last = now; setPausedId(p => p ? null : item.id);
    };

    // ✅ SIN hooks aquí. Guardamos posición por id en el ref global:
    const onStatus = (s: any) => {
      if ('positionMillis' in s) {
        msByPost.current[item.id] = s.positionMillis || 0;
      }
    };
    const currentMs = msByPost.current[item.id] || 0;

    // ✅ overlays siempre como arreglo (evita .map de null)
    const overlays = Array.isArray(item.overlays)
      ? item.overlays
      : (item.overlays?.layers ?? []);

    const editsObj = (item.overlays && typeof item.overlays === 'object') ? item.overlays : {};
    const bgm = (editsObj.audio?.bgm ?? null) || (bgmByPost[item.id] ?? null);

    const CAPTION_BOTTOM = (insets.bottom || 12) + 100;

    return (
      <View style={{ width: W, height: (rowH || H), backgroundColor: 'black' }}>
        <TouchableWithoutFeedback onPress={handleTap}>
          <Video
            source={{ uri: item.videoURL }}
            style={S.fill}
            resizeMode="cover"
            shouldPlay={playing}
            isLooping
            isMuted={true}
            onPlaybackStatusUpdate={onStatus}
            progressUpdateIntervalMillis={80}
          />
        </TouchableWithoutFeedback>

        <View style={S.fill} pointerEvents="none">
          <OverlaysRenderer overlays={overlays} currentMs={currentMs} />
        </View>
        <OverlaysAudio bgm={bgm ?? undefined} voice={false} />

        {/* corazón grande al dar like */}
        <Animated.View pointerEvents="none" style={[S.fill, { alignItems:'center', justifyContent:'center' }, heartStyle]}>
          <Ionicons name="heart" size={120} color="#ff2d55" />
        </Animated.View>

        {/* info izquierda */}
        <View style={{ position:'absolute', left:14, bottom: CAPTION_BOTTOM, right:110 }}>
          <View style={{ flexDirection:'row', alignItems:'center', gap:8, marginBottom:8 }}>
            <TouchableOpacity onPress={() => router.push(`/profile/${item.uid}`)} activeOpacity={0.9} style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
              <Avatar uid={item.uid} size={36} />
              <Text style={{ color:'white', fontWeight:'800', fontSize:16 }}>{usernameFor(item.uid, authors)}</Text>
            </TouchableOpacity>
            {!!tag && (
              <View style={{ paddingHorizontal:10, paddingVertical:4, borderRadius:999, backgroundColor:'#ffffff22' }}>
                <Text style={{ color:'#fff', fontWeight:'700', fontSize:12 }}>{tag}</Text>
              </View>
            )}
          </View>
          {!!item.caption && <Text style={{ color:'white' }} numberOfLines={2}>{item.caption}</Text>}
        </View>

        {/* botones derecha */}
        <View style={{ position:'absolute', right:10, top: (rowH || H) * 0.54, alignItems:'center' }}>
          <View style={{ alignItems:'center', marginBottom:16 }}>
            <TouchableOpacity onPress={() => router.push(`/profile/${item.uid}`)} activeOpacity={0.9} style={{ position:'relative' }}>
              <Avatar uid={item.uid} size={42} />
              {showFollowPlus && (
                <TouchableOpacity
                  onPress={() => toggleFollow(item.uid)} activeOpacity={0.9}
                  style={{ position:'absolute', right:-6, bottom:-6, width:22, height:22, borderRadius:11, backgroundColor:'#ff2d55', alignItems:'center', justifyContent:'center', borderWidth:2, borderColor:'#fff' }}
                >
                  <Ionicons name="add" size={14} color="#fff" />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={() => onToggleLike(item)} activeOpacity={0.8} style={{ alignItems:'center', marginBottom:18 }}>
            <Ionicons name="heart" size={28} color={likedMap[item.id] ? '#ff2d55' : '#fff'} />
            <Text style={{ color:'white', marginTop:6, fontWeight:'700' }}>{likesN}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => openComments(item.id)} activeOpacity={0.8} style={{ alignItems:'center', marginBottom:18 }}>
            <Ionicons name="chatbubble-ellipses" size={26} color="#fff" />
            <Text style={{ color:'white', marginTop:6, fontWeight:'700' }}>{(items.find(p => p.id === item.id)?.commentsCount ?? 0)}</Text>
          </TouchableOpacity>

          <View style={{ alignItems:'center' }}>
            <Ionicons name="eye" size={26} color="#fff" />
            <Text style={{ color:'white', marginTop:6, fontWeight:'700' }}>{viewsN}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex:1, backgroundColor:'black' }} onLayout={(e) => setRowH(e.nativeEvent.layout.height)}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
      <FlatList
        data={items}
        key={`watch-${rowH || 'auto'}`}
        keyExtractor={(it) => it.id}
        renderItem={renderItem}
        pagingEnabled
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 80 }}
        getItemLayout={(_, i) => ({ length: (rowH || H), offset: (rowH || H) * i, index: i })}
        showsVerticalScrollIndicator={false}
        windowSize={3}
        initialNumToRender={1}
        removeClippedSubviews={false}
        keyboardShouldPersistTaps="always"
        ListEmptyComponent={<View style={{ height: rowH || H }} />}
        extraData={{ H, rowH }}
      />

      <CommentsModal
        visible={!!openCommentsFor}
        post={openCommentsFor ? items.find(p => p.id === openCommentsFor) || null : null}
        comments={openCommentsFor ? (comments[openCommentsFor] || []) : []}
        onClose={() => setOpenCommentsFor(null)}
        onSend={(text) => {
          const p = openCommentsFor ? items.find(pp => pp.id === openCommentsFor) : null;
          if (p) sendComment(p, text);
        }}
        insets={insets}
      />

      {(!openCommentsFor && keyboardHeight === 0) && (
        <View pointerEvents="box-none" style={{ position:'absolute', left:0, right:0, bottom:0 }}>
          <BottomNav />
        </View>
      )}
    </View>
  );
}
