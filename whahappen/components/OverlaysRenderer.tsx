// components/OverlaysRenderer.tsx
import React from 'react';
import { View, Text } from 'react-native';
import type { Movable } from './MovableOverlay';

export default function OverlaysRenderer({
  overlays,
  currentMs,
  selectedId,
}: {
  overlays: (Movable & { startMs: number; endMs: number })[];
  currentMs: number;
  selectedId?: string | null;
}) {
  const tol = 1; // ~2 frames de tolerancia

  return (
    <View pointerEvents="none" style={{ position: 'absolute', inset: 0 }}>
      {overlays.map((o) => {
        // Si está seleccionado, lo muestra el componente interactivo
        if (selectedId === o.id) return null;

        const show = currentMs >= (o.startMs - tol) && currentMs <= (o.endMs - tol);
        if (!show) return null;

        const scale = o.scale ?? 1;
        const size = (o.fontSize ?? 28) * scale;
        const rotate = `${(o as any).rotation ?? 0}deg`;

        const leftPct = Math.max(0, Math.min(100, o.x * 100));
        const topPct = Math.max(0, Math.min(100, o.y * 100));

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
                style={{
                  color: o.color ?? '#fff',
                  fontSize: size,
                  fontWeight: '900',
                  textShadowColor: 'rgba(0,0,0,0.35)',
                  textShadowRadius: 6,
                }}
              >
                {o.text}
              </Text>
            ) : (
              <Text style={{ fontSize: size }}>{(o as any).emoji}</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}
