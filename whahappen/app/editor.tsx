// app/editor.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity,
  TextInput, Pressable, Keyboard, ScrollView, Animated, Easing, Platform
} from 'react-native';
import { Video, Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';

import { getRecordedUri } from '../lib/session';
import Timeline, { Track, Clip } from '../components/Timeline';
import MovableOverlay, { Movable } from '../components/MovableOverlay';
import OverlaysRenderer from '../components/OverlaysRenderer';
import SoundPicker from '../components/SoundPicker';
import { saveDraft } from '../lib/draft';

/* ───────────── THEME ───────────── */
const T = {
  bg: ['#0b0b0d', '#000000'],
  card: 'rgba(17,19,26,0.78)',
  border: '#232838',
  borderSoft: '#1f2230',
  text: '#ffffff',
  textDim: '#9aa0a6',
  pill: '#121319',
  white: '#ffffff',
};
const shadow = Platform.select({
  ios: { shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 10 } },
  android: { elevation: 12 },
});
const glass = { borderRadius: 16, overflow: 'hidden' as const, borderWidth: 1, borderColor: T.border, backgroundColor: T.card, ...shadow };

/* ───────────── DATA ───────────── */
type TabKey = 'edit' | 'sound' | 'text' | 'stickers' | 'voice' | 'volume';
const RIBBON: { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'edit', label: 'Editar', icon: 'cut-outline' },
  { key: 'sound', label: 'Sonido', icon: 'musical-notes-outline' },
  { key: 'text', label: 'Texto', icon: 'text-outline' as any },
  { key: 'stickers', label: 'Stickers', icon: 'happy-outline' },
  { key: 'voice', label: 'Voz', icon: 'mic-outline' },
  { key: 'volume', label: 'Volumen', icon: 'volume-high-outline' },
];
const COLORS = ['#ffffff','#ff2d55','#ffd60a','#0ad3ff','#6ee7b7','#c084fc'];
const EMOJIS = ['😄','🔥','👏','😍','😎','🤯','🙌','🕺','💃','🤟','🎉','🤖','✨','💡'];

/* ───────────── EDITOR ───────────── */
export default function Editor() {
  const r = useRouter();
  const insets = useSafeAreaInsets();
  const [uri, setUri] = useState<string | null>(null);

  // video
  const videoRef = useRef<Video>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [status, setStatus] = useState<{ positionMillis: number; durationMillis: number } | null>(null);

  // trim
  const [trimStartMs, setTrimStartMs] = useState(0);
  const [trimEndMs, setTrimEndMs] = useState<number | null>(null);

  // overlays
  const [overlays, setOverlays] = useState<(Movable & { startMs: number; endMs: number })[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // texto
  const [textDraft, setTextDraft] = useState('');
  const [textColor, setTextColor] = useState(COLORS[0]);
  const [textSize, setTextSize] = useState(28);

  // BGM
  const [soundModal, setSoundModal] = useState(false);
  const [bgm, setBgm] = useState<{ url: string; title: string } | null>(null);
  const [bgmSound, setBgmSound] = useState<Audio.Sound | null>(null);
  const [bgmVol, setBgmVol] = useState(0.8);

  // Voice-over
  const [voice, setVoice] = useState<{ url: string; startMs: number; endMs: number } | null>(null);
  const [voiceSound, setVoiceSound] = useState<Audio.Sound | null>(null);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);

  // Mute original
  const [muteOriginal, setMuteOriginal] = useState(false);

  // timeline zoom
  const [pxPerMs, setPxPerMs] = useState(0.08);

  // panel
  const [activeTab, setActiveTab] = useState<TabKey>('edit'); // abierto por defecto
  const panelY = useRef(new Animated.Value(420)).current;
  const PANEL_HEIGHT = 360 + (insets.bottom || 0);

  useEffect(() => { setUri(getRecordedUri() ?? null); }, []);
  useEffect(() => { (async () => {
    if (videoRef.current) {
      await videoRef.current.setIsLoopingAsync(true);
      await videoRef.current.playAsync();
      setIsPlaying(true);
    }
  })(); }, [videoRef.current]);

  useEffect(() => {
    Animated.timing(panelY, {
      toValue: activeTab ? 0 : PANEL_HEIGHT,
      duration: 220,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [activeTab]);

  useEffect(() => () => { bgmSound?.unloadAsync(); voiceSound?.unloadAsync(); }, [bgmSound, voiceSound]);

  const curMs = status?.positionMillis ?? 0;
  const durMs = status?.durationMillis ?? 0;
  const endMs = trimEndMs ?? durMs;

  const visibleOverlays = useMemo(() => overlays.filter(o => curMs >= o.startMs && curMs < o.endMs), [overlays, curMs]);

  const onStatus = async (st: any) => {
    if (!st?.isLoaded) return;
    const pos = st.positionMillis ?? 0;
    const dur = st.durationMillis ?? 0;
    setStatus({ positionMillis: pos, durationMillis: dur });
    const end = trimEndMs ?? dur;
    if (pos > end - 30) {
      await videoRef.current?.setPositionAsync(trimStartMs);
      await syncAudios(trimStartMs);
      return;
    }
    await syncAudios(pos);
  };

  async function syncAudios(videoMs: number) {
    if (bgmSound) {
      const want = Math.min(Math.max(videoMs - trimStartMs, 0), (trimEndMs ?? durMs) - trimStartMs);
      try {
        const st = await bgmSound.getStatusAsync();
        if (videoMs < trimStartMs || videoMs > (trimEndMs ?? durMs)) {
          if (st.isPlaying) await bgmSound.pauseAsync();
        } else {
          if (!st.isPlaying && isPlaying) await bgmSound.playAsync();
          await bgmSound.setPositionAsync(want);
        }
      } catch {}
    }
    if (voice && voiceSound) {
      const inside = videoMs >= voice.startMs && videoMs <= voice.endMs;
      const want = Math.max(0, Math.min(videoMs - voice.startMs, voice.endMs - voice.startMs));
      try {
        const st = await voiceSound.getStatusAsync();
        if (inside) {
          if (!st.isPlaying && isPlaying) await voiceSound.playAsync();
          await voiceSound.setPositionAsync(want);
        } else {
          if (st.isPlaying) await voiceSound.pauseAsync();
        }
      } catch {}
    }
  }

  // cargar sonidos
  useEffect(() => { (async () => {
    if (!bgm) { await bgmSound?.unloadAsync(); setBgmSound(null); return; }
    const { sound } = await Audio.Sound.createAsync({ uri: bgm.url }, { shouldPlay: isPlaying, isLooping: true, volume: bgmVol });
    setBgmSound(sound);
    await sound.setPositionAsync(Math.max(0, curMs - trimStartMs));
  })(); }, [bgm?.url]);

  useEffect(() => { if (bgmSound) bgmSound.setVolumeAsync(bgmVol); }, [bgmVol, bgmSound]);
  useEffect(() => { (async () => {
    if (!voice?.url) { await voiceSound?.unloadAsync(); setVoiceSound(null); return; }
    const { sound } = await Audio.Sound.createAsync({ uri: voice.url }, { shouldPlay: false, isLooping: false, volume: 1 });
    setVoiceSound(sound);
  })(); }, [voice?.url]);

  // cargar draft
  useEffect(() => {
    (async () => {
      try {
        const mod: any = await import('../lib/draft');
        const fn = mod?.getDraft || mod?.loadDraft || mod?.readDraft || mod?.default;
        const d = typeof fn === 'function' ? await fn() : null;
        if (!d) return;

        if (d.trim) {
          setTrimStartMs(d.trim.startMs || 0);
          setTrimEndMs(typeof d.trim.endMs === 'number' ? d.trim.endMs : null);
        }
        if (Array.isArray(d.overlays)) setOverlays(d.overlays);
        if (d.audio) {
          setBgm({ url: d.audio.url, title: d.audio.title || 'Audio' });
          if (typeof d.audio.volume === 'number') setBgmVol(d.audio.volume);
        }
        if (d.voice) setVoice(d.voice);
        if (typeof d.muteOriginal === 'boolean') setMuteOriginal(d.muteOriginal);
      } catch {}
    })();
  }, []);

  const togglePlay = async () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      await videoRef.current.pauseAsync();
      await bgmSound?.pauseAsync();
      await voiceSound?.pauseAsync();
      setIsPlaying(false);
    } else {
      await videoRef.current.playAsync();
      if (bgmSound) await bgmSound.playAsync();
      setIsPlaying(true);
    }
  };

  // overlays
  const addText = () => {
    if (!textDraft.trim()) return;
    const id = Math.random().toString(36).slice(2, 9);
    const end = (trimEndMs ?? durMs) || (curMs + 3000);
    setOverlays(o => [...o, { id, type: 'text', text: textDraft.trim(), color: textColor, fontSize: textSize, x: 0.5, y: 0.6, scale: 1, startMs: curMs, endMs: Math.min(curMs + 3000, end) }]);
    setTextDraft(''); setSelectedId(id);
  };
  const addEmoji = (emoji: string) => {
    const id = Math.random().toString(36).slice(2, 9);
    const end = (trimEndMs ?? durMs) || (curMs + 2000);
    setOverlays(o => [...o, { id, type: 'emoji', emoji, x: 0.5, y: 0.5, scale: 1, startMs: curMs, endMs: Math.min(curMs + 2000, end) }]);
    setSelectedId(id);
  };

  // tracks & clips
  const tracks: Track[] = useMemo(() => {
    const arr: Track[] = [
      { key: 'video', label: 'Video' },
      { key: 'bgm', label: 'Música' },
      { key: 'voice', label: 'Voz' },
    ];
    overlays.forEach((o, i) => arr.push({ key: `ov-${o.id}`, label: o.type === 'text' ? `Texto ${i+1}` : `Sticker ${i+1}` }));
    return arr;
  }, [overlays]);

  const clips: Clip[] = useMemo(() => {
    const base: Clip[] = [
      { id: 'video', track: 'video', label: 'Clip', color: '#e5e7eb', startMs: trimStartMs, endMs: trimEndMs ?? durMs, movable: false, resizable: true, deletable: false },
    ];
    if (bgm) base.push({ id: 'bgm', track: 'bgm', label: 'BGM', color: '#a7f3d0', startMs: trimStartMs, endMs: trimEndMs ?? durMs, movable: false, resizable: false });
    if (voice) base.push({ id: 'voice', track: 'voice', label: 'Voz', color: '#fbcfe8', startMs: voice.startMs, endMs: voice.endMs, movable: true, resizable: true });
    overlays.forEach((o) => {
      base.push({ id: `ov-${o.id}`, track: `ov-${o.id}`, label: o.type === 'text' ? (o as any).text.slice(0, 10) || 'Texto' : 'Sticker', color: o.type === 'text' ? '#93c5fd' : '#fde68a', startMs: o.startMs, endMs: o.endMs, movable: true, resizable: true });
    });
    return base;
  }, [overlays, bgm, voice, trimStartMs, trimEndMs, durMs]);

  const onClipChange = (id: string, patch: Partial<Clip>) => {
    if (id === 'video') {
      if (typeof patch.startMs === 'number') setTrimStartMs(Math.max(0, Math.min(patch.startMs, (trimEndMs ?? durMs) - 300)));
      if (typeof patch.endMs === 'number') setTrimEndMs(Math.max(trimStartMs + 300, Math.min(patch.endMs, durMs)));
      return;
    }
    if (id === 'bgm') return;
    if (id === 'voice') {
      setVoice(v => v ? ({ ...v, startMs: patch.startMs ?? v.startMs, endMs: patch.endMs ?? v.endMs }) : v);
      return;
    }
    const ovId = id.replace('ov-', '');
    setOverlays(arr => arr.map(o => o.id === ovId ? ({ ...o, startMs: patch.startMs ?? o.startMs, endMs: patch.endMs ?? o.endMs }) : o));
  };

  const goPreview = () => {
    saveDraft({
      trim: { startMs: trimStartMs, endMs: trimEndMs ?? durMs },
      overlays,
      audio: bgm ? { url: bgm.url, title: bgm.title, volume: bgmVol } : null,
      voice,
      muteOriginal,
    });
    Keyboard.dismiss();
    // mantenemos UX al volver
    setActiveTab('edit');
    r.push('/review-upload');
  };

  // 👇 ahora sí cierra panel al tocar fuera
  const dismissAll = () => {
    Keyboard.dismiss();
    setActiveTab(null); // cierra el panel
  };

  if (!uri) {
    return <View style={{ flex:1, backgroundColor:'#000', alignItems:'center', justifyContent:'center' }}>
      <Text style={{ color:T.text }}>No hay video para editar.</Text>
    </View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {/* fondos */}
      <LinearGradient colors={T.bg} style={{ position: 'absolute', inset: 0 }} />
      <LinearGradient colors={['rgba(124,77,255,0.25)', 'transparent']} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }}
        style={{ position:'absolute', width:320, height:320, borderRadius:160, top:-80, left:-80, transform:[{ rotate:'18deg' }]}} />
      <LinearGradient colors={['rgba(0,210,255,0.18)', 'transparent']} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }}
        style={{ position:'absolute', width:420, height:420, borderRadius:210, bottom:-140, left:'15%', transform:[{ rotate:'25deg' }]}} />

      {/* Topbar */}
      <View style={{ paddingTop:(insets.top||12)+8, paddingHorizontal:12, paddingBottom:8, flexDirection:'row', alignItems:'center' }}>
        <TouchableOpacity onPress={() => ((r as any).canGoBack?.() ? r.back() : r.replace('/feed'))} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ padding:8 }}>
          <Ionicons name="close" size={20} color="#fff" />
        </TouchableOpacity>
        <Text numberOfLines={1} style={{ color: T.text, fontWeight: '900', fontSize: 18, textAlign: 'center', flex: 1, paddingHorizontal: 8 }}>
          Editor
        </Text>
        <View style={{ flexDirection: 'row', gap: 10, flexShrink: 0 }}>
          <Pill ghost onPress={goPreview} label="Vista previa" />
        </View>
      </View>

      {/* PREVIEW */}
      <Pressable
        onPress={() => {
          // si el panel está abierto, se cierra; si está cerrado, toggle play/pause
        if (activeTab) setActiveTab(null);
          else togglePlay();
        }}
        style={{ flex: 1 }}
      >
        <Video ref={videoRef} source={{ uri }} style={{ flex: 1 }} resizeMode="cover" isLooping shouldPlay
          onPlaybackStatusUpdate={onStatus} isMuted={muteOriginal} />
        <OverlaysRenderer overlays={visibleOverlays} currentMs={curMs} selectedId={selectedId} />
        {overlays.map((o) => {
          const visible = curMs >= o.startMs && curMs < o.endMs;
          if (!(selectedId === o.id && visible)) return null;
          return (
            <MovableOverlay key={o.id} item={o} selected
              onSelect={(id) => setSelectedId(id)}
              onChange={(patch) => setOverlays((arr) => arr.map((x) => (x.id === o.id ? { ...x, ...patch } : x)))}
            />
          );
        })}
      </Pressable>

      {/* RIBBON */}
      <View style={{ paddingBottom: (insets.bottom||8) + 12, paddingTop: 10 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 10 }}>
          {RIBBON.map(it => {
            const active = activeTab === it.key;
            return (
              <TouchableOpacity
                key={it.key}
                onPress={() => { Keyboard.dismiss(); setActiveTab(it.key); }} // abre siempre la pestaña tocada
                style={{
                  flexDirection:'row', alignItems:'center', gap:8,
                  paddingHorizontal:16, paddingVertical:10, borderRadius:999,
                  backgroundColor: active ? T.white : T.pill,
                  borderWidth: 1, borderColor: active ? T.white : T.border,
                  ...shadow,
                }}>
                <Ionicons name={it.icon} size={18} color={active ? '#000' : '#fff'} />
                <Text style={{ color: active ? '#000' : '#fff', fontWeight:'800' }}>{it.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* PANEL */}
      <Animated.View style={{ position:'absolute', left:12, right:12, bottom:12 + (insets.bottom||0), transform:[{ translateY: panelY }], ...glass }}>
        <BlurView intensity={40} tint="dark" style={{ ...glass }}>
          <View style={{ alignItems:'center', paddingTop:8 }}>
            <View style={{ width:44, height:4, borderRadius:2, backgroundColor:T.border }} />
          </View>
          <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ padding:12, gap:14 }}>
            {activeTab === 'edit' && (
              <>
                <SectionTitle icon="cut-outline" title="Recortar & Capas" />
                <View style={{ ...glass, borderRadius:12, backgroundColor:'#0b0c10' }}>
                  <Timeline
                    durationMs={durMs}
                    startMs={trimStartMs}
                    endMs={trimEndMs ?? durMs}
                    pxPerMs={pxPerMs}
                    setPxPerMs={setPxPerMs}
                    currentMs={curMs}
                    onSeek={async (ms) => { await videoRef.current?.setPositionAsync(ms); await syncAudios(ms); }}
                    tracks={tracks}
                    clips={clips}
                    onChange={onClipChange}
                    onDeleteClip={(id) => {
                      if (id === 'voice') setVoice(null);
                      else if (id === 'bgm') setBgm(null);
                      else if (id.startsWith('ov-')) setOverlays((arr) => arr.filter((o) => o.id !== id.replace('ov-','')));
                    }}
                  />
                </View>
                <View style={{ flexDirection:'row', justifyContent:'space-between' }}>
                  <Text style={{ color:T.textDim }}>Inicio: {(trimStartMs/1000).toFixed(1)}s</Text>
                  <Text style={{ color:T.textDim }}>Fin: {((endMs)/1000).toFixed(1)}s</Text>
                </View>
              </>
            )}

            {activeTab === 'sound' && (
              <>
                <SectionTitle icon="musical-notes-outline" title="Música" />
                <Row>
                  <Pill primary onPress={() => setSoundModal(true)} label={bgm ? 'Cambiar sonido' : 'Elegir sonido'} />
                  {!!bgm && <Text style={{ color:T.text }} numberOfLines={1}>🎵 {bgm.title}</Text>}
                  {!!bgm && <Pill danger ghost onPress={() => setBgm(null)} label="Quitar" />}
                </Row>
                {!!bgm && (
                  <Row space>
                    <Text style={{ color:T.textDim }}>Volumen</Text>
                    <Stepper value={bgmVol} onDec={() => setBgmVol(v=>Math.max(0, +(v-0.1).toFixed(2)))} onInc={() => setBgmVol(v=>Math.min(1, +(v+0.1).toFixed(2)))} />
                  </Row>
                )}
              </>
            )}

            {activeTab === 'text' && (
              <>
                <SectionTitle icon="text-outline" title="Texto" />
                <Row>
                  <Input value={textDraft} onChangeText={setTextDraft} placeholder="Añadir texto…" />
                  <Pill primary onPress={addText} label="Añadir" />
                </Row>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap:12 }}>
                  {COLORS.map(c => (
                    <TouchableOpacity key={c} onPress={() => setTextColor(c)} style={{
                      width:28, height:28, borderRadius:14, backgroundColor:c,
                      borderWidth:2, borderColor: textColor === c ? T.white : T.borderSoft
                    }} />
                  ))}
                  <View style={{ width:12 }} />
                  <Pill small ghost onPress={() => setTextSize(s=>Math.max(14,s-2))} label="A−" />
                  <Pill small ghost onPress={() => setTextSize(s=>Math.min(64,s+2))} label="A+" />
                </ScrollView>

                {!!selectedId && (
                  <>
                    <Text style={{ color:T.textDim }}>Capa seleccionada</Text>
                    <Row>
                      <CircleBtn onPress={() => setOverlays(arr => arr.map(o => o.id===selectedId ? { ...o, scale: Math.max(0.5,(o.scale||1)-0.1) } : o))}><Ionicons name="remove-circle-outline" color="#fff" size={18} /></CircleBtn>
                      <CircleBtn onPress={() => setOverlays(arr => arr.map(o => o.id===selectedId ? { ...o, scale: Math.min(4,(o.scale||1)+0.1) } : o))}><Ionicons name="add-circle-outline" color="#fff" size={18} /></CircleBtn>
                      <CircleBtn onPress={() => setOverlays(arr => arr.map(o => o.id===selectedId ? { ...o, rotation: ((o as any).rotation||0)+10 } : o))}><Ionicons name="refresh-outline" color="#fff" size={18} /></CircleBtn>
                      <CircleBtn danger onPress={() => setOverlays(arr => arr.filter(o => o.id!==selectedId))}><Ionicons name="trash-outline" color="#fff" size={18} /></CircleBtn>
                    </Row>
                  </>
                )}
              </>
            )}

            {activeTab === 'stickers' && (
              <>
                <SectionTitle icon="happy-outline" title="Stickers" />
                <View style={{ flexDirection:'row', flexWrap:'wrap', gap:10 }}>
                  {EMOJIS.map(e => (
                    <TouchableOpacity key={e} onPress={() => addEmoji(e)} style={{ width:'12%', alignItems:'center', paddingVertical:6 }}>
                      <Text style={{ fontSize:28 }}>{e}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={{ color:T.textDim }}>Tip: arrastra en el video para mover; pellizca para cambiar tamaño.</Text>
              </>
            )}

            {activeTab === 'voice' && (
              <>
                <SectionTitle icon="mic-outline" title="Voz en off" />
                <Row>
                  {recording ? <Pill danger primary onPress={async () => {
                    if (!recording) return;
                    await recording.stopAndUnloadAsync();
                    const u = recording.getURI()!;
                    const now = status?.positionMillis ?? 0;
                    const end = Math.min(status?.durationMillis ?? now, now + 15000);
                    setVoice({ url: u, startMs: now, endMs: end });
                    setRecording(null);
                  }} label="Detener" /> : <Pill primary onPress={async () => {
                    const perm = await Audio.requestPermissionsAsync();
                    if (!perm.granted) { alert('Permiso de micrófono requerido'); return; }
                    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
                    const rec = new Audio.Recording();
                    await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
                    await rec.startAsync();
                    setRecording(rec);
                  }} label="Grabar" />}
                  {!!voice && <Text style={{ color:T.text }}>({Math.round((voice.endMs-voice.startMs)/1000)}s)</Text>}
                  {!!voice && <Pill ghost danger onPress={() => setVoice(null)} label="Quitar" />}
                </Row>
                <Text style={{ color:T.textDim }}>Ajusta su tiempo moviendo el clip en la pista “Voz” (pestaña Editar).</Text>
              </>
            )}

            {activeTab === 'volume' && (
              <>
                <SectionTitle icon="volume-high-outline" title="Audio original" />
                <Pill ghost onPress={() => setMuteOriginal(m=>!m)} label={muteOriginal ? 'Silenciado' : 'Activo'} />
                {!!bgm && (
                  <>
                    <SectionTitle small icon="musical-notes-outline" title="Volumen de música" />
                    <Row><Stepper value={bgmVol} onDec={() => setBgmVol(v=>Math.max(0, +(v-0.1).toFixed(2)))} onInc={() => setBgmVol(v=>Math.min(1, +(v+0.1).toFixed(2)))} /></Row>
                  </>
                )}
              </>
            )}
          </ScrollView>
        </BlurView>
      </Animated.View>

      <SoundPicker visible={soundModal} onClose={() => setSoundModal(false)} onPick={(s) => setBgm({ url: s.url, title: s.title })} />
    </View>
  );
}

/* ───────────── UI bits ───────────── */
function SectionTitle({ icon, title, small }:{ icon: keyof typeof Ionicons.glyphMap, title:string, small?:boolean }) {
  return (<View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
    <Ionicons name={icon} size={small ? 14 : 18} color={T.text} />
    <Text style={{ color:T.text, fontWeight:'900', fontSize: small ? 13 : 16 }}>{title}</Text>
  </View>);
}
function Row({ children, space }:{ children: React.ReactNode, space?: boolean }) {
  return <View style={{ flexDirection:'row', alignItems:'center', gap:12, justifyContent: space ? 'space-between' : 'flex-start' }}>{children}</View>;
}
function Pill({ label, onPress, primary, ghost, danger, disabled, small }:{
  label: string; onPress?: () => void; primary?: boolean; ghost?: boolean; danger?: boolean; disabled?: boolean; small?: boolean;
}) {
  const bg = primary ? T.white : ghost ? 'transparent' : T.pill;
  const bc = primary ? T.white : danger ? '#ff7a8f' : T.border;
  const color = primary ? '#000' : T.text;
  return (
    <TouchableOpacity disabled={disabled} onPress={onPress}
      style={{ paddingHorizontal: small ? 10 : 14, paddingVertical: small ? 6 : 10, borderRadius: 999,
               backgroundColor: bg, borderWidth: 1, borderColor: bc, opacity: disabled ? 0.6 : 1, ...shadow }}>
      <Text style={{ color, fontWeight:'900' }}>{label}</Text>
    </TouchableOpacity>
  );
}
function Input(props: any) {
  return <TextInput {...props} placeholderTextColor={T.textDim}
    style={{ flex:1, color: T.text, backgroundColor: '#13161c', borderRadius: 12, borderWidth: 1, borderColor: T.border, paddingHorizontal: 12, paddingVertical: 10 }} />;
}
function Stepper({ value, onDec, onInc }:{ value: number; onDec: () => void; onInc: () => void; }) {
  return (<View style={{ flexDirection:'row', alignItems:'center', gap:10 }}>
    <CircleBtn onPress={onDec}><Text style={{ color:'#fff', fontWeight:'900' }}>–</Text></CircleBtn>
    <Text style={{ color:T.text, width:40, textAlign:'center' }}>{value.toFixed(1)}</Text>
    <CircleBtn onPress={onInc}><Text style={{ color:'#fff', fontWeight:'900' }}>＋</Text></CircleBtn>
  </View>);
}
function CircleBtn({ children, onPress, danger }:{ children: React.ReactNode; onPress?: () => void; danger?: boolean }) {
  return (<TouchableOpacity onPress={onPress}
    style={{ width:36, height:36, borderRadius:18, backgroundColor: danger ? '#ff375f' : '#13161c',
             borderWidth:1, borderColor: danger ? '#ff375f' : T.border, alignItems:'center', justifyContent:'center', ...shadow }}>
    {children}
  </TouchableOpacity>);
}
