// app/review-upload.tsx
import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, TextInput, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import { Video } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';

import { getRecordedUri, getSelectedMode } from '../lib/session';
import { ensureAnonAuth, auth, db, storage } from '../lib/firebase';
import { todayKey } from '../lib/date';
import { ref, uploadBytesResumable, uploadBytes, getDownloadURL } from 'firebase/storage';
import { addDoc, collection, serverTimestamp, setDoc, doc } from 'firebase/firestore';

// Preview de edición
import OverlaysRenderer from '../components/OverlaysRenderer';

// ---- helpers draft ----
async function loadDraftSafe(): Promise<any | null> {
  try {
    const mod: any = await import('../lib/draft');
    const fn = mod?.getDraft || mod?.loadDraft || mod?.readDraft || mod?.default;
    if (typeof fn === 'function') return (await fn()) ?? null;
  } catch {}
  return null;
}

// normaliza overlays (por si llegan en segundos o con claves distintas)
function normalizeOverlays(raw: any[] | null | undefined) {
  const list = Array.isArray(raw) ? raw : [];
  return list.map((o: any) => {
    const base = { ...o };
    let s = base.startMs ?? base.start ?? 0;
    let e = base.endMs ?? base.end ?? (s + 2000);
    const factor = (s <= 600 && e <= 600) ? 1000 : 1; // segundos -> ms
    s = Math.max(0, Math.round(s * factor));
    e = Math.max(s + 10, Math.round(e * factor));
    return { ...base, startMs: s, endMs: e };
  });
}

export default function ReviewUpload() {
  const [uri, setUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pct, setPct] = useState(0);
  const [caption, setCaption] = useState('');

  const playerRef = useRef<Video>(null);
  const [playing, setPlaying] = useState(true);
  const r = useRouter();
  const insets = useSafeAreaInsets();

  const [draft, setDraft] = useState<any | null>(null);
  const [curMs, setCurMs] = useState(0);
  const seekedOnce = useRef(false);

  useEffect(() => { setUri(getRecordedUri() ?? null); loadDraftSafe().then(setDraft); }, []);
  useEffect(() => { (async () => {
    if (playerRef.current) {
      await playerRef.current.setIsLoopingAsync(true);
      await playerRef.current.playAsync();
      setPlaying(true);
    }
  })(); }, [playerRef.current]);

  if (!uri) {
    return <View style={{ flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center' }}>
      <Text>No hay video para revisar.</Text>
    </View>;
  }

  const togglePlay = async () => {
    if (!playerRef.current) return;
    const status = await playerRef.current.getStatusAsync();
    if ('isPlaying' in status && status.isPlaying) { await playerRef.current.pauseAsync(); setPlaying(false); }
    else { await playerRef.current.playAsync(); setPlaying(true); }
  };

  // preview editada (trim/overlays)
  const startMs = draft?.trim?.startMs ?? 0;
  const endMs   = draft?.trim?.endMs ?? Number.MAX_SAFE_INTEGER;
  const overlays = Array.isArray(draft?.overlays) ? draft.overlays : [];
  const onStatus = async (st: any) => {
    if (!st?.isLoaded) return;
    const p   = st.positionMillis ?? 0;
    const dur = st.durationMillis ?? Number.MAX_SAFE_INTEGER;
    const E   = Math.min(endMs, dur);
    if (!seekedOnce.current && startMs > 0) {
      seekedOnce.current = true;
      try { await playerRef.current?.setPositionAsync(startMs); } catch {}
      setCurMs(startMs);
      return;
    }
    if (p < startMs - 15) { try { await playerRef.current?.setPositionAsync(startMs); } catch {}; setCurMs(startMs); return; }
    if (p > E - 40)       { try { await playerRef.current?.setPositionAsync(startMs); } catch {}; setCurMs(startMs); return; }
    setCurMs(p);
  };

  // ---- SUBIR (guardando EDICIONES) ----
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

      // prepara edits desde draft
      const edits: any = {};
      if (draft?.trim) {
        const s = Number(draft.trim.startMs || 0);
        const e = typeof draft.trim.endMs === 'number' ? Number(draft.trim.endMs) : undefined;
        edits.trim = { startMs: s, ...(typeof e === 'number' ? { endMs: e } : {}) };
      }
      if (Array.isArray(draft?.overlays) && draft.overlays.length) {
        edits.overlays = normalizeOverlays(draft.overlays);
      }
      if (draft?.audio) {
        edits.audio = {
          url: draft.audio.url,
          title: draft.audio.title || 'Audio',
          ...(typeof draft.audio.volume === 'number' ? { volume: draft.audio.volume } : {}),
        };
      }
      if (draft?.voice) {
        edits.voice = {
          url: draft.voice.url,
          ...(typeof draft.voice.startMs === 'number' ? { startMs: draft.voice.startMs } : {}),
          ...(typeof draft.voice.endMs === 'number' ? { endMs: draft.voice.endMs } : {}),
          ...(typeof draft.voice.volume === 'number' ? { volume: draft.voice.volume } : {}),
        };
      }
      if (typeof draft?.muteOriginal === 'boolean') edits.muteOriginal = draft.muteOriginal;

      let uploaded = false;

      // 1) resumable con progreso
      try {
        const resp = await fetch(uri!);
        const blob = await resp.blob();
        if (!(blob as any)?.size) throw new Error('Blob vacío');

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
        uploaded = true;
      } catch {
        // 2) fallback: uploadBytes
        const resp2 = await fetch(uri!);
        const blob2 = await resp2.blob();
        await uploadBytes(videoRef, blob2, { contentType: 'video/mp4' });
        uploaded = true;
        setPct(100);
      }

      if (!uploaded) throw new Error('No se pudo subir el video');

      const url = await getDownloadURL(videoRef);

      await addDoc(collection(db, 'submissions'), {
        uid,
        dateKey,
        mode,
        videoPath: filePath,
        videoURL: url,
        caption: caption?.trim?.() || '',
        likesCount: 0,
        commentsCount: 0,
        createdAt: serverTimestamp(),
        // <-- ahora SÍ guardamos las ediciones:
        edits,
      });

      await setDoc(doc(db, 'users', uid), { unlockedDateKey: dateKey }, { merge: true });

      setUploading(false);
      r.replace('/feed');
    } catch (err: any) {
      console.warn('[REVIEW UPLOAD][ERROR]', err?.message || err);
      // fallback extra
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

        // re-usa las mismas ediciones preparadas arriba (si quieres, podrías mover la preparación aquí también)
        const edits2 = {};
        Object.assign(edits2, (draft?.trim || draft?.overlays || draft?.audio || draft?.voice || typeof draft?.muteOriginal === 'boolean')
          ? {
              ...(draft?.trim ? { trim: { startMs: Number(draft.trim.startMs || 0), ...(typeof draft.trim.endMs === 'number' ? { endMs: Number(draft.trim.endMs) } : {}) } } : {}),
              ...(Array.isArray(draft?.overlays) && draft.overlays.length ? { overlays: normalizeOverlays(draft.overlays) } : {}),
              ...(draft?.audio ? { audio: { url: draft.audio.url, title: draft.audio.title || 'Audio', ...(typeof draft.audio.volume === 'number' ? { volume: draft.audio.volume } : {}) } } : {}),
              ...(draft?.voice ? { voice: { url: draft.voice.url, ...(typeof draft.voice.startMs === 'number' ? { startMs: draft.voice.startMs } : {}), ...(typeof draft.voice.endMs === 'number' ? { endMs: draft.voice.endMs } : {}) } } : {}),
              ...(typeof draft?.muteOriginal === 'boolean' ? { muteOriginal: draft.muteOriginal } : {}),
            }
          : {}
        );

        await addDoc(collection(db, 'submissions'), {
          uid, dateKey, mode, videoPath: filePath, videoURL: url2,
          caption: caption?.trim?.() || '',
          likesCount: 0, commentsCount: 0, createdAt: serverTimestamp(),
          edits: edits2,
        });

        await setDoc(doc(db, 'users', uid), { unlockedDateKey: dateKey }, { merge: true });

        setUploading(false);
        r.replace('/feed');
      } catch (err2: any) {
        setUploading(false);
        Alert.alert('Error al subir', err2?.message ?? 'Intenta con un clip más corto.');
      }
    }
  };

  const CAPTION_BOTTOM = (insets.bottom || 12) + 120;

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
      {/* Top bar */}
      <View style={{ position: 'absolute', top: (insets.top || 12) + 12, left: 12, right: 12, zIndex: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <TouchableOpacity onPress={() => { if ((r as any).canGoBack?.()) r.back(); else r.replace('/feed'); }}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => r.push('/editor')}
          style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#ffffff' }} activeOpacity={0.9}>
          <Text style={{ color: '#000', fontWeight: '900' }}>Editar</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <BackgroundDecor />
        <Pressable style={{ flex: 1 }} onPress={togglePlay}>
          <Video
            ref={playerRef}
            source={{ uri }}
            style={{ flex: 1 }}
            resizeMode="cover"
            useNativeControls={false}
            shouldPlay
            isLooping
            onPlaybackStatusUpdate={onStatus}
            progressUpdateIntervalMillis={80}
          />
          <View pointerEvents="none" style={{ position:'absolute', left:0, top:0, right:0, bottom:0 }}>
            <OverlaysRenderer overlays={overlays} currentMs={curMs} />
          </View>
        </Pressable>

        {/* Caja de descripción (visual) */}
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: (insets.bottom || 12) + 120 }}>
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

        {/* Botón publicar (sube aquí) */}
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
