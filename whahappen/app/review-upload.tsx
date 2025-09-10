// app/review-upload.tsx
import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, TextInput, Keyboard, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import { Video } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';

import { getRecordedUri, getSelectedMode, setLastSubmissionId } from '../lib/session';
import { ensureAnonAuth, auth, db, storage } from '../lib/firebase';
import { todayKey } from '../lib/date';
import { markTodayChoiceCompleted } from '../lib/choices';

import { ref, uploadBytesResumable, uploadBytes, getDownloadURL } from 'firebase/storage';
import { addDoc, collection, serverTimestamp, setDoc, doc, getDoc } from 'firebase/firestore';

import * as FileSystem from 'expo-file-system';
import { Buffer } from 'buffer';
(global as any).Buffer = (global as any).Buffer || Buffer;

// ---------- helpers upload ----------
async function uriToBlob(uri: string): Promise<Blob> {
  return await new Promise((resolve, reject) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.onerror = () => reject(new TypeError('Fallo al leer archivo por XHR'));
      xhr.responseType = 'blob';
      xhr.onload = () => resolve(xhr.response);
      xhr.open('GET', uri);
      xhr.send();
    } catch (e) { reject(e); }
  });
}
async function uriToBytesFallback(uri: string): Promise<Uint8Array> {
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  return Buffer.from(b64, 'base64');
}

export default function ReviewUpload() {
  const [uri, setUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pct, setPct] = useState<number>(0);
  const [caption, setCaption] = useState('');
  const [playing, setPlaying] = useState(true);
  const [showCaptionBox, setShowCaptionBox] = useState(true);

  const playerRef = useRef<Video>(null);
  const r = useRouter();
  const insets = useSafeAreaInsets();

  useEffect(() => { setUri(getRecordedUri() ?? null); }, []);
  useEffect(() => { (async () => {
    if (playerRef.current) {
      await playerRef.current.setIsLoopingAsync(true);
      await playerRef.current.playAsync();
      setPlaying(true);
    }
  })(); }, [playerRef.current]);

  if (!uri) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center' }}>
        <Text>No hay video para revisar.</Text>
      </View>
    );
  }

  const togglePlay = async () => {
    if (!playerRef.current) return;
    const status = await playerRef.current.getStatusAsync();
    if ('isPlaying' in status && status.isPlaying) { await playerRef.current.pauseAsync(); setPlaying(false); }
    else { await playerRef.current.playAsync(); setPlaying(true); }
  };

  const onTapVideo = async () => {
    await togglePlay();
    if (showCaptionBox) { Keyboard.dismiss(); setShowCaptionBox(false); }
    else { setShowCaptionBox(true); }
  };

  const upload = async () => {
    try {
      setUploading(true); setPct(0);
      await ensureAnonAuth();
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error('No hay usuario autenticado');

      const dateKey = todayKey();
      const mode = getSelectedMode();
      const ts = Date.now();
      const filePath = `videos/${uid}/${dateKey}_${mode}_${ts}.mp4`;
      const videoRef = ref(storage, filePath);

      let uploaded = false;
      try {
        const blob = await uriToBlob(uri!);
        if (!(blob as any)?.size) throw new Error('Blob vacío');
        const task = uploadBytesResumable(videoRef, blob, { contentType: 'video/mp4' });
        const done = new Promise<void>((resolve, reject) => {
          const unsub = task.on('state_changed',
            s => setPct(Math.round((s.bytesTransferred / (s.totalBytes || 1)) * 100)),
            e => { unsub(); reject(e); },
            () => { unsub(); resolve(); }
          );
        });
        const timeout = new Promise<void>((_, rej) => setTimeout(() => { try { task.cancel(); } catch {}; rej(new Error('Timeout')); }, 90_000));
        await Promise.race([done, timeout]);
        uploaded = true;
      } catch {
        const bytes = await uriToBytesFallback(uri!);
        await uploadBytes(videoRef, bytes, { contentType: 'video/mp4' });
        uploaded = true;
      }
      if (!uploaded) throw new Error('No se pudo subir el video');

      const url = await getDownloadURL(videoRef);
      const uSnap = await getDoc(doc(db, 'users', uid));
      const uData = uSnap.exists() ? uSnap.data() as any : {};
      const userDisplayName = uData.displayName || 'User';
      const userHandle = uData.handle || 'user';
      const userPhotoURL = uData.photoURL || null;

      // Guarda submission
      const docRef = await addDoc(collection(db, 'submissions'), {
        uid, dateKey, mode, caption: caption.trim(),
        videoPath: filePath, videoURL: url,
        userDisplayName, userHandle, userPhotoURL,
        likesCount: 0, commentsCount: 0, createdAt: serverTimestamp(),
      });
      setLastSubmissionId(docRef.id);

      // Desbloquea feed y marca reto como completado
      await setDoc(doc(db, 'users', uid), { unlockedDateKey: dateKey }, { merge: true });
      await markTodayChoiceCompleted();

      setUploading(false);
      r.replace('/feed');
    } catch (err: any) {
      setUploading(false);
      Alert.alert('Error al subir', err?.message ?? 'Intenta con un clip más corto.');
    }
  };

  const CAPTION_BOTTOM = (insets.bottom || 12) + 120;

  // ---------- Fondo decor (mismo look & feel) ----------
  const BackgroundDecor = () => (
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
        style={{ position: 'absolute', width: 420, height: 420, borderRadius: 210, bottom: -140, left: '15%', transform: [{ rotate: '25deg' }] }}
      />
    </View>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding', android: undefined })} style={{ flex: 1 }}>
    {/* Botón back */}
    <View style={{ position: 'absolute', top: (insets.top || 12) + 15, left: 12, zIndex: 20 }}>
      <TouchableOpacity
        onPress={() => { if ((r as any).canGoBack?.()) r.back(); else r.replace('/feed'); }}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="chevron-back" size={28} color="#fff" />
      </TouchableOpacity>
    </View>

      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <BackgroundDecor />

        <Pressable style={{ flex: 1 }} onPress={onTapVideo}>
          <Video ref={playerRef} source={{ uri }} style={{ flex: 1 }} resizeMode="cover" useNativeControls={false} shouldPlay isLooping />
        </Pressable>

        {!playing && (
          <TouchableOpacity onPress={togglePlay} style={{ position: 'absolute', alignSelf: 'center', top: '45%' }} activeOpacity={0.8}>
            <Ionicons name="play-circle" size={84} color="#ffffffcc" />
          </TouchableOpacity>
        )}

        {/* Tarjeta de descripción con blur/borde (misma línea visual que las cards de Profile) */}
        {showCaptionBox && (
          <View style={{ position: 'absolute', left: 16, right: 16, bottom: CAPTION_BOTTOM }}>
            <BlurView intensity={40} tint="dark" style={{ borderRadius: 16, overflow: 'hidden' }}>
              <View style={{ borderRadius: 16, borderWidth: 1, borderColor: '#1f2126', padding: 12, backgroundColor: '#0e1015aa' }}>
                <Text style={{ color: 'white', fontWeight: '800', marginBottom: 6 }}>Descripción</Text>
                <TextInput
                  value={caption}
                  onChangeText={setCaption}
                  placeholder="Escribe algo…"
                  placeholderTextColor="#b6bac2"
                  maxLength={140}
                  style={{ color: 'white', backgroundColor: 'transparent', paddingHorizontal: 8, paddingVertical: 10, borderRadius: 10 }}
                />
              </View>
            </BlurView>
          </View>
        )}

        {/* Botón publicar (blanco, full width) */}
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: (insets.bottom || 12) + 32 }}>
          <TouchableOpacity
            disabled={uploading}
            onPress={upload}
            style={{ backgroundColor: 'white', paddingVertical: 14, borderRadius: 12, opacity: uploading ? 0.6 : 1 }}
            activeOpacity={0.9}
          >
            {uploading ? (
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator />
                <Text style={{ color: 'black', fontWeight: '800' }}>Subiendo… {pct}%</Text>
              </View>
            ) : (
              <Text style={{ color: 'black', textAlign: 'center', fontWeight: '900' }}>Publicar</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
