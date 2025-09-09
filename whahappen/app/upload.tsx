import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Video } from 'expo-av';
import { getRecordedUri, getSelectedMode } from '../lib/session';
import { ensureAnonAuth, auth, db, storage } from '../lib/firebase';
import { ref, uploadBytesResumable, uploadBytes, getDownloadURL } from 'firebase/storage';
import { addDoc, collection, serverTimestamp, setDoc, doc } from 'firebase/firestore';
import { todayKey } from '../lib/date';
import { useRouter } from 'expo-router';

export default function ReviewUpload() {
  const [uri, setUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pct, setPct] = useState<number>(0);
  const r = useRouter();

  useEffect(() => {
    setUri(getRecordedUri() ?? null);
  }, []);

  if (!uri) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center' }}>
        <Text>No hay video para revisar.</Text>
      </View>
    );
  }

  const upload = async () => {
    try {
      setUploading(true);
      setPct(0);

      await ensureAnonAuth();
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error('No hay usuario autenticado');

      const dateKey = todayKey();
      const mode = getSelectedMode();
      const ts = Date.now();
      const filePath = `videos/${uid}/${dateKey}_${mode}_${ts}.mp4`;
      const videoRef = ref(storage, filePath);

      const resp = await fetch(uri);
      const blob = await resp.blob();

      const task = uploadBytesResumable(videoRef, blob, { contentType: 'video/mp4' });
      const done = new Promise<void>((resolve, reject) => {
        const unsub = task.on(
          'state_changed',
          snap => setPct(Math.round((snap.bytesTransferred / (snap.totalBytes || 1)) * 100)),
          err => { unsub(); reject(err); },
          () => { unsub(); resolve(); }
        );
      });

      const timeout = new Promise<void>((_, reject) =>
        setTimeout(() => { try { task.cancel(); } catch {} ; reject(new Error('Tiempo de espera excedido.')); }, 90000)
      );

      await Promise.race([done, timeout]);
      const url = await getDownloadURL(videoRef);

      await addDoc(collection(db, 'submissions'), {
        uid,
        dateKey,
        mode,
        videoPath: filePath,
        videoURL: url,
        likesCount: 0,
        createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'users', uid), { unlockedDateKey: dateKey }, { merge: true });

      setUploading(false);
      r.replace('/feed');
    } catch (err: any) {
      console.warn('[UPLOAD][ERROR]', err?.message || err);
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) throw new Error('No hay usuario autenticado');

        const dateKey = todayKey();
        const mode = getSelectedMode();
        const ts = Date.now();
        const filePath = `videos/${uid}/${dateKey}_${mode}_${ts}_fallback.mp4`;
        const videoRef = ref(storage, filePath);

        const resp2 = await fetch(uri!);
        const blob2 = await resp2.blob();
        await uploadBytes(videoRef, blob2, { contentType: 'video/mp4' });
        const url2 = await getDownloadURL(videoRef);

        await addDoc(collection(db, 'submissions'), {
          uid,
          dateKey,
          mode,
          videoPath: filePath,
          videoURL: url2,
          likesCount: 0,
          createdAt: serverTimestamp(),
        });
        await setDoc(doc(db, 'users', uid), { unlockedDateKey: dateKey }, { merge: true });

        setUploading(false);
        r.replace('/feed');
      } catch (err2: any) {
        console.error('[UPLOAD][FALLBACK][ERROR]', err2?.message || err2);
        setUploading(false);
        Alert.alert('Error al subir', err2?.message ?? 'Intenta de nuevo con un clip más corto (5–8s).');
      }
    }
  };

  return (
    <View style={{ flex: 1, padding: 16, gap: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: '600' }}>Revisión</Text>
      <Video
        source={{ uri }}
        style={{ height: 420, backgroundColor: '#000', borderRadius: 12 }}
        resizeMode="cover"
        useNativeControls
        shouldPlay={false}
      />
      <TouchableOpacity
        disabled={uploading}
        onPress={upload}
        style={{ backgroundColor: 'black', padding: 14, borderRadius: 12, opacity: uploading ? 0.6 : 1 }}
      >
        {uploading ? (
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color="#fff" />
            <Text style={{ color: 'white' }}>Subiendo… {pct}%</Text>
          </View>
        ) : (
          <Text style={{ color: 'white', textAlign: 'center' }}>Subir y desbloquear feed</Text>
        )}
      </TouchableOpacity>
      <Text style={{ fontSize: 12, opacity: 0.6, textAlign: 'center' }}>
        Si tarda mucho, intenta grabar un clip corto (5–8s) y asegúrate de tener Wi-Fi.
      </Text>
    </View>
  );
}
