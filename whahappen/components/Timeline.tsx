// components/Timeline.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Pressable,
  NativeSyntheticEvent,
  NativeScrollEvent,
  LayoutChangeEvent,
} from 'react-native';
import {
  GestureHandlerRootView,
  PanGestureHandler,
  PanGestureHandlerGestureEvent,
  PinchGestureHandler,
} from 'react-native-gesture-handler';
  import { Ionicons } from '@expo/vector-icons';

export type Track = { key: string; label: string };

export type Clip = {
  id: string;
  track: string;
  label: string;
  color: string;
  startMs: number;
  endMs: number;
  movable?: boolean;
  resizable?: boolean;
  deletable?: boolean;
};

type Props = {
  /** duración total del asset */
  durationMs: number;

  /** rango visible (trim) */
  startMs: number;
  endMs: number;

  /** zoom */
  pxPerMs: number;
  setPxPerMs: (v: number) => void;

  /** reproducción */
  currentMs: number;
  onSeek: (ms: number) => void;

  /** tracks/clips */
  tracks: Track[];
  clips: Clip[];
  onChange: (id: string, patch: Partial<Clip>) => void;
  onDeleteClip?: (id: string) => void;
};

const MIN_LEN_MS = 300; // 0.3s
const TRACK_LEFT = 80;  // ancho de la columna de nombres de pista

export default function Timeline({
  durationMs,
  startMs,
  endMs,
  pxPerMs,
  setPxPerMs,
  currentMs,
  onSeek,
  tracks,
  clips,
  onChange,
  onDeleteClip,
}: Props) {
  // rango relativo (0s = inicio del clip/rango)
  const minMs = Math.max(0, Math.min(startMs, endMs));
  const maxMs = Math.max(minMs + 1, Math.max(startMs, endMs));
  const rangeMs = Math.max(1, maxMs - minMs);

  const [viewW, setViewW] = useState(0);
  const [contentW, setContentW] = useState(Math.max(600, rangeMs * pxPerMs));
  const [scrollX, setScrollX] = useState(0);

  // refs para sincronizar scroll entre ruler y contenido
  const rulerRef = useRef<ScrollView>(null);
  const contentRef = useRef<ScrollView>(null);
  const syncing = useRef<'ruler' | 'content' | null>(null);

  // recalcular ancho cuando cambie zoom/rango
  useEffect(() => {
    setContentW(Math.max(600, Math.ceil(rangeMs * pxPerMs)));
  }, [rangeMs, pxPerMs]);

  const onLayout = (e: LayoutChangeEvent) => setViewW(e.nativeEvent.layout.width);

  // zoom por pinch
  const pinchBase = useRef(1);
  const onPinchEvent = (e: any) => {
    const factor = (e.nativeEvent.scale as number) / (pinchBase.current || 1);
    pinchBase.current = e.nativeEvent.scale;
    setPxPerMs(clamp(pxPerMs * factor, 0.02, 0.6));
  };
  const onPinchState = (e: any) => {
    if (e.nativeEvent.state === 5) pinchBase.current = 1;
  };

  // mantener playhead a la vista cuando cambie el zoom o el rango
  useEffect(() => {
    if (!viewW) return;
    const x = clamp(msToX(currentMs) - viewW * 0.15, 0, Math.max(0, contentW - viewW));
    scrollBothTo(x);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentW, minMs, maxMs]);

  // helpers (relativos al rango mostrado: 0s = minMs)
  const msToX = (ms: number) => (clamp(ms, minMs, maxMs) - minMs) * pxPerMs;
  const xToMs = (x: number) => minMs + x / pxPerMs;

  // grid (segundos relativos)
  const ticks = useMemo(() => {
    const secs = Math.ceil(rangeMs / 1000);
    return new Array(secs + 1).fill(0).map((_, i) => i);
  }, [rangeMs]);

  // agrupar clips por track
  const clipsByTrack = useMemo(() => {
    const map: Record<string, Clip[]> = {};
    clips.forEach((c) => ((map[c.track] ||= []).push(c)));
    Object.keys(map).forEach((k) => map[k].sort((a, b) => a.startMs - b.startMs));
    return map;
  }, [clips]);

  // sincronización de scroll
  const onScrollRuler = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    setScrollX(x);
    if (syncing.current === 'content') return;
    syncing.current = 'ruler';
    contentRef.current?.scrollTo({ x, animated: false });
    requestAnimationFrame(() => (syncing.current = null));
  };
  const onScrollContent = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    setScrollX(x);
    if (syncing.current === 'ruler') return;
    syncing.current = 'content';
    rulerRef.current?.scrollTo({ x, animated: false });
    requestAnimationFrame(() => (syncing.current = null));
  };

  const scrollBothTo = (x: number) => {
    setScrollX(x);
    rulerRef.current?.scrollTo({ x, animated: false });
    contentRef.current?.scrollTo({ x, animated: false });
  };

  const incZoom = () => setPxPerMs(clamp(pxPerMs * 1.15, 0.02, 0.6));
  const decZoom = () => setPxPerMs(clamp(pxPerMs / 1.15, 0.02, 0.6));
  const fitZoom = () =>
    setPxPerMs(
      clamp(Math.min(0.6, (Math.max(1, viewW) - 40) / Math.max(1, rangeMs)), 0.02, 0.6)
    );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View onLayout={onLayout} style={{ flex: 1, backgroundColor: '#0b0b0d' }}>
        {/* Header */}
        <View
          style={{
            paddingHorizontal: 10,
            paddingTop: 8,
            paddingBottom: 6,
            borderBottomColor: '#232838',
            borderBottomWidth: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Text style={{ color: '#9aa0a6' }}>Zoom:</Text>
          <TouchableOpacity onPress={decZoom} style={chip()}>
            <Text style={chipText()}>–</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={incZoom} style={chip()}>
            <Text style={chipText()}>+</Text>
          </TouchableOpacity>
          <Text style={{ color: '#9aa0a6' }}>{Math.round(pxPerMs * 1000)} px/s</Text>
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={fitZoom} style={chip(true)}>
            <Ionicons name="resize-outline" color="#000" size={16} />
            <Text style={{ color: '#000', fontWeight: '800', marginLeft: 6 }}>Ajustar</Text>
          </TouchableOpacity>
        </View>

        {/* RULER (0s colocado justo donde inicia el clip/pistas) */}
        <PinchGestureHandler onGestureEvent={onPinchEvent} onHandlerStateChange={onPinchState}>
          <View style={{ flex: 1 }}>
            <PanGestureHandler
              onGestureEvent={(e) => {
                const xView = e.nativeEvent.x;
                const ms = clamp(xToMs(xView + scrollX), minMs, maxMs);
                onSeek(ms);
              }}
            >
              <View
                style={{
                  height: 26,
                  borderBottomWidth: 1,
                  borderBottomColor: '#232838',
                  backgroundColor: '#0f1116',
                }}
              >
                <ScrollView
                  horizontal
                  ref={rulerRef}
                  onScroll={onScrollRuler}
                  scrollEventThrottle={16}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ width: contentW }}
                >
                  {/* Spacer para alinear 0s con el inicio de las pistas */}
                  <View style={{ width: TRACK_LEFT }} />
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: '100%' }}>
                    {ticks.map((s) => (
                      <View key={s} style={{ width: 1000 * pxPerMs, justifyContent: 'flex-end' }}>
                        <Text style={{ color: '#9aa0a6', fontSize: 10, textAlign: 'center' }}>
                          {s}s
                        </Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>

                {/* Barra separadora de inicio (estilo Premiere) */}
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: TRACK_LEFT - scrollX,
                    top: 0,
                    bottom: 0,
                    width: 2,
                    backgroundColor: '#2a3046',
                  }}
                />

                {/* Playhead en la regla (incluye offset para alinear) */}
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: TRACK_LEFT + msToX(currentMs) - scrollX,
                    top: 0,
                    bottom: 0,
                    width: 2,
                    backgroundColor: '#ff375f',
                  }}
                />
              </View>
            </PanGestureHandler>

            {/* CONTENIDO sincronizado */}
            <ScrollView
              horizontal
              ref={contentRef}
              onScroll={onScrollContent}
              scrollEventThrottle={16}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ width: contentW }}
            >
              <View style={{ flex: 1 }}>
                {tracks.map((t, idx) => (
                  <TrackRow key={t.key} top={idx === 0} label={t.label} height={40}>
                    {(clipsByTrack[t.key] || []).map((clip) => (
                      <ClipItem
                        key={clip.id}
                        clip={clip}
                        pxPerMs={pxPerMs}
                        minMs={minMs}
                        maxMs={maxMs}
                        onChange={onChange}
                        onDelete={onDeleteClip}
                      />
                    ))}
                  </TrackRow>
                ))}
                <View style={{ height: 6 }} />
              </View>

              {/* Barra separadora en contenido */}
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: TRACK_LEFT - scrollX,
                  top: 0,
                  bottom: 0,
                  width: 2,
                  backgroundColor: '#2a3046',
                }}
              />

              {/* Playhead sobre los clips (alineado con ruler) */}
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: TRACK_LEFT + msToX(currentMs) - scrollX,
                  top: 0,
                  bottom: 0,
                  width: 2,
                  backgroundColor: '#ff375f',
                }}
              />
            </ScrollView>
          </View>
        </PinchGestureHandler>
      </View>
    </GestureHandlerRootView>
  );
}

/* ───────────── Subcomponentes ───────────── */

function TrackRow({
  label,
  children,
  height = 40,
  top = false,
}: {
  label: string;
  children: React.ReactNode;
  height?: number;
  top?: boolean;
}) {
  return (
    <View
      style={{
        height,
        borderTopWidth: top ? 0 : 1,
        borderColor: '#232838',
        backgroundColor: '#0f1116',
      }}
    >
      <View style={{ position: 'absolute', left: 8, top: 10, width: TRACK_LEFT - 8 }}>
        <Text style={{ color: '#9aa0a6', fontSize: 11 }} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <View style={{ flex: 1, marginLeft: TRACK_LEFT, justifyContent: 'center' }}>{children}</View>
    </View>
  );
}

function ClipItem({
  clip,
  pxPerMs,
  minMs,
  maxMs,
  onChange,
  onDelete,
}: {
  clip: Clip;
  pxPerMs: number;
  minMs: number;
  maxMs: number;
  onChange: (id: string, patch: Partial<Clip>) => void;
  onDelete?: (id: string) => void;
}) {
  const [selected, setSelected] = useState(false);

  // recorte visual por si un clip se sale del rango (lo dibujamos “recortado”)
  const visStart = Math.max(clip.startMs, minMs);
  const visEnd = Math.min(clip.endMs, maxMs);

  const left = (visStart - minMs) * pxPerMs;
  const width = Math.max((visEnd - visStart) * pxPerMs, 6);

  const movable = clip.movable ?? clip.id !== 'video';
  const resizable = clip.resizable ?? true;
  const deletable = clip.deletable ?? clip.id !== 'video';

  // refs para drag/resize
  const startRef = useRef(clip.startMs);
  const endRef = useRef(clip.endMs);
  useEffect(() => {
    startRef.current = clip.startMs;
    endRef.current = clip.endMs;
  }, [clip.startMs, clip.endMs]);

  // mover clip dentro del rango [minMs,maxMs]
  const onBodyGesture = (e: PanGestureHandlerGestureEvent) => {
    if (!movable) return;
    const dx = e.nativeEvent.translationX;
    const deltaMs = dx / pxPerMs;
    const len = endRef.current - startRef.current;

    let newStart = clamp(startRef.current + deltaMs, minMs, maxMs - len);
    onChange(clip.id, { startMs: newStart, endMs: newStart + len });
  };
  const onBodyState = (e: any) => {
    if (e.nativeEvent.state === 2 /* BEGIN */) setSelected(true);
    if (e.nativeEvent.state === 4 /* END */) setSelected(false);
  };

  // resize con límites del rango visible
  const onResize =
    (edge: 'left' | 'right') => (e: PanGestureHandlerGestureEvent) => {
      if (!resizable) return;
      const dx = e.nativeEvent.translationX;
      const deltaMs = dx / pxPerMs;

      if (edge === 'left') {
        let ns = clamp(startRef.current + deltaMs, minMs, clip.endMs - MIN_LEN_MS);
        onChange(clip.id, { startMs: ns });
      } else {
        let ne = clamp(endRef.current + deltaMs, clip.startMs + MIN_LEN_MS, maxMs);
        onChange(clip.id, { endMs: ne });
      }
    };
  const onResizeState = (e: any) => {
    if (e.nativeEvent.state === 2) setSelected(true);
    if (e.nativeEvent.state === 4) setSelected(false);
  };

  return (
    <View
      style={{
        position: 'absolute',
        left,
        width,
        height: 22,
        borderRadius: 6,
        backgroundColor: hexWithAlpha(clip.color, 0.9),
        borderWidth: 1,
        borderColor: selected ? '#ffffff' : '#2a3046',
      }}
    >
      {/* cuerpo (drag) */}
      <PanGestureHandler onGestureEvent={onBodyGesture} onHandlerStateChange={onBodyState} enabled={movable}>
        <Pressable onPress={() => setSelected((s) => !s)} style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 8 }}>
          <Text style={{ color: '#0b0c10', fontWeight: '800' }} numberOfLines={1}>
            {clip.label}
          </Text>
        </Pressable>
      </PanGestureHandler>

      {/* handles */}
      {resizable && (
        <>
          <PanGestureHandler onGestureEvent={onResize('left')} onHandlerStateChange={onResizeState}>
            <View style={handleStyle(selected)} />
          </PanGestureHandler>
          <PanGestureHandler onGestureEvent={onResize('right')} onHandlerStateChange={onResizeState}>
            <View style={[handleStyle(selected), { right: -6, left: undefined }]} />
          </PanGestureHandler>
        </>
      )}

      {/* borrar */}
      {deletable && selected && onDelete && (
        <TouchableOpacity
          onPress={() => onDelete(clip.id)}
          style={{
            position: 'absolute',
            top: -18,
            right: -18,
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: '#ff375f',
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: '#0f1116',
          }}
        >
          <Ionicons name="trash-outline" size={14} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
}

/* ───────────── Utils ───────────── */
function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}
function chip(filled = false) {
  return {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: filled ? '#ffffff' : '#13161c',
    borderWidth: 1,
    borderColor: filled ? '#ffffff' : '#232838',
  };
}
function chipText() {
  return { color: '#fff', fontWeight: '900' } as const;
}
function hexWithAlpha(hex: string, alpha = 1) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
  const r = parseInt(c.slice(0,2),16);
  const g = parseInt(c.slice(2,4),16);
  const b = parseInt(c.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function handleStyle(selected: boolean) {
  return {
    position: 'absolute' as const,
    left: -6,
    top: -3,
    width: 12,
    height: 28,
    borderRadius: 4,
    backgroundColor: selected ? '#fff' : '#cbd5e1',
    borderWidth: 1,
    borderColor: '#2a3046',
  };
}
