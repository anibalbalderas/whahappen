// app/record.tsx
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StatusBar, Animated, Easing, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';

import { setRecordedUri, getSelectedMode } from '../lib/session';
import { ensureAnonAuth, db } from '../lib/firebase';
import { getTodayChoice, lockTodayChoice, millisLeft, formatCountdown } from '../lib/choices';
import {
  doc, getDoc, collection, getDocs, limit, orderBy, documentId, query
} from 'firebase/firestore';

const MAX_SECONDS = 20;

// === Helpers + fetchInstructionFor (reemplaza este bloque en app/record.tsx) ===

const clean = (s?: any) =>
  String(s ?? '')
    .replace(/^[`'"]+|[`'"]+$/g, '')  // quita backticks/comillas al inicio/fin
    .replace(/^"+|"+$/g, '')          // comillas dobles extra
    .replace(/^'+|'+$/g, '')          // comillas simples extra
    .replace(/''/g, "'")
    .trim();

const normalize = (s?: string) =>
  (s ?? '')
    .toLowerCase()
    .replace(/^#/, '')                // "#caritativo" -> "caritativo"
    .replace(/^reto\s+/, '')          // "reto caritativo" -> "caritativo"
    .replace(/\s+/g, ' ')             // colapsa espacios
    .trim()
    .normalize('NFD')                 // elimina acentos: "pícaro" -> "picaro"
    .replace(/[\u0300-\u036f]/g, '');

const todayKey = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
};

/** Lee instruction desde /challenges/{YYYYMMDD}.categories[mode].instruction
 *  Si el doc de hoy no existe, usa el más reciente por id desc.
 *  Hace fuzzy-match de la categoría (normaliza nombres/acentos/“reto ”/#). */
async function fetchInstructionFor(modeRaw: string): Promise<{ title: string; instruction: string }> {
  const wanted = normalize(modeRaw) || 'global';

  // 1) Doc de hoy
  let data: any = null;
  try {
    const snap = await getDoc(doc(db, 'challenges', todayKey()));
    if (snap.exists()) data = snap.data();
  } catch (e) {
    console.log('🔴 getDoc(today) error', e);
  }

  // 2) Último doc si hoy no existe
  if (!data) {
    try {
      const qs = await getDocs(query(collection(db, 'challenges'), orderBy(documentId(), 'desc'), limit(1)));
      if (!qs.empty) data = qs.docs[0].data();
    } catch (e) {
      console.log('🔴 latest challenges doc error', e);
    }
  }

  // 3) categorías
  const cats = data?.categories && typeof data.categories === 'object' ? data.categories : null;
  if (!cats) {
    return { title: `Reto ${wanted}`, instruction: 'Completa el reto de esta categoría y compártelo en video.' };
  }

  // 4) mapa normalizado -> clave original
  const keys = Object.keys(cats);                // ej: ["caritativo","chill","creativo","picaro","rebelde","troll","global"]
  const normToOrig: Record<string, string> = {};
  for (const k of keys) normToOrig[normalize(k)] = k;

  // 5) elige clave: exacta, "global", o primera disponible
  let pickKey = normToOrig[wanted] ?? normToOrig['global'] ?? keys[0];

  // 6) obtiene instruction (soporta {instruction}, {instruccion}, {text} o string directo)
  const entry = cats[pickKey];
  const raw =
    typeof entry === 'string'
      ? entry
      : entry?.instruction ?? entry?.instruccion ?? entry?.text;

  let instruction = clean(raw);

  // 7) si aún no hay texto, busca la primera categoría con instrucción válida
  if (!instruction) {
    for (const k of keys) {
      const e = cats[k];
      const r = typeof e === 'string' ? e : e?.instruction ?? e?.instruccion ?? e?.text;
      if (r) { pickKey = k; instruction = clean(r); break; }
    }
  }

  const title = `Reto ${pickKey}`;
  return {
    title,
    instruction: instruction || 'Completa el reto de esta categoría y compártelo en video.'
  };
}
// === Fin del bloque ===

export default function Record() {
  const r = useRouter();
  const insets = useSafeAreaInsets();

  // permisos
  const [cameraPerm, requestCameraPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();

  // cámara
  const camRef = useRef<CameraView>(null);
  const [facing, setFacing] = useState<'back' | 'front'>('back');

  // popup
  const [popupVisible, setPopupVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [instruction, setInstruction] = useState('');
  const popOpacity = useRef(new Animated.Value(0)).current;
  const popScale = useRef(new Animated.Value(0.96)).current;

  const openPopup = () => {
    setPopupVisible(true);
    popOpacity.setValue(0);
    popScale.setValue(0.96);
    Animated.parallel([
      Animated.timing(popOpacity, { toValue: 1, duration: 240, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(popScale, { toValue: 1, duration: 240, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  };
  const closePopup = () => {
    Animated.parallel([
      Animated.timing(popOpacity, { toValue: 0, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(popScale, { toValue: 0.96, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start(({ finished }) => finished && setPopupVisible(false));
  };

  // grabación
  const [recording, setRecording] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<any>(null);
  const [elapsed, setElapsed] = useState(0);

  // lock del día
  const [timeLeft, setTimeLeft] = useState<number>(0);

  // anillo
  const SIZE = 96, STROKE = 6, HALF = SIZE / 2;
  const rightRot = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['0deg', '180deg', '180deg'] });
  const leftRot = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['0deg', '0deg', '180deg'] });
  const Half = ({ side, rotation }: { side: 'left' | 'right'; rotation: any }) => (
    <View style={{ position: 'absolute', width: HALF, height: SIZE, overflow: 'hidden', left: side === 'left' ? 0 : HALF, top: 0 }}>
      <Animated.View style={{
        position: 'absolute', left: side === 'left' ? 0 : -HALF, width: SIZE, height: SIZE,
        borderRadius: SIZE / 2, borderWidth: STROKE, borderColor: '#fff', transform: [{ rotateZ: rotation }]
      }}/>
    </View>
  );

  // montaje
  useEffect(() => {
    (async () => {
      await ensureAnonAuth();
      if (!cameraPerm?.granted) await requestCameraPerm();
      if (!micPerm?.granted) await requestMicPerm();

      const mode = normalize(getSelectedMode());

      // === Cargar reto con tolerancia a errores y SIEMPRE abrir popup ===
      let t = `Reto ${mode || 'global'}`;
      let inst = '';
      try {
        const res = await fetchInstructionFor(mode);
        if (res?.title) t = res.title;
        if (res?.instruction) inst = res.instruction;
      } catch (e) {
        console.log('🔴 [Record] fetchInstructionFor error', e);
      }
      if (!inst) {
        // fallback si no hubo instrucción
        inst = 'Completa el reto de esta categoría y compártelo en video.';
      }
      setTitle(t);
      setInstruction(inst);
      openPopup();
      // ================================================================

      // lock del día
      try {
        const { choice } = await getTodayChoice();
        if (!choice) {
          await lockTodayChoice(mode || 'global', 30);
          const again = await getTodayChoice();
          if (again.choice) setTimeLeft(millisLeft(again.choice.expiresAt));
        } else {
          const left = millisLeft(choice.expiresAt);
          if (normalize(choice.mode) !== mode && left > 0) {
            Alert.alert('Reto elegido', `Hoy ya elegiste: #${choice.mode}. Te quedan ${formatCountdown(left)}.`);
            r.replace('/'); return;
          }
          setTimeLeft(left);
        }
      } catch (e) {
        console.log('🔴 [Record] lock choice error', e);
      }
    })();

    const id = setInterval(async () => {
      try {
        const { choice } = await getTodayChoice();
        if (choice) setTimeLeft(millisLeft(choice.expiresAt));
      } catch {}
    }, 1000);

    return () => {
      clearInterval(id);
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (recording && timeLeft <= 0) {
      camRef.current?.stopRecording();
      if (timerRef.current) clearInterval(timerRef.current);
      setRecording(false);
      Alert.alert('Tiempo agotado', 'Se acabó el tiempo para completar el reto de hoy.');
      r.replace('/');
    }
  }, [timeLeft, recording, r]);

  const start = async () => {
    if (timeLeft <= 0) { Alert.alert('Tiempo agotado', 'Se acabó el tiempo para completar el reto de hoy.'); return; }
    if (!camRef.current) return;

    if (popupVisible) closePopup();

    progress.setValue(0);
    setElapsed(0);
    setRecording(true);

    Animated.timing(progress, { toValue: 1, duration: MAX_SECONDS * 1000, easing: Easing.linear, useNativeDriver: false }).start();

    const t0 = Date.now();
    timerRef.current = setInterval(() => setElapsed(Math.min(MAX_SECONDS, Math.floor((Date.now() - t0) / 1000))), 250);

    const res = await camRef.current.recordAsync({ maxDuration: MAX_SECONDS });
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);

    setRecordedUri(res?.uri ?? null);
    r.push('/review-upload');
  };

  const stop = () => {
    camRef.current?.stopRecording();
    if (timerRef.current) clearInterval(timerRef.current);
  };

  if (!cameraPerm?.granted) return <Text style={{ padding: 24, color: 'white' }}>Necesitamos permiso de cámara…</Text>;
  if (!micPerm?.granted)    return <Text style={{ padding: 24, color: 'white' }}>Necesitamos permiso de micrófono…</Text>;

  const TOP = (insets.top || 12) + 8;
  const BOTTOM = (insets.bottom || 12) + 28;
  const HUD_H = 36;

  return (
    <View style={{ flex: 1, backgroundColor: 'black' }}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <CameraView ref={camRef} style={{ flex: 1 }} facing={facing} mode="video" video audio />

      {/* Back */}
      <View style={{ position: 'absolute', top: (insets.top || 12) + 15, left: 12, zIndex: 20 }}>
        <TouchableOpacity onPress={() => { if ((r as any).canGoBack?.()) r.back(); else r.replace('/feed'); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Flip camera */}
      <TouchableOpacity
        onPress={() => setFacing(facing === 'back' ? 'front' : 'back')}
        style={{
          position: 'absolute', top: TOP, right: 12,
          width: HUD_H, height: HUD_H, borderRadius: HUD_H / 2,
          backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center'
        }}
        activeOpacity={0.9}
      >
        <Ionicons name="camera-reverse-outline" size={22} color="#fff" />
      </TouchableOpacity>

      {/* ===== Popup reto ===== */}
      {popupVisible && (
        <Animated.View
          style={{
            position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
            alignItems: 'center', justifyContent: 'center',
            opacity: popOpacity, transform: [{ scale: popScale }]
          }}
        >
          {/* blobs */}
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
            <LinearGradient colors={['rgba(124,77,255,0.28)', 'rgba(124,77,255,0.0)']} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }}
              style={{ position: 'absolute', width: 320, height: 320, borderRadius: 160, top: -80, left: -80 }} />
            <LinearGradient colors={['rgba(255,77,222,0.22)', 'rgba(255,77,222,0.0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ position: 'absolute', width: 260, height: 260, borderRadius: 130, top: 220, right: -70 }} />
          </View>

          <BlurView intensity={40} tint="dark" style={{ width: '86%', borderRadius: 22, overflow: 'hidden' }}>
            <View style={{ borderRadius: 22, borderWidth: 1, borderColor: '#1f2126', backgroundColor: '#0e1015ee', padding: 18 }}>
              <Text style={{ color: '#9aa0a6', fontWeight: '800', marginBottom: 4 }}>{title}</Text>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 22, lineHeight: 28 }}>
                {instruction}
              </Text>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <TouchableOpacity onPress={closePopup} style={{ flex: 1 }}>
                  <View style={{ backgroundColor: 'white', paddingVertical: 10, borderRadius: 12, alignItems: 'center' }}>
                    <Text style={{ color: 'black', fontWeight: '900' }}>Entendido</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          </BlurView>
        </Animated.View>
      )}

      {/* countdown */}
      {timeLeft > 0 && (
        <View style={{ position: 'absolute', top: 76, left: 0, right: 0, alignItems: 'center' }}>
          <View style={{ backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 }}>
            <Text style={{ color: 'white', fontWeight: '700' }}>⏳ {formatCountdown(timeLeft)}</Text>
          </View>
        </View>
      )}

      {/* controles de grabación */}
      <View style={{ position: 'absolute', bottom: (insets.bottom || 12) + 28, width: '100%', alignItems: 'center', gap: 10 }}>
        {!recording ? (
          <TouchableOpacity onPress={start} activeOpacity={0.9}>
            <View style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: SIZE - 18, height: SIZE - 18, borderRadius: 999, backgroundColor: 'red', borderWidth: 6, borderColor: 'white' }} />
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={stop} activeOpacity={0.9}>
            <View style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ position: 'absolute', width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: STROKE, borderColor: '#ffffff44' }} />
              <Half side="left" rotation={leftRot} />
              <Half side="right" rotation={rightRot} />
              <View style={{ position: 'absolute', width: 34, height: 34, borderRadius: 8, backgroundColor: 'white' }} />
            </View>
          </TouchableOpacity>
        )}
        <Text style={{ color: 'white', opacity: 0.9 }}>
          {recording ? `Grabando… ${elapsed}s / ${MAX_SECONDS}s` : 'Toca para grabar'}
        </Text>
      </View>
    </View>
  );
}
