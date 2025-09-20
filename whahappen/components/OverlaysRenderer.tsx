// components/OverlaysRenderer.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

type OverlayItem = {
  id: string;
  type: 'text' | 'emoji' | string;
  startMs: number;
  endMs: number;
  text?: string;
  emoji?: string;
  color?: string;
  fontSize?: number;
  scale?: number;
  rotation?: number;
  x: number; // 0..1
  y: number; // 0..1
};

export default function OverlaysRenderer({
  overlays,
  currentMs,
  selectedId,
}: {
  overlays: OverlayItem[];
  currentMs: number;
  selectedId?: string | null;
}) {
  // tolerancia para saltos de tiempo (por el progressUpdateInterval)
  const tol = 240; // ms

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { zIndex: 2 }]}>
      {overlays.map((o) => {
        if (!o) return null;
        if (selectedId === o.id) return null;

        const show =
          typeof currentMs === 'number' &&
          currentMs >= (Number(o.startMs) - tol) &&
          currentMs <= (Number(o.endMs) + tol);
        if (!show) return null;

        const scale = Number.isFinite(o.scale) ? Number(o.scale) : 1;
        const baseSize = Number.isFinite(o.fontSize) ? Number(o.fontSize) : 28;
        const size = baseSize * scale;
        const rotate = `${Number.isFinite(o.rotation) ? o.rotation : 0}deg`;

        // x,y en porcentaje (clamp 0..100)
        const leftPct = Math.max(0, Math.min(100, Number(o.x) * 100));
        const topPct = Math.max(0, Math.min(100, Number(o.y) * 100));

        return (
          <View
            key={o.id}
            style={{
              position: 'absolute',
              left: `${leftPct}%`,
              top: `${topPct}%`,
              transform: [
                { translateX: -size / 2 },
                { translateY: -size / 2 },
                { scale },
                { rotate },
              ],
            }}
          >
            {o.type === 'text' ? (
              <Text
                allowFontScaling={false}
                style={{
                  color: o.color ?? '#fff',
                  fontSize: size,
                  fontWeight: '900',
                  textShadowColor: 'rgba(0,0,0,0.35)',
                  textShadowRadius: 6,
                }}
              >
                {o.text ?? ''}
              </Text>
            ) : (
              <Text allowFontScaling={false} style={{ fontSize: size }}>
                {o.emoji ?? ''}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}
