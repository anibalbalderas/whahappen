// app/notifications.tsx  (archivo entero por comodidad)
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StatusBar } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import BottomNav from '../components/BottomNav';
import { useRouter } from 'expo-router';
import { auth, db } from '../lib/firebase';
import {
  collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, where
} from 'firebase/firestore';
import { ensureThreadWith } from '../lib/chat';
import Avatar from '../components/Avatar';

const BackgroundDecor = () => (
  <View pointerEvents="none" style={{ position:'absolute', left:0, right:0, top:0, bottom:0 }}>
    <LinearGradient colors={['rgba(124,77,255,0.28)','rgba(124,77,255,0.0)']} start={{x:0.1,y:0}} end={{x:0.9,y:1}}
      style={{ position:'absolute', width:320, height:320, borderRadius:160, top:-80, left:-80 }} />
    <LinearGradient colors={['rgba(255,77,222,0.22)','rgba(255,77,222,0.0)']} start={{x:0,y:0}} end={{x:1,y:1}}
      style={{ position:'absolute', width:260, height:260, borderRadius:130, top: 220, right:-70 }} />
  </View>
);

type Noti = {
  id: string;
  type: 'like'|'comment'|'follow'|'message';
  fromUid: string;
  postId?: string;
  threadId?: string;
  text?: string;
  createdAt?: any;
};
type UserDoc = { handle?: string; displayName?: string };

export default function Notifications() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const me = auth.currentUser?.uid || null;

  const [items, setItems] = useState<Noti[]>([]);
  const [friends, setFriends] = useState<string[]>([]);
  const [threads, setThreads] = useState<any[]>([]);
  const [users, setUsers] = useState<Record<string, UserDoc>>({});

  const primeUser = async (uid: string) => {
    if (!uid || users[uid]) return;
    const snap = await getDoc(doc(db, 'users', uid));
    setUsers(prev => ({ ...prev, [uid]: (snap.data() as any) || {} }));
  };

  // Notificaciones
  useEffect(() => {
    if (!me) return;
    const qy = query(collection(db, 'notifications', me, 'items'), orderBy('createdAt','desc'));
    return onSnapshot(qy, async snap => {
      const arr = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Noti[];
      setItems(arr);
      const uniq = Array.from(new Set(arr.map(n => n.fromUid).filter(Boolean)));
      await Promise.all(uniq.map(uid => primeUser(uid)));
    });
  }, [me, users]);

  // Amigos (mutuo)
  useEffect(() => {
    if (!me) return;
    (async () => {
      const q1 = query(collection(db, 'follows'), where('follower', '==', me));
      const f1 = await getDocs(q1);
      const iFollow = new Set(f1.docs.map(d => d.get('following')));

      const q2 = query(collection(db, 'follows'), where('following', '==', me));
      const f2 = await getDocs(q2);
      const followers = new Set(f2.docs.map(d => d.get('follower')));

      const mutual: string[] = [];
      iFollow.forEach((u: any) => { if (followers.has(u)) mutual.push(u); });
      setFriends(mutual);
      await Promise.all(mutual.map(uid => primeUser(uid)));
    })();
  }, [me]);

  // Threads (con preview correcto)
  useEffect(() => {
    if (!me) return;
    const qy = query(collection(db, 'chats'), where('users','array-contains', me), orderBy('updatedAt','desc'));
    return onSnapshot(qy, async snap => {
      const arr = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      setThreads(arr);
      await Promise.all(arr.map(t => {
        const [a, b] = String(t.id).split('_');
        const other = a === me ? b : a;
        return primeUser(other);
      }));
    });
  }, [me, users]);

  const nameFor = useMemo(() => (uid: string) => {
    const u = users[uid] || {};
    if (u.handle) return `@${u.handle}`;
    if (u.displayName) return `@${u.displayName}`;
    return `@user-${String(uid || '').slice(0,6)}`;
  }, [users]);

  const openChatWith = async (uid: string) => {
    const id = await ensureThreadWith(uid);
    if (id) router.push({ pathname: '/chat/[threadId]', params: { threadId: id } });
  };

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#000' }} edges={['top','bottom']}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
      <View style={{ flex:1, backgroundColor:'#000' }}>
        <BackgroundDecor />

        <View style={{ paddingTop:(insets.top||12)+8, paddingHorizontal:16, paddingBottom:12 }}>
          <Text style={{ color:'#fff', fontWeight:'900', fontSize:22 }}>Buzón</Text>
          <Text style={{ color:'#9aa0a6', marginTop:6 }}>Amigos, mensajes y notificaciones.</Text>
        </View>

        {/* Amigos */}
        <View style={{ paddingHorizontal:16, paddingBottom:8 }}>
          <Text style={{ color:'#fff', fontWeight:'800', marginBottom:8 }}>Amigos</Text>
          <FlatList
            horizontal
            data={friends}
            keyExtractor={(u)=>u}
            showsHorizontalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={{ width:10 }} />}
            renderItem={({item: uid})=>(
              <TouchableOpacity
                onPress={()=>openChatWith(uid)}
                style={{ padding:10, borderRadius:12, backgroundColor:'#13161c', borderWidth:1, borderColor:'#232838' }}>
                <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                  <Avatar uid={uid} size={28} />
                  <Text style={{ color:'#fff', fontWeight:'700' }}>{nameFor(uid)}</Text>
                </View>
                <Text style={{ color:'#9aa0a6', fontSize:12, marginTop:2 }}>Mensaje</Text>
              </TouchableOpacity>
            )}
          />
        </View>

        {/* Mensajes */}
        <View style={{ paddingHorizontal:16, paddingVertical:8 }}>
          <Text style={{ color:'#fff', fontWeight:'800', marginBottom:8 }}>Mensajes</Text>
          {threads.map(t=>{
            const [a,b] = String(t.id).split('_');
            const other = a===me ? b : a;
            const preview =
              t.lastText
                ? (t.lastFromUid === me ? `Tú: ${t.lastText}` : t.lastText)
                : 'Nuevo chat';
            return (
              <TouchableOpacity key={t.id}
                onPress={()=>router.push({ pathname:'/chat/[threadId]', params:{ threadId: t.id } })}
                style={{ paddingVertical:12, borderBottomColor:'#1f2230', borderBottomWidth:1 }}>
                <View style={{ flexDirection:'row', alignItems:'center', gap:10 }}>
                  <Avatar uid={other} size={34} />
                  <View style={{ flex:1 }}>
                    <Text style={{ color:'#fff', fontWeight:'700' }}>{nameFor(other)}</Text>
                    <Text style={{ color:'#9aa0a6' }} numberOfLines={1}>{preview}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Notificaciones */}
        <View style={{ flex:1, paddingHorizontal:16, paddingVertical:8 }}>
          <Text style={{ color:'#fff', fontWeight:'800', marginBottom:8 }}>Notificaciones</Text>
          <FlatList
            data={items}
            keyExtractor={(n)=>n.id}
            ItemSeparatorComponent={() => <View style={{ height:1, backgroundColor:'#1f2230' }} />}
            renderItem={({item:n})=>{
              const u = n.fromUid;
              const title =
                n.type==='like' ? 'Le gustó tu video' :
                n.type==='comment' ? 'Comentó tu video' :
                n.type==='follow' ? 'Comenzó a seguirte' :
                'Te envió un mensaje';

              const onPress = () => {
                if (n.type === 'message') openChatWith(u);
                else router.push(`/profile/${u}`);
              };

              return (
                <TouchableOpacity onPress={onPress} style={{ paddingVertical:12 }}>
                  <View style={{ flexDirection:'row', alignItems:'center', gap:10 }}>
                    <Avatar uid={u} size={36} />
                    <View style={{ flex:1 }}>
                      <Text style={{ color:'#fff', fontWeight:'800' }}>
                        {nameFor(u)} <Text style={{ color:'#c4c7ce', fontWeight:'600' }}>• {title}</Text>
                      </Text>
                      {!!n.text && <Text style={{ color:'#9aa0a6' }} numberOfLines={1}>{n.text}</Text>}
                    </View>
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        </View>

        <BottomNav />
      </View>
    </SafeAreaView>
  );
}
