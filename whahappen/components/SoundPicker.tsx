// components/SoundPicker.tsx
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, FlatList, TextInput, Image, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { db } from '../lib/firebase';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';

type SoundDoc = {
  id: string;
  title: string;
  artist?: string;
  category?: string;
  audioURL: string;
  coverURL?: string;
  durationMs?: number;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onPick: (s: { url: string; title: string; coverURL?: string; durationMs?: number }) => void;
};

export default function SoundPicker({ visible, onClose, onPick }: Props) {
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<SoundDoc[]>([]);
  const [queryText, setQueryText] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  const stopPreview = async () => { try { await soundRef.current?.stopAsync(); } catch {} finally { await soundRef.current?.unloadAsync(); soundRef.current = null; setPreviewId(null); } };
  const playPreview = async (item: SoundDoc) => {
    try {
      if (previewId === item.id) { await stopPreview(); return; }
      await stopPreview();
      const { sound } = await Audio.Sound.createAsync({ uri: item.audioURL }, { shouldPlay: true, isLooping: false, volume: 1 });
      soundRef.current = sound;
      setPreviewId(item.id);
      sound.setOnPlaybackStatusUpdate((st: any) => { if (st.didJustFinish) stopPreview(); });
    } catch {}
  };

  useEffect(() => {
    if (!visible) { stopPreview(); }
  }, [visible]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const qy = query(collection(db, 'sounds'), orderBy('title', 'asc'));
        const snap = await getDocs(qy);
        const arr: SoundDoc[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        setList(arr);
      } finally { setLoading(false); }
    })();
  }, []);

  const filtered = list.filter(x => {
    const q = queryText.trim().toLowerCase();
    if (!q) return true;
    return x.title.toLowerCase().includes(q) || (x.artist || '').toLowerCase().includes(q) || (x.category || '').toLowerCase().includes(q);
  });

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#0b0b0dcc' }}>
        <View style={{ flex: 1 }} />
        <View style={{ backgroundColor: '#0f1116', borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 10, paddingBottom: 14, borderWidth: 1, borderColor: '#1f2230' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8 }}>
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 18, flex: 1 }}>Sonidos</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color="#fff" /></TouchableOpacity>
          </View>

          <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
            <TextInput
              placeholder="Buscar por título, artista o categoria..."
              placeholderTextColor="#8a8f98"
              value={queryText}
              onChangeText={setQueryText}
              style={{ backgroundColor: '#13161c', color: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#232838' }}
            />
          </View>

          {loading ? (
            <View style={{ padding: 20, alignItems: 'center' }}><ActivityIndicator /></View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={x => x.id}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: '#1f2230', marginLeft: 16 }} />}
              renderItem={({ item }) => (
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 16, gap: 12 }}>
                  {item.coverURL ? (
                    <Image source={{ uri: item.coverURL }} style={{ width: 48, height: 48, borderRadius: 8 }} />
                  ) : (
                    <View style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: '#1a1d25', alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="musical-notes-outline" size={22} color="#9aa0a6" />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '800' }} numberOfLines={1}>{item.title}</Text>
                    <Text style={{ color: '#9aa0a6', fontSize: 12 }} numberOfLines={1}>{item.artist || item.category || '—'}</Text>
                  </View>
                  <TouchableOpacity onPress={() => playPreview(item)} style={{ paddingHorizontal: 10, paddingVertical: 6 }}>
                    <Ionicons name={previewId === item.id ? 'pause' : 'play'} size={20} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => { onPick({ url: item.audioURL, title: item.title, coverURL: item.coverURL, durationMs: item.durationMs }); onClose(); }}
                    style={{ backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 }}
                  >
                    <Text style={{ color: '#000', fontWeight: '800' }}>Usar</Text>
                  </TouchableOpacity>
                </View>
              )}
              style={{ maxHeight: 360 }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}
