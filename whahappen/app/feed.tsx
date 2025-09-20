// app/feed.tsx
import { getApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  View,
  Text,
  useWindowDimensions,
  FlatList,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Animated,
  Keyboard,
  StyleSheet,
  Modal,
  StatusBar,
  Share,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Video } from "expo-av";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { auth, db } from "../lib/firebase";
import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDoc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  getCountFromServer,
} from "firebase/firestore";
import Avatar from "../components/Avatar";
import BottomNav from "../components/BottomNav";
import OverlaysRenderer from "../components/OverlaysRenderer";
import OverlaysAudio from "../components/OverlaysAudio";
import {
  observeLikesCount,
  observeMyLike,
  toggleLike as toggleLikeApi,
} from "../lib/likes";

// ---------- tipos ----------
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
  likesCount?: number;
  commentsCount?: number;
};

type UserDoc = {
  handle?: string;
  displayName?: string;
  photoURL?: string;
  followersCount?: number;
  followingCount?: number;
};

// ---------- utils ----------
const S = StyleSheet.create({ fill: StyleSheet.absoluteFillObject });

const usernameFor = (uid: string, authors: Record<string, UserDoc> = {}) => {
  const u = authors[uid];
  return u?.handle || u?.displayName || `user-${uid.slice(0, 6)}`;
};

function millisFrom(ts: any): number {
  if (!ts) return Date.now();
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  const n = Number(ts);
  if (!Number.isNaN(n) && n > 0) return n;
  const d = new Date(ts);
  return d.getTime() || Date.now();
}

// ---------- ranking (igual que antes, consolidado) ----------
function scorePost(
  p: Post,
  opts: { now: number; followingMap: Record<string, boolean>; seen: Set<string> }
) {
  const { now, followingMap, seen } = opts;
  const ageH = Math.max(0, (now - millisFrom(p.createdAt)) / 3_600_000);
  const halfLifeH = 36;
  const freshness = Math.exp((-Math.log(2) * ageH) / halfLifeH);
  const likes = Number(p.likesCount ?? p.likes ?? 0);
  const views = Number(p.views ?? 0);
  const er = likes / Math.max(1, views + 3);
  const followBonus = followingMap[p.uid] ? 1 : 0;
  let hash = 0;
  for (let i = 0; i < p.id.length; i++)
    hash = (hash * 31 + p.id.charCodeAt(i)) | 0;
  const rnd = (Math.abs(hash % 1000) / 1000) * 0.15;
  const seenPenalty = seen.has(p.id) ? 0.25 : 0;
  return 0.52 * freshness + 0.28 * er + 0.18 * followBonus + 0.06 * rnd - seenPenalty;
}
function interleaveDiverse(followed: Post[], others: Post[]) {
  const res: Post[] = [];
  const f = [...followed];
  const o = [...others];
  let last: string | null = null;
  while (f.length || o.length) {
    for (let i = 0; i < 2; i++) {
      const pick = f.shift();
      if (pick) {
        if (last === pick.uid && o.length) {
          const alt = o.shift()!;
          res.push(alt);
          last = alt.uid;
          f.unshift(pick);
        } else {
          res.push(pick);
          last = pick.uid;
        }
      }
    }
    if (o.length) {
      const pick = o.shift()!;
      if (last === pick.uid && f.length) {
        const alt = f.shift()!;
        res.push(alt);
        last = alt.uid;
        o.unshift(pick);
      } else {
        res.push(pick);
        last = pick.uid;
      }
    }
  }
  return res;
}
function rankForYou(
  posts: Post[],
  ctx: { followingMap: Record<string, boolean>; seen: Set<string> }
) {
  const now = Date.now();
  const scored = posts.map((p) => ({
    p,
    s: scorePost(p, { now, followingMap: ctx.followingMap, seen: ctx.seen }),
  }));
  const followed = scored
    .filter((x) => ctx.followingMap[x.p.uid])
    .sort((a, b) => b.s - a.s)
    .map((x) => x.p);
  const others = scored
    .filter((x) => !ctx.followingMap[x.p.uid])
    .sort((a, b) => b.s - a.s)
    .map((x) => x.p);
  const mixed = interleaveDiverse(followed, others);
  return mixed.length ? mixed : posts;
}

// ---------- hooks de rendimiento ----------
function useThrottledNumber(value: number, interval = 200) {
  const [v, setV] = useState(value);
  const lastRef = useRef(0);
  useEffect(() => {
    const now = Date.now();
    const elapsed = now - lastRef.current;
    if (elapsed >= interval) {
      lastRef.current = now;
      setV(value);
      return;
    }
    const id = setTimeout(() => {
      lastRef.current = Date.now();
      setV(value);
    }, interval - elapsed);
    return () => clearTimeout(id);
  }, [value, interval]);
  return v;
}

// 🔁 Reemplaza tu componente VideoItem completo por este
const VideoItem = memo(function VideoItem({
  item,
  index,
  activeIndex,
  pausedId,
  onTap,
  onViewed,
  authors,
  liked,
  likesCount,
  viewsCount,
  tag,
  showFollowPlus,
  isFollowing,
  toggleFollow,
  onToggleLike,
  openComments,
  router,
  insets,
  rowH,
  H,
   onShare,
  // (nuevo) contador real de comentarios
  commentsCount,
}: any) {
  const playing = !pausedId ? index === activeIndex : pausedId !== item.id;

  // --- STATUS → estado throttleado (sí dispara render) ---
  const [posMs, setPosMs] = useState(0);
  const lastTickRef = useRef(0);
  const onStatus = useCallback((s: any) => {
    if ('positionMillis' in s) {
      const now = Date.now();
      // throttle ~ 160–200ms
      if (now - lastTickRef.current > 180) {
        lastTickRef.current = now;
        setPosMs(s.positionMillis || 0);
      }
    }
  }, []);

  // overlays normalizados (evita recrearlos)
  const layers = useMemo(() => {
    if (Array.isArray(item.overlays)) return item.overlays;
    if (item.overlays?.layers && Array.isArray(item.overlays.layers)) {
      return item.overlays.layers;
    }
    const e = (item as any).edits;
    if (e?.overlays && Array.isArray(e.overlays)) return e.overlays;
    if (e?.layers && Array.isArray(e.layers)) return e.layers;
    return [];
  }, [item.overlays, (item as any).edits]);

  // audio bgm (si existe dentro de overlays/edits)
  const bgm = useMemo(() => {
    const obj =
      (item.overlays && typeof item.overlays === 'object' ? item.overlays : null) ||
      ((item as any).edits && typeof (item as any).edits === 'object' ? (item as any).edits : null);
    return obj?.audio?.bgm ?? null;
  }, [item.overlays, (item as any).edits]);

  useEffect(() => {
    if (playing) {
      const t = setTimeout(onViewed, 250);
      return () => clearTimeout(t);
    }
  }, [playing, onViewed]);

  const CAPTION_BOTTOM = (insets.bottom || 12) + 90;

  return (
    <View
      style={{
        width: '100%',
        height: rowH || H,
        backgroundColor: 'black',
      }}
    >
      <TouchableWithoutFeedback onPress={onTap}>
        <Video
          source={{ uri: item.videoURL }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          shouldPlay={playing}
          isLooping
          isMuted={true}
          progressUpdateIntervalMillis={200}
          onPlaybackStatusUpdate={onStatus}
          useNativeControls={false}
        />
      </TouchableWithoutFeedback>

      {/* Overlays por arriba del video */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <OverlaysRenderer overlays={layers} currentMs={posMs} />
      </View>

      {/* ¡Este componente sí requiere playing y positionMs! */}
      <OverlaysAudio
        bgm={bgm ?? undefined}
        voice={false}
        playing={playing}
        positionMs={posMs}
      />

      {/* caption */}
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', left: 14, bottom: CAPTION_BOTTOM, right: 110 }}
      >
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}
        >
          <TouchableOpacity
            onPress={() => router.push(`/profile/${item.uid}`)}
            activeOpacity={0.9}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
          >
            <Text style={{ color: 'white', fontWeight: '800', fontSize: 16 }}>
              {authors[item.uid]?.handle ||
                authors[item.uid]?.displayName ||
                `user-${String(item.uid).slice(0, 6)}`}
            </Text>
          </TouchableOpacity>

          {!!tag && (
            <View
              style={{
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 999,
                backgroundColor: '#ffffff22',
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>
                {tag}
              </Text>
            </View>
          )}
        </View>

        {!!item.caption && (
          <Text style={{ color: 'white' }} numberOfLines={2}>
            {item.caption}
          </Text>
        )}
      </View>

      {/* sidebar */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          right: 10,
          top: (rowH || H) * 0.45,
          alignItems: 'center',
        }}
      >
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <TouchableOpacity
            onPress={() => router.push(`/profile/${item.uid}`)}
            activeOpacity={0.9}
            style={{ position: 'relative' }}
          >
            <Avatar uid={item.uid} size={42} />
            {showFollowPlus && (
              <TouchableOpacity
                onPress={() => toggleFollow(item.uid)}
                activeOpacity={0.9}
                style={{
                  position: 'absolute',
                  right: -6,
                  bottom: -6,
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  backgroundColor: '#ff2d55',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 2,
                  borderColor: '#fff',
                }}
              >
                <Ionicons name="add" size={14} color="#fff" />
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={() => onToggleLike(item)}
          activeOpacity={0.8}
          style={{ alignItems: 'center', marginBottom: 18 }}
        >
          <Ionicons
            name="heart"
            size={28}
            color={liked ? '#ff2d55' : '#fff'}
          />
          <Text style={{ color: 'white', marginTop: 6, fontWeight: '700' }}>
            {likesCount}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => openComments(item.id)}
          activeOpacity={0.8}
          style={{ alignItems: 'center', marginBottom: 18 }}
        >
          <Ionicons name="chatbubble-ellipses" size={26} color="#fff" />
          <Text style={{ color: 'white', marginTop: 6, fontWeight: '700' }}>
            {commentsCount ?? 0}
          </Text>
        </TouchableOpacity>

        <View style={{ alignItems: 'center' }}>
          <Ionicons name="eye" size={26} color="#fff" />
          <Text style={{ color: 'white', marginTop: 6, fontWeight: '700' }}>
            {viewsCount}
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => onShare(item.id)}
          style={{ alignItems: 'center', marginBottom: 12, marginTop: 18 }}
          activeOpacity={0.8}
        >
          <Ionicons name="share-social-outline" size={26} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
});

// ---------- modal comentarios (sin cambios funcionales, layout estable) ----------
function CommentsModal({
  visible,
  post,
  comments,
  onClose,
  onSend,
  insets,
}: {
  visible: boolean;
  post: Post | null;
  comments: any[];
  onClose: () => void;
  onSend: (text: string) => void;
  insets: { top: number; bottom: number } & any;
}) {
  const { height: H } = useWindowDimensions();
  const [text, setText] = useState("");
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [visible]);

  if (!visible || !post) return null;
  const COMPOSER_H = 56;

  return (
    <Modal
      visible
      animationType="slide"
      transparent
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={(insets.top || 0) + 8}
        style={{ flex: 1 }}
      >
        <TouchableWithoutFeedback onPress={onClose}>
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              backgroundColor: "#00000066",
            }}
          />
        </TouchableWithoutFeedback>

        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "#0f1116f2",
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            paddingTop: 10,
            paddingBottom: (insets.bottom || 12) + 10,
            maxHeight: H * 0.7,
          }}
        >
          <View style={{ alignItems: "center", marginBottom: 6 }}>
            <View
              style={{
                width: 60,
                height: 6,
                borderRadius: 3,
                backgroundColor: "#2a2e36",
              }}
            />
          </View>

          <Text
            style={{
              color: "#fff",
              fontWeight: "900",
              fontSize: 20,
              paddingHorizontal: 16,
              marginBottom: 4,
            }}
          >
            Comentarios ({comments.length})
          </Text>

          <FlatList
            inverted
            data={comments}
            keyExtractor={(c: any) => c.id}
            keyboardShouldPersistTaps="always"
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }}
            renderItem={({ item: c }: any) => (
              <View style={{ flexDirection: "row", gap: 10, paddingVertical: 10 }}>
                <Avatar uid={c.uid} size={36} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                    <Text style={{ color: "#9aa0a6", fontWeight: "800" }}>
                      {c.username || usernameFor(c.uid)}
                    </Text>
                    <Text style={{ color: "#6e7681", fontSize: 12 }}>
                      {new Date(
                        c.createdAt?.toMillis?.() || Date.now()
                      ).toLocaleString()}
                    </Text>
                  </View>
                  <Text style={{ color: "#fff" }}>{c.text}</Text>
                </View>
              </View>
            )}
          />

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingHorizontal: 16,
              height: COMPOSER_H,
            }}
          >
            <TextInput
              ref={inputRef}
              autoFocus
              showSoftInputOnFocus
              placeholder="Escribe un comentario…"
              placeholderTextColor="#8a8f98"
              style={{
                flex: 1,
                backgroundColor: "#13161c",
                color: "#fff",
                borderRadius: 12,
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderWidth: 1,
                borderColor: "#252a36",
              }}
              returnKeyType="send"
              onSubmitEditing={(e) => {
                const v = e.nativeEvent.text?.trim();
                if (v) onSend(v);
              }}
              value={text}
              onChangeText={setText}
            />
            <TouchableOpacity
              onPress={() => {
                const v = text.trim();
                if (v) {
                  onSend(v);
                  setText("");
                }
              }}
              activeOpacity={0.9}
            >
              <View
                style={{
                  backgroundColor: "#fff",
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  borderRadius: 12,
                }}
              >
                <Text style={{ color: "#000", fontWeight: "900" }}>Enviar</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------- feed ----------
export default function Feed() {
  const { height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const me = auth.currentUser?.uid || null;

  const [items, setItems] = useState<Post[]>([]);
  const [active, setActive] = useState(0);

  const [authors, setAuthors] = useState<Record<string, UserDoc>>({});
  const authorsCacheRef = useRef<Record<string, UserDoc>>({});

  const [followingMap, setFollowingMap] = useState<Record<string, boolean>>({});
  const likeUnsubRef = useRef<(() => void) | null>(null);
  const countUnsubRef = useRef<(() => void) | null>(null);
  const docUnsubRef = useRef<(() => void) | null>(null);
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});
  const [likesCountMap, setLikesCountMap] = useState<Record<string, number>>({});
  const [rowH, setRowH] = useState<number | null>(null);
  const [viewsMap, setViewsMap] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, any[]>>({});
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [pausedId, setPausedId] = useState<string | null>(null);
  const [squad, setSquad] = useState<any | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  // (nuevo) contador real de comments por post
  const [commentsCountMap, setCommentsCountMap] = useState<Record<string, number>>({});

  // teclado
  useEffect(() => {
    const sh = Keyboard.addListener("keyboardDidShow", (e) =>
      setKeyboardHeight(e.endCoordinates.height)
    );
    const hd = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardHeight(0)
    );
    return () => {
      sh.remove();
      hd.remove();
    };
  }, []);

  // gating (igual)
  useEffect(() => {
    (async () => {
      const { getTodayChoice } = await import("../lib/choices");
      const { choice } = await getTodayChoice();
      if (!choice) router.replace("/");
    })();
  }, []);

  // a quién sigo (afinidad ranking)
  useEffect(() => {
    const my = auth.currentUser?.uid;
    if (!my) return;
    const uRef = doc(db, "users", my);
    const unsub = onSnapshot(uRef, (uSnap) => {
      const data = uSnap.data() || {};
      const f = data.following || {};
      const map: Record<string, boolean> = {};
      Object.keys(f || {}).forEach((k) => {
        if (f[k]) map[k] = true;
      });
      setFollowingMap(map);

      const squadId = data?.squadId;
      if (!squadId) setSquad(null);
      else {
        const sRef = doc(db, "squads", squadId);
        onSnapshot(sRef, (s) => setSquad({ id: squadId, ...s.data() }));
      }
    });
    return unsub;
  }, []);

  // cargar posts + cache autores + ranking
  const rankDebounce = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    const qy = query(
      collection(db, "submissions"),
      orderBy("createdAt", "desc"),
      limit(120)
    );
    const unsub = onSnapshot(qy, async (snap) => {
      const arr: Post[] = [];
      const needUsers: string[] = [];
      snap.docs.forEach((d) => {
        const data = d.data() as any;
        arr.push({ id: d.id, ...data });
        if (data?.uid && !authorsCacheRef.current[data.uid]) {
          needUsers.push(data.uid);
        }
      });

      if (needUsers.length) {
        Promise.all(
          needUsers.map(async (uid) => {
            const us = await getDoc(doc(db, "users", uid));
            authorsCacheRef.current[uid] = (us.data() as UserDoc) || {};
          })
        ).then(() => setAuthors({ ...authorsCacheRef.current }));
      }

      if (rankDebounce.current) clearTimeout(rankDebounce.current);
      rankDebounce.current = setTimeout(() => {
        const ranked = rankForYou(arr, {
          followingMap,
          seen: seenRef.current,
        });
        setItems(ranked);
      }, 120);
    });
    return () => unsub();
  }, [followingMap]);

  // listeners del activo
  const primeActive = useCallback((postId?: string) => {
    likeUnsubRef.current?.();
    countUnsubRef.current?.();
    docUnsubRef.current?.();
    if (!postId) return;

    likeUnsubRef.current =
      observeMyLike(postId, (liked) =>
        setLikedMap((m) => ({ ...m, [postId]: liked }))
      ) || null;

    countUnsubRef.current = observeLikesCount(postId, (n) =>
      setLikesCountMap((m) => ({ ...m, [postId]: n }))
    );

    docUnsubRef.current = onSnapshot(
      doc(db, "submissions", postId),
      async (s) => {
        const d = s.data() as Post | undefined;
        try {
          const cntSnap = await getCountFromServer(
            collection(db, "submissions", postId, "views")
          );
          const total = Number(cntSnap.data().count || 0);
          setViewsMap((m) => ({ ...m, [postId]: total }));
        } catch {
          const v = d?.viewsFromOthersCount ?? d?.viewsCount ?? 0;
          setViewsMap((m) => ({ ...m, [postId]: v }));
        }

        // (nuevo) contador real de comentarios
        try {
          const cSnap = await getCountFromServer(
            collection(db, "submissions", postId, "comments")
          );
          const c = Number(cSnap.data().count || 0);
          setCommentsCountMap((m) => ({ ...m, [postId]: c }));
        } catch {
          const c = d?.commentsCount ?? 0;
          setCommentsCountMap((m) => ({ ...m, [postId]: c }));
        }
      }
    );
  }, []);
  const [openCommentsFor, setOpenCommentsFor] = useState<string | null>(null);
  useEffect(() => {
    if (openCommentsFor) {
      likeUnsubRef.current?.();
      countUnsubRef.current?.();
    } else {
      primeActive(items[active]?.id);
    }
  }, [openCommentsFor, items, active, primeActive]);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (!viewableItems?.length) return;
    viewableItems.forEach((v: any) => {
      const id = v?.item?.id;
      if (id) seenRef.current.add(id);
    });
    const top = viewableItems.find((v: any) => v.isViewable);
    if (top?.index != null) setActive(top.index);
  }).current;

  // (cambiado) seguir/dejar de seguir via Cloud Function
  const toggleFollow = async (uid: string) => {
    const my = auth.currentUser?.uid;
    if (!my || !uid || my === uid) return;
    try {
      const fx = getFunctions(getApp(), "us-central1");
      const call = httpsCallable(fx, "toggleFollowUser");
      await call({ targetUid: uid });
    } catch {}
  };

  const onToggleLike = useCallback(
    async (p: Post) => {
      if (!me) return;
      try {
        await toggleLikeApi(p.id);
      } catch {}
    },
    [me]
  );

  // comentarios
  const openComments = useCallback(
    (postId: string) => {
      setOpenCommentsFor(postId);
      if (!comments[postId]) {
        onSnapshot(
          query(
            collection(db, "submissions", postId, "comments"),
            orderBy("createdAt", "desc"),
            limit(80)
          ),
          (snap) => {
            const arr = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as any),
            }));
            setComments((m) => ({ ...m, [postId]: arr }));
          }
        );
      }
    },
    [comments]
  );

  const sendComment = async (post: Post, text: string) => {
    const my = auth.currentUser?.uid || null;
    if (!my || !text.trim()) return;
    const username =
      authors[my]?.handle ||
      authors[my]?.displayName ||
      `user-${my.slice(0, 6)}`;

    await addDoc(collection(db, "submissions", post.id, "comments"), {
      uid: my,
      username,
      text: text.trim(),
      createdAt: serverTimestamp(),
    });
    try {
      await updateDoc(doc(db, "submissions", post.id), {
        commentsCount: increment(1),
      });
    } catch {}
  };

  // corazón animado
  const heart = useRef(new Animated.Value(0)).current;
  const heartStyle = useMemo(
    () => ({
      opacity: heart.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
      transform: [
        {
          scale: heart.interpolate({
            inputRange: [0, 1],
            outputRange: [0.5, 1],
          }),
        },
      ],
    }),
    [heart]
  );
  const pulseHeart = () => {
    Animated.sequence([
      Animated.timing(heart, { toValue: 1, duration: 120, useNativeDriver: true }),
      Animated.timing(heart, { toValue: 0, duration: 240, useNativeDriver: true }),
    ]).start();
  };

  async function onShare(submissionId: string) {
    try {
      const fx = getFunctions(getApp(), "us-central1");
      const createShortLink = httpsCallable(fx, "createShortLink");
      const { data }: any = await createShortLink({ submissionId });
      const link = data?.shortLink || "";
      await Share.share({ message: `Mira mi chain 👉 ${link}`, url: link });
    } catch (e) {
      console.log("shareOutside error", e);
    }
  }

  const renderItem = useCallback(
    ({ item, index }: { item: Post; index: number }) => {
      const likesN =
        likesCountMap[item.id] ?? (item.likesCount ?? item.likes ?? 0);
      const viewsN = viewsMap[item.id] ?? (item.views ?? 0);
      const commentsN = commentsCountMap[item.id] ?? (item.commentsCount ?? 0);
      const canFollow = !!(me && item.uid && me !== item.uid);
      const isFollowing = !!(item.uid && followingMap[item.uid]);
      const showFollowPlus = canFollow && !isFollowing;
      const tag =
        item.challengeTag ||
        (item as any).tag ||
        (item.challenge ? `#${item.challenge}` : undefined);

      const handleTap = () => {
        const now = Date.now();
        if (now - (handleTap as any)._last < 300) {
          onToggleLike(item);
          pulseHeart();
          (handleTap as any)._last = 0;
          return;
        }
        (handleTap as any)._last = now;
        setPausedId((p) => (p ? null : item.id));
      };

      const playing = openCommentsFor ? false : pausedId ? pausedId !== item.id : index === active;

      return (
        <>
          <VideoItem
            item={item}
            index={index}
            activeIndex={active}
            pausedId={pausedId}
            onTap={handleTap}
            onShare={onShare}
            onViewed={() => {
              (async () => {
                try {
                  const my = auth.currentUser?.uid;
                  if (!my) return;
                  const vref = doc(
                    collection(db, "submissions", item.id, "views"),
                    my
                  );
                  const snap = await getDoc(vref);
                  if (!snap.exists()) {
                    await new Promise((res) => setTimeout(res, 0));
                    await runTransaction(db, async (tx) => {
                      tx.set(vref, { uid: my, createdAt: serverTimestamp() });
                      tx.update(doc(db, "submissions", item.id), {
                        viewsFromOthersCount: increment(1),
                      });
                    });
                  }
                } catch {}
              })();
            }}
            authors={authors}
            liked={!!likedMap[item.id]}
            likesCount={likesN}
            viewsCount={viewsN}
            tag={tag}
            showFollowPlus={showFollowPlus}
            isFollowing={isFollowing}
            toggleFollow={toggleFollow}
            onToggleLike={onToggleLike}
            openComments={openComments}
            router={router}
            insets={insets}
            rowH={rowH}
            H={H}
            commentsCount={commentsN} // (nuevo) contador real
          />
          <Animated.View
            pointerEvents="none"
            style={[
              S.fill,
              { alignItems: "center", justifyContent: "center" },
              heartStyle,
            ]}
          >
            <Ionicons name="heart" size={120} color="#ff2d55" />
          </Animated.View>
        </>
      );
    },
    [
      active,
      pausedId,
      authors,
      likedMap,
      likesCountMap,
      viewsMap,
      commentsCountMap,
      followingMap,
      insets,
      rowH,
      H,
      onToggleLike,
      openComments,
      router,
      openCommentsFor,
    ]
  );

  return (
    <View
      style={{ flex: 1, backgroundColor: "black" }}
      onLayout={(e) => setRowH(e.nativeEvent.layout.height)}
    >
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

      {/* overlay de squad (cintilla fija) */}
      {Boolean(squad?.streak) && (
        <View
          pointerEvents="box-none"
          style={{
            position: "absolute",
            top: (insets.top || 8) + 8,
            left: 12,
            right: 12,
            zIndex: 40,
          }}
        >
          <TouchableOpacity
            onPress={() => router.push("/squad")}
            activeOpacity={0.95}
            style={{
              alignSelf: "flex-start",
              borderRadius: 999,
              overflow: "hidden",
              shadowColor: "#000",
              shadowOpacity: 0.35,
              shadowOffset: { width: 0, height: 2 },
              shadowRadius: 8,
              elevation: 6,
            }}
          >
            <LinearGradient
              colors={["#191c23ee", "#0f1116ee"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderWidth: 1,
                borderColor: "#2b303b",
                gap: 8,
              }}
            >
              <Text style={{ fontSize: 16 }}>🔥</Text>
              <Text style={{ color: "#fff", fontWeight: "900" }}>
                {squad?.name ? `${squad.name} · ` : ""}Racha {squad.streak} día
                {Number(squad.streak) === 1 ? "" : "s"}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}

      {/* Search */}
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          top: (insets.top || 12) + 8,
          right: 12,
          zIndex: 40,
        }}
      >
        <TouchableOpacity
          onPress={() => router.push("/search")}
          activeOpacity={0.9}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{
            backgroundColor: "#101318",
            borderWidth: 1,
            borderColor: "#252a36",
            padding: 10,
            borderRadius: 999,
            shadowColor: "#000",
            shadowOpacity: 0.25,
            shadowOffset: { width: 0, height: 2 },
            shadowRadius: 6,
            elevation: 3,
          }}
        >
          <Ionicons name="search" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* feed */}
      <FlatList
        data={items}
        key={`feed-${rowH || "auto"}`}
        keyExtractor={(it) => it.id}
        renderItem={renderItem}
        pagingEnabled
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 80 }}
        getItemLayout={(_, i) => ({
          length: rowH || H,
          offset: (rowH || H) * i,
          index: i,
        })}
        showsVerticalScrollIndicator={false}
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        updateCellsBatchingPeriod={60}
        removeClippedSubviews={Platform.OS === "android"}
        keyboardShouldPersistTaps="always"
        ListEmptyComponent={<View style={{ height: rowH || H }} />}
        // ¡Ojo! extraData solo con lo necesario para no invalidar celdas:
        extraData={{ rowH, H, active, pausedId }}
      />

      <CommentsModal
        visible={!!openCommentsFor}
        post={
          openCommentsFor
            ? items.find((p) => p.id === openCommentsFor) || null
            : null
        }
        comments={openCommentsFor ? comments[openCommentsFor] || [] : []}
        onClose={() => setOpenCommentsFor(null)}
        onSend={(text) => {
          const p = openCommentsFor
            ? items.find((pp) => pp.id === openCommentsFor)
            : null;
          if (p) sendComment(p, text);
        }}
        insets={insets}
      />

      {!openCommentsFor && keyboardHeight === 0 && (
        <View
          pointerEvents="box-none"
          style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
        >
          <BottomNav />
        </View>
      )}
    </View>
  );
}
