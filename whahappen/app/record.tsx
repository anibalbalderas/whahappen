// app/record.tsx
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StatusBar, Animated, Easing, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { setRecordedUri, getSelectedMode } from '../lib/session';
import { ensureAnonAuth } from '../lib/firebase';
import { getChallengeInstruction } from '../lib/challenges';
import { getTodayChoice, lockTodayChoice, millisLeft, formatCountdown } from '../lib/choices';

const MAX_SECONDS = 20;

export default function Record() {
  const r = useRouter();
  const insets = useSafeAreaInsets();

  // Permisos
  const [cameraPerm, requestCameraPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();

  // Cámara
  const camRef = useRef<CameraView>(null);
  const [facing, setFacing] = useState<'back' | 'front'>('back');

  // UI reto (popup)
  const [challengeText, setChallengeText] = useState<string>('');
  const fade = useRef(new Animated.Value(0)).current;

  // Grabación
  const [recording, setRecording] = useState(false);
  const progress = useRef(new Animated.Value(0)).current; // 0→1 (anillo)
  const timerRef = useRef<any>(null);
  const [elapsed, setElapsed] = useState(0);

  // Lock/temporizador del reto del día
  const [timeLeft, setTimeLeft] = useState<number>(0); // ms restantes

  // ========= Anillo sin SVG =========
  const SIZE = 96;
  const STROKE = 6;
  const HALF = SIZE / 2;
  const rightRot = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['0deg', '180deg', '180deg'] });
  const leftRot  = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['0deg', '0deg', '180deg'] });

  const Half = ({ side, rotation }: { side: 'left' | 'right'; rotation: any }) => (
    <View style={{ position: 'absolute', width: HALF, height: SIZE, overflow: 'hidden', left: side === 'left' ? 0 : HALF, top: 0 }}>
      <Animated.View style={{
        position: 'absolute', left: side === 'left' ? 0 : -HALF, width: SIZE, height: SIZE,
        borderRadius: SIZE / 2, borderWidth: STROKE, borderColor: '#fff', transform: [{ rotateZ: rotation }]
      }}/>
    </View>
  );
  // ==================================

  // Montaje
  useEffect(() => {
    (async () => {
      await ensureAnonAuth();
      if (!cameraPerm?.granted) await requestCameraPerm();
      if (!micPerm?.granted) await requestMicPerm();

      const mode = getSelectedMode();

      // Reto
      try {
        const { text } = await getChallengeInstruction(mode);
        setChallengeText(text || (mode === 'global' ? 'Reto global' : `Reto ${mode}`));
        fade.setValue(0);
        Animated.sequence([
          Animated.timing(fade, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.delay(1800),
          Animated.timing(fade, { toValue: 0, duration: 360, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        ]).start();
      } catch {
        setChallengeText(mode === 'global' ? 'Reto global' : `Reto ${mode}`);
      }

      // Lock del día
      try {
        const { choice } = await getTodayChoice();
        if (!choice) {
          await lockTodayChoice(mode, 30);
          const again = await getTodayChoice();
          if (again.choice) setTimeLeft(millisLeft(again.choice.expiresAt));
        } else {
          const left = millisLeft(choice.expiresAt);
          if (choice.mode !== mode && left > 0) {
            Alert.alert('Reto elegido', `Hoy ya elegiste: #${choice.mode}. Te quedan ${formatCountdown(left)}.`);
            r.replace('/'); return;
          }
          setTimeLeft(left);
        }
      } catch {}
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

  // Si se acaba el tiempo durante la grabación
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
  const HUD_H = 36; // Alto fijo para alinear timer y botón de cámara

  return (
    <View style={{ flex: 1, backgroundColor: 'black' }}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <CameraView ref={camRef} style={{ flex: 1 }} facing={facing} mode="video" video audio />

      {/* Botón back */}
      <View style={{ position: 'absolute', top: (insets.top || 12) + 15, left: 12, zIndex: 20 }}>
        <TouchableOpacity
          onPress={() => { if ((r as any).canGoBack?.()) r.back(); else r.replace('/feed'); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
      </View>


      {/* Popup del reto */}
      {!!challengeText && (
        <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', opacity: fade }}>
          <Text style={{
            width: '70%', textAlign: 'center', color: 'white', fontSize: 28, fontWeight: '800', letterSpacing: 0.3,
            textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8,
          }} numberOfLines={3}>{challengeText}</Text>
        </Animated.View>
      )}

      {/* Countdown centrado arriba */}
      {timeLeft > 0 && (
        <View style={{
          position: 'absolute',
          top: 76,
          left: 0, right: 0,
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <View style={{
            backgroundColor: 'rgba(0,0,0,0.45)',
            paddingHorizontal: 14,
            paddingVertical: 6,
            borderRadius: 999
          }}>
            <Text style={{ color: 'white', fontWeight: '700' }}>⏳ {formatCountdown(timeLeft)}</Text>
          </View>
        </View>
      )}

      {/* 🔁 Flip camera (misma línea vertical) */}
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

      {/* Controles de grabación */}
      <View style={{ position: 'absolute', bottom: BOTTOM, width: '100%', alignItems: 'center', gap: 10 }}>
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
