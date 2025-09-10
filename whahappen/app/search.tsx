// app/search.tsx
import React, { useEffect, useMemo, useRef, useState, memo } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { db } from '../lib/firebase';
import {
  collection, getDocs, limit, orderBy, query, where, doc, getDoc
} from 'firebase/firestore';
import { Video } from 'expo-av';
import { rankPosts } from '../lib/ranking';

const { width, height } = Dimensions.get('window');
const TILE_GAP = 6;
const COLS = 3;
const TILE = Math.floor((width - 12 * 2 - TILE_GAP * (COLS - 1)) / COLS);

type Post = {
  id: string; uid: string; videoURL: string;
  caption?: string; challengeTag?: string; tag?: string; challenge?: string;
  likesCount?: number; commentsCount?: number; createdAt?: any;
  keywords?: string[];
};

type UserDoc = { uid?: string; handle?: string; displayName?: string; photoURL?: string | null; };

const BackgroundDecor = memo(() => (
  <View pointerEvents="none" style={{ position:'absolute', left:0, right:0, top:0, bottom:0 }}>
    <LinearGradient
      colors={['rgba(124,77,255,0.28)','rgba(124,77,255,0.0)']}
      start={{x:0.1,y:0}} end={{x:0.9,y:1}}
      style={{ position:'absolute', width:320, height:320, borderRadius:160, top:-80, left:-80, transform:[{rotate:'18deg'}] }}
    />
    <LinearGradient
      colors={['rgba(255,77,222,0.22)','rgba(255,77,222,0.0)']}
      start={{x:0,y:0}} end={{x:1,y:1}}
      style={{ position:'absolute', width:260, height:260, borderRadius:130, top: height*0.25, right:-70, transform:[{rotate:'-12deg'}] }}
    />
    <LinearGradient
      colors={['rgba(0,210,255,0.18)','rgba(0,210,255,0.0)']}
      start={{x:0.2,y:0}} end={{x:0.8,y:1}}
      style={{ position:'absolute', width:420, height:420, borderRadius:210, bottom:-140, left: width*0.15, transform:[{rotate:'25deg'}] }}
    />
  </View>
));

const norm = (s?: string) => (s || '').toLowerCase().trim();
const tokenize = (q: string) => norm(q).split(/\s+/).filter(Boolean).slice(0, 10);

export default function Search() {
  const insets = useSafeAreaInsets();
  const r = useRouter();

  const [qtext, setQtext] = useState('');
  const [tab, setTab] = useState<'top'|'videos'|'users'>('top');

  const [videos, setVideos] = useState<Post[]>([]);
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [authors, setAuthors] = useState<Record<string, UserDoc>>({});
  const [loading, setLoading] = useState(false);

  // autoplay control
  const [active, setActive] = useState(0);
  const viewabilityConfig = { viewAreaCoveragePercentThreshold: 80 };
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    const idx = viewableItems?.[0]?.index ?? 0;
    setActive(idx);
  }).current;

  const actualTerms = useMemo(() => tokenize(qtext.replace(/^[@#]/, '')), [qtext]);

  async function hydrateAuthors(uids: string[]) {
    const unique = Array.from(new Set(uids.filter(Boolean)));
    await Promise.all(unique.map(async (uid) => {
      if (authors[uid]) return;
      try {
        const usnap = await getDoc(doc(db, 'users', uid));
        const udata = usnap.exists() ? (usnap.data() as any) : null;
        if (udata) setAuthors(prev => ({ ...prev, [uid]: { uid, handle: udata.handle, displayName: udata.displayName, photoURL: udata.photoURL || null } }));
      } catch {}
    }));
  }

  const runVideos = async () => {
    const terms = tokenize(qtext.replace(/^[@]/, ''));
    let docs: Post[] = [];
    if (terms.length) {
      try {
        const qy = query(
          collection(db, 'submissions'),
          where('keywords', 'array-contains-any', terms),
          orderBy('createdAt', 'desc'),
          limit(90)
        );
        const snap = await getDocs(qy);
        docs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      } catch {
        const qy2 = query(collection(db, 'submissions'), orderBy('createdAt', 'desc'), limit(120));
        const snap2 = await getDocs(qy2);
        docs = snap2.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
          .filter(p => {
            const text = `${p.caption ?? ''} ${(p.challengeTag ?? p.tag ?? p.challenge ?? '')}`.toLowerCase();
            return terms.some(t => text.includes(t));
          });
      }
    } else {
      const qy3 = query(collection(db, 'submissions'), orderBy('createdAt', 'desc'), limit(60));
      const snap3 = await getDocs(qy3);
      docs = snap3.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    }
    const ranked = rankPosts(docs, { terms: actualTerms });
    setVideos(ranked);
    hydrateAuthors(ranked.map(v => v.uid));
  };

  const runUsers = async () => {
    const raw = qtext.trim();
    const needle = raw.startsWith('@') ? raw.slice(1) : raw;
    const term = norm(needle);
    let list: UserDoc[] = [];
    if (term) {
      const s2 = await getDocs(query(collection(db,'users'), orderBy('createdAt','desc'), limit(60)));
      list = s2.docs.map(d => ({ uid: d.id, ...(d.data() as any) }))
        .filter(u => norm(u.handle).includes(term) || norm(u.displayName).includes(term));
    } else {
      const s3 = await getDocs(query(collection(db,'users'), orderBy('createdAt','desc'), limit(30)));
      list = s3.docs.map(d => ({ uid: d.id, ...(d.data() as any) }));
    }
    setUsers(list);
  };

  const run = async () => {
    setLoading(true);
    try {
      if (qtext.startsWith('@')) {
        setTab('users');
        await Promise.all([runUsers(), runVideos()]);
      } else {
        await Promise.all([runVideos(), runUsers()]);
      }
      setActive(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    run(); // primera carga
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // UI helpers
  const tagFor = (p: Post) => p.challengeTag || p.tag || (p.challenge ? `#${p.challenge}` : '');
  const handleFor = (uid: string) => {
    const u = authors[uid];
    if (u?.handle) return `@${u.handle}`;
    if (u?.displayName) return `@${u.displayName}`;
    return `@user-${String(uid).slice(0,5)}`;
  };

  const Header = () => (
    <View style={{ paddingTop: (insets.top||12)+6, paddingHorizontal: 12, paddingBottom: 10, flexDirection:'row', alignItems:'center', gap:8 }}>
      <TouchableOpacity onPress={() => r.back()} hitSlop={{top:8,bottom:8,left:8,right:8}}>
        <Ionicons name="chevron-back" size={26} color="#fff" />
      </TouchableOpacity>
      <View style={{ flex:1, flexDirection:'row', alignItems:'center', backgroundColor:'#12141a', borderRadius:14, borderWidth:1, borderColor:'#222633', paddingHorizontal:12 }}>
        <Ionicons name="search" size={18} color="#9aa0a6" />
        <TextInput
          value={qtext}
          onChangeText={setQtext}
          onSubmitEditing={run}
          placeholder="Busca videos, usuarios o #tags"
          placeholderTextColor="#8a8f98"
          style={{ flex:1, color:'#fff', paddingVertical:10, marginLeft:8 }}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        <TouchableOpacity onPress={run}><Text style={{ color:'#7aaceb', fontWeight:'700' }}>{loading ? '...' : 'Buscar'}</Text></TouchableOpacity>
      </View>
    </View>
  );

  const Tabs = () => (
    <View style={{ flexDirection:'row', gap:12, paddingHorizontal:12, paddingBottom:10 }}>
      {(['top','videos','users'] as const).map(t => {
        const activeTab = tab === t;
        return (
          <TouchableOpacity key={t} onPress={()=>setTab(t)} activeOpacity={0.8}>
            <View style={{
              paddingHorizontal:14, paddingVertical:8, borderRadius:999,
              backgroundColor: activeTab ? '#ffffff' : '#14161c', borderWidth:1,
              borderColor: activeTab ? '#fff' : '#222633'
            }}>
              <Text style={{ color: activeTab ? '#000' : '#cfd3db', fontWeight:'900', fontSize:12 }}>
                {t === 'top' ? 'Top' : t === 'videos' ? 'Videos' : 'Usuarios'}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  // ---- Grid (por si quieres mantenerlo en Top) ----
  const VideosGrid = () => (
    <FlatList
      data={videos}
      keyExtractor={(x)=>x.id}
      numColumns={COLS}
      columnWrapperStyle={{ gap: TILE_GAP }}
      contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: (insets.bottom||12)+80 }}
      ItemSeparatorComponent={() => <View style={{ height: TILE_GAP }} />}
      renderItem={({ item }) => (
        <TouchableOpacity
          onPress={()=>r.push(`/watch/${item.uid}?sid=${item.id}`)}
          activeOpacity={0.9}
          style={{
            width: TILE, height: TILE * 1.35, borderRadius: 10, overflow: 'hidden',
            backgroundColor: '#0f1116', borderWidth: 1, borderColor: '#1f232c'
          }}
        >
          {/* Si tienes thumbnails, colócalos aquí con <Image />; de momento solo info */}
          <View style={{ position:'absolute', top:6, left:6, right:6 }}>
            <Text style={{ color:'#fff', fontWeight:'900' }} numberOfLines={1}>{handleFor(item.uid)}</Text>
          </View>
          <View style={{ position:'absolute', bottom:6, left:6, right:6 }}>
            {!!tagFor(item) && <Text style={{ color:'#fff', fontSize:12 }} numberOfLines={1}>{tagFor(item)}</Text>}
            {!!item.caption && <Text style={{ color:'#cfd3db', fontSize:11 }} numberOfLines={1}>{item.caption}</Text>}
          </View>
        </TouchableOpacity>
      )}
    />
  );

  // ---- VIDEOS: feed vertical con autoplay estilo TikTok ----
  const VideosReels = () => {
    // Altura de cada slide (deja espacio para header/tabs)
    const headerTabsH = 120; // aprox; si quieres exacto, puedes medir con onLayout
    const ITEM_H = height - headerTabsH;

    return (
      <FlatList
        data={videos}
        keyExtractor={(x)=>x.id}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, index) => ({ length: ITEM_H, offset: ITEM_H * index, index })}
        renderItem={({ item, index }) => {
          const playing = index === active;
          const tag = tagFor(item);
          return (
            <View style={{ width, height: ITEM_H, backgroundColor: 'black' }}>
              <Video
                source={{ uri: item.videoURL }}
                style={{ width, height: ITEM_H }}
                resizeMode="cover"
                shouldPlay={playing}
                isLooping
                isMuted
              />
              {/* overlay info */}
              <View style={{ position: 'absolute', left: 14, bottom: 80, right: 110 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <TouchableOpacity onPress={() => r.push(`/profile/${item.uid}`)}>
                    <Text style={{ color: 'white', fontWeight: '900' }}>{handleFor(item.uid)}</Text>
                  </TouchableOpacity>
                  {!!tag && (
                    <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: '#ffffff22' }}>
                      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{tag}</Text>
                    </View>
                  )}
                </View>
                {!!item.caption && <Text style={{ color: 'white' }} numberOfLines={2}>{item.caption}</Text>}
              </View>

              {/* tap → abrir en watch */}
              <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
                <TouchableOpacity
                  style={{ flex: 1 }}
                  activeOpacity={1}
                  onPress={() => r.push(`/watch/${item.uid}?sid=${item.id}`)}
                >
                  <View />
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
        contentContainerStyle={{ paddingBottom: (insets.bottom || 12) + 24 }}
      />
    );
  };

  const UsersList = () => (
    <FlatList
      data={users}
      keyExtractor={(x)=>x.uid || x.handle || Math.random().toString(36)}
      ItemSeparatorComponent={() => <View style={{ height:10 }} />}
      contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: (insets.bottom||12)+80 }}
      renderItem={({ item }) => {
        const handle = item.handle ? `@${item.handle}` : `@user-${(item.uid||'').slice(0,5)}`;
        return (
          <TouchableOpacity
            onPress={()=>r.push(`/profile/${item.uid}`)}
            activeOpacity={0.85}
            style={{ backgroundColor:'#0f1116', borderRadius:14, borderWidth:1, borderColor:'#1f232c', padding:12, flexDirection:'row', alignItems:'center', gap:12 }}
          >
            {/* Si tienes <Avatar uid={...} /> puedes importarlo y usarlo aquí */}
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: '#181a1f', borderWidth: 1, borderColor: '#2a2d34', alignItems:'center', justifyContent:'center' }}>
              <Ionicons name="person-outline" size={20} color="#fff" />
            </View>
            <View style={{ flex:1 }}>
              <Text style={{ color:'#fff', fontWeight:'900' }}>{handle}</Text>
              {!!item.displayName && <Text style={{ color:'#9aa0a6' }}>{item.displayName}</Text>}
            </View>
            <Ionicons name="chevron-forward" size={18} color="#9aa0a6" />
          </TouchableOpacity>
        );
      }}
    />
  );

  const renderTab = () => {
    if (tab === 'users') return <UsersList />;
    if (tab === 'videos') return <VideosReels />; // ← autoplay feed
    // Top: muestra grid compacto de videos (preview rápido)
    return <VideosGrid />;
  };

  return (
    <View style={{ flex:1, backgroundColor:'#000' }}>
      <BackgroundDecor />
      <Header />
      <Tabs />
      {renderTab()}
    </View>
  );
}
