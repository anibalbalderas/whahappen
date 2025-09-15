// app/chat/[threadId].tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';

import { auth, db } from '../../lib/firebase';
import {
  collection, addDoc, onSnapshot, orderBy, query, serverTimestamp,
  doc, updateDoc, setDoc, getDoc, where, getDocs
} from 'firebase/firestore';
import { otherUidFromThread } from '../../lib/chat';
import Avatar from '../../components/Avatar';

type UserDoc = { handle?: string; displayName?: string; photoURL?: string | null };

export default function ChatScreen() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const me = auth.currentUser?.uid || null;
  const [otherUid, setOtherUid] = useState<string | null>(null);
  const [otherUser, setOtherUser] = useState<UserDoc | null>(null);

  const [text, setText] = useState('');
  const [msgs, setMsgs] = useState<any[]>([]);
  const listRef = useRef<FlatList>(null);

  // 1) Identifica al “otro” y asegura el thread (SIN leer antes)
  useEffect(() => {
    (async () => {
      if (!me || !threadId) return;
      const o = otherUidFromThread(String(threadId), me);
      if (!o) return;
      setOtherUid(o);
      // Crea/merge directo (rules permiten CREATE)
      await setDoc(
        doc(db, 'chats', String(threadId)),
        { users: [me, o].sort(), updatedAt: serverTimestamp() },
        { merge: true }
      );
      // carga el user del otro
      const u = await getDoc(doc(db, 'users', o));
      setOtherUser((u.data() as any) || {});
    })();
  }, [me, threadId]);

  // 2) Mensajes en orden ascendente (más común en chats)
  useEffect(() => {
    if (!threadId) return;
    const qy = query(
      collection(db, 'chats', String(threadId), 'messages'),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(
      qy,
      snap => {
        const arr = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        setMsgs(arr);
        // scroll al final
        requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
      },
      err => console.log('🔴 [Chat] messages error', err)
    );
    return () => unsub();
  }, [threadId]);

  // 3) Enviar mensaje + actualizar lastText/lastFromUid y notificación
  const send = async () => {
    if (!me || !otherUid || !text.trim() || !threadId) return;
    const body = text.trim();

    await addDoc(collection(db, 'chats', String(threadId), 'messages'), {
      fromUid: me,
      text: body,
      createdAt: serverTimestamp(),
    });

    await updateDoc(doc(db, 'chats', String(threadId)), {
      lastText: body,
      lastFromUid: me,
      updatedAt: serverTimestamp(),
    });

    // Notificación para el otro
    await addDoc(collection(db, 'notifications', otherUid, 'items'), {
      type: 'message',
      fromUid: me,
      threadId,
      text: body,
      createdAt: serverTimestamp(),
      seen: false,
    });

    setText('');
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  };

  const title = useMemo(() => {
    if (!otherUid) return 'Chat';
    const h = otherUser?.handle ? `@${otherUser.handle}` : null;
    const n = otherUser?.displayName || null;
    return h || n || `@user-${otherUid.slice(0, 6)}`;
  }, [otherUser, otherUid]);

  // UI — estilo tipo login/register con gradientes y tarjetas
  return (
    <LinearGradient colors={['#0b0b0d', '#000']} style={{ flex: 1 }}>
      {/* blobs */}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
        <LinearGradient
          colors={['rgba(124,77,255,0.28)', 'rgba(124,77,255,0.0)']}
          start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }}
          style={{ position: 'absolute', width: 320, height: 320, borderRadius: 160, top: -80, left: -80 }}
        />
        <LinearGradient
          colors={['rgba(255,77,222,0.22)', 'rgba(255,77,222,0.0)']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ position: 'absolute', width: 260, height: 260, borderRadius: 130, top: 220, right: -70 }}
        />
      </View>

      {/* Header */}
      <View style={{ paddingTop: (insets.top || 12) + 6, paddingHorizontal: 12, paddingBottom: 8 }}>
        <BlurView intensity={40} tint="dark" style={{ borderRadius: 16, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 10, gap: 10, borderWidth: 1, borderColor: '#1f2126', backgroundColor: '#0e1015aa' }}>
            <TouchableOpacity onPress={() => (router as any).canGoBack?.() ? router.back() : router.replace('/notifications')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="chevron-back" size={24} color="#fff" />
            </TouchableOpacity>
            {otherUid && <Avatar uid={otherUid} size={28} />}
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 18 }} numberOfLines={1}>{title}</Text>
          </View>
        </BlurView>
      </View>

      {/* Mensajes */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>
        <FlatList
          ref={listRef}
          data={msgs}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }}
          renderItem={({ item }) => {
            const mine = item.fromUid === me;
            return (
              <View style={{ marginVertical: 4, alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '78%' }}>
                <View
                  style={{
                    backgroundColor: mine ? '#1f1f2a' : '#15161c',
                    borderColor: mine ? '#2a2a3a' : '#1e2432',
                    borderWidth: 1,
                    borderRadius: 16,
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                  }}>
                  <Text style={{ color: '#fff' }}>{item.text}</Text>
                </View>
              </View>
            );
          }}
        />

        {/* Input */}
        <View style={{ paddingHorizontal: 12, paddingBottom: Math.max(12, insets.bottom) }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Escribe un mensaje…"
              placeholderTextColor="#8a8f98"
              style={{
                flex: 1,
                backgroundColor: '#13161c',
                color: '#fff',
                borderRadius: 18,
                paddingHorizontal: 14,
                paddingVertical: Platform.OS === 'ios' ? 12 : 10,
                borderWidth: 1,
                borderColor: '#232838',
              }}
              returnKeyType="send"
              onSubmitEditing={send}
            />
            <TouchableOpacity onPress={send} style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
              <Text style={{ color: '#fff', fontWeight: '800' }}>Enviar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}
