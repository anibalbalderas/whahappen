import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, TextInput, Keyboard, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import { Video } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { getRecordedUri, getSelectedMode, setLastSubmissionId } from '../lib/session';
import { ensureAnonAuth, auth, db, storage } from '../lib/firebase';
import { todayKey } from '../lib/date';
import { markTodayChoiceCompleted } from '../lib/choices';

import { ref, uploadBytesResumable, uploadBytes, getDownloadURL } from 'firebase/storage';
import { addDoc, collection, serverTimestamp, setDoc, doc, getDoc } from 'firebase/firestore';

import * as FileSystem from 'expo-file-system';
import { Buffer } from 'buffer';
(global as any).Buffer = (global as any).Buffer || Buffer;

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

  useEffect(() => { setUri(getRecordedUri() ?? null); }, []);
  useEffect(() => {
    (async () => {
      if (playerRef.current) {
        await playerRef.current.setIsLoopingAsync(true);
        await playerRef.current.playAsync();
        setPlaying(true);
      }
    })();
  }, [playerRef.current]);

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
    if ('isPlaying' in status && status.isPlaying) {
      await playerRef.current.pauseAsync();
      setPlaying(false);
    } else {
      await playerRef.current.playAsync();
      setPlaying(true);
    }
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
          const unsub = task.on(
            'state_changed',
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
          uid,
          dateKey,
          mode,
          caption: caption.trim(),
          videoPath: filePath,
          videoURL: url,
          userDisplayName,
          userHandle,
          userPhotoURL,
          likesCount: 0,
          commentsCount: 0,
          createdAt: serverTimestamp(),
        });
      setLastSubmissionId(docRef.id);

      // Desbloquea feed SOLO hoy y marca reto como completado
      await setDoc(doc(db, 'users', uid), { unlockedDateKey: dateKey }, { merge: true });
      await markTodayChoiceCompleted();

      setUploading(false);
      r.replace('/feed'); // principal = feed
    } catch (err: any) {
      setUploading(false);
      Alert.alert('Error al subir', err?.message ?? 'Intenta con un clip más corto.');
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding', android: undefined })} style={{ flex: 1 }}>
      <View style={{ flex: 1, backgroundColor: 'black' }}>
        <Pressable style={{ flex: 1 }} onPress={onTapVideo}>
          <Video
            ref={playerRef}
            source={{ uri }}
            style={{ flex: 1 }}
            resizeMode="cover"
            useNativeControls={false}
            shouldPlay
            isLooping
          />
        </Pressable>

        {!playing && (
          <TouchableOpacity
            onPress={togglePlay}
            style={{ position: 'absolute', alignSelf: 'center', top: '45%' }}
            activeOpacity={0.8}
          >
            <Ionicons name="play-circle" size={84} color="#ffffffcc" />
          </TouchableOpacity>
        )}

        {showCaptionBox && (
          <View style={{ position: 'absolute', left: 16, right: 16, bottom: 110, gap: 8 }}>
            <Text style={{ color: 'white', fontWeight: '600' }}>Descripción</Text>
            <TextInput
              value={caption}
              onChangeText={setCaption}
              placeholder="Escribe algo…"
              placeholderTextColor="#aaa"
              maxLength={140}
              style={{ color: 'white', borderWidth: 1, borderColor: '#333', borderRadius: 12, padding: 12, backgroundColor: 'rgba(0,0,0,0.35)' }}
            />
          </View>
        )}

        <View style={{ position: 'absolute', left: 16, right: 16, bottom: 40 }}>
          <TouchableOpacity
            disabled={uploading}
            onPress={upload}
            style={{ backgroundColor: 'white', padding: 14, borderRadius: 12, opacity: uploading ? 0.6 : 1 }}
          >
            {uploading ? (
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator />
                <Text>Subiendo… {pct}%</Text>
              </View>
            ) : (
              <Text style={{ color: 'black', textAlign: 'center', fontWeight: '700' }}>Publicar</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
