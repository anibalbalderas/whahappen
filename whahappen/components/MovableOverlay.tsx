// components/MovableOverlay.tsx
import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import { PanGestureHandler, PinchGestureHandler, State } from 'react-native-gesture-handler';

export type Movable =
  | { id: string; type: 'text'; text: string; color: string; fontSize: number; x: number; y: number; scale: number; rotation?: number }
  | { id: string; type: 'emoji'; emoji: string; x: number; y: number; scale: number; rotation?: number };

type Props = {
  item: Movable;
  selected: boolean;
  onSelect: (id: string) => void;
  onChange: (patch: Partial<Movable>) => void;
};

export default function MovableOverlay({ item, selected, onSelect, onChange }: Props) {
  const baseTX = item.type === 'text' ? -50 : -20;
  const baseTY = item.type === 'text' ? -14 : -20;

  const onPan = useMemo(() => ({
    onHandlerStateChange: ({ nativeEvent }: any) => {
      if (nativeEvent.state === State.BEGAN) onSelect(item.id);
    },
    onGestureEvent: ({ nativeEvent }: any) => {
      // coordenadas normalizadas aprox. sobre 360x640 (portrait)
      const nx = Math.min(Math.max(item.x + nativeEvent.translationX / 360, 0.02), 0.98);
      const ny = Math.min(Math.max(item.y + nativeEvent.translationY / 640, 0.04), 0.96);
      onChange({ x: nx, y: ny });
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [item]);

  const onPinch = useMemo(() => ({
    onHandlerStateChange: ({ nativeEvent }: any) => {
      if (nativeEvent.state === State.BEGAN) onSelect(item.id);
    },
    onGestureEvent: ({ nativeEvent }: any) => {
      const ns = Math.min(4, Math.max(0.5, (item.scale || 1) * nativeEvent.scale));
      onChange({ scale: ns });
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [item]);

  return (
    <PanGestureHandler {...onPan}>
      <View
        style={{
          position: 'absolute',
          left: `${item.x * 100}%`,
          top: `${item.y * 100}%`,
          transform: [{ translateX: baseTX }, { translateY: baseTY }, { scale: item.scale || 1 }],
        }}
      >
        <PinchGestureHandler {...onPinch}>
          <View style={{ alignItems: 'center', justifyContent: 'center' }}>
            {item.type === 'text' ? (
              <Text style={{ color: (item as any).color, fontWeight: '900', fontSize: (item as any).fontSize }}>
                {(item as any).text}
              </Text>
            ) : (
              <Text style={{ fontSize: 40 }}>{(item as any).emoji}</Text>
            )}
            {selected && (
              <View style={{
                position: 'absolute', left: -8, right: -8, top: -8, bottom: -8,
                borderWidth: 1, borderColor: '#ffffffaa', borderRadius: 8,
              }} />
            )}
          </View>
        </PinchGestureHandler>
      </View>
    </PanGestureHandler>
  );
}
