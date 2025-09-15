// components/OverlayEditor.tsx
import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, PanResponder, LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export type Overlay =
  | { id: string; type: 'text'; text: string; color: string; fontSize: number; x: number; y: number; scale: number; rotation: number }
  | { id: string; type: 'emoji'; emoji: string; x: number; y: number; scale: number; rotation: number };

type Props = {
  overlays: Overlay[];
  setOverlays: (next: Overlay[]) => void;
  BoundsPadding?: number; // px de margen interno al video
};

const COLORS = ['#ffffff','#ff2d55','#ffd60a','#0ad3ff','#6ee7b7','#c084fc'];
const EMOJIS = ['😄','🔥','👏','😍','😎','🤯','🙌','🕺','💃','🤟','🎉','🤖','✨','💡'];

function clamp(n: number, a: number, b: number) { return Math.min(Math.max(n, a), b); }
const rnd = () => Math.random().toString(36).slice(2, 9);

export default function OverlayEditor({ overlays, setOverlays, BoundsPadding = 12 }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingText, setAddingText] = useState(false);
  const [textDraft, setTextDraft] = useState('');
  const [videoW, setVideoW] = useState(0);
  const [videoH, setVideoH] = useState(0);

  const onVideoLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setVideoW(width); setVideoH(height);
  };

  const addText = () => { setAddingText(true); setTextDraft(''); };
  const confirmText = () => {
    if (!textDraft.trim()) { setAddingText(false); return; }
    setOverlays([
      ...overlays,
      { id: rnd(), type: 'text', text: textDraft.trim(), color: '#fff', fontSize: 24, x: 0.5, y: 0.5, scale: 1, rotation: 0 },
    ]);
    setAddingText(false);
  };
  const addEmoji = (emoji: string) => {
    setOverlays([...overlays, { id: rnd(), type: 'emoji', emoji, x: 0.5, y: 0.5, scale: 1, rotation: 0 }]);
  };

  const updateOverlay = (id: string, patch: Partial<Overlay>) => {
    setOverlays(overlays.map(o => o.id === id ? { ...o, ...patch } as Overlay : o));
  };
  const removeOverlay = (id: string) => setOverlays(overlays.filter(o => o.id !== id));

  // Gestos: arrastrar
  const dragRefs = useRef<Record<string, any>>({});
  const makePan = (o: Overlay) => {
    if (dragRefs.current[o.id]) return dragRefs.current[o.id];
    let startX = 0, startY = 0;
    const pan = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        setSelectedId(o.id);
        startX = o.x; startY = o.y;
      },
      onPanResponderMove: (_, g) => {
        if (!videoW || !videoH) return;
        const nx = clamp(startX + g.dx / videoW, 0.0 + 40/videoW, 1.0 - 40/videoW);
        const ny = clamp(startY + g.dy / videoH, 0.0 + 40/videoH, 1.0 - 40/videoH);
        updateOverlay(o.id, { x: nx, y: ny });
      },
    });
    dragRefs.current[o.id] = pan;
    return pan;
  };

  const selected = useMemo(() => overlays.find(o => o.id === selectedId) || null, [overlays, selectedId]);

  return (
    <>
      {/* Toolbar */}
      <View style={{ position:'absolute', left: 12, right: 12, bottom: 110, flexDirection:'row', gap: 10, justifyContent:'center' }}>
        <TouchableOpacity onPress={addText} style={{ backgroundColor:'#13161c', borderWidth:1, borderColor:'#252a36', paddingVertical:10, paddingHorizontal:14, borderRadius:12 }}>
          <Text style={{ color:'#fff', fontWeight:'800' }}>Texto</Text>
        </TouchableOpacity>
        <View style={{ backgroundColor:'#13161c', borderWidth:1, borderColor:'#252a36', padding:8, borderRadius:12, flexDirection:'row', gap:6 }}>
          {EMOJIS.slice(0,7).map(e=>(
            <TouchableOpacity key={e} onPress={()=>addEmoji(e)}><Text style={{ fontSize:22 }}>{e}</Text></TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Área del video para medir bounds */}
      <View pointerEvents="none" onLayout={onVideoLayout} style={{ position:'absolute', left: BoundsPadding, right: BoundsPadding, top: BoundsPadding, bottom: BoundsPadding }} />

      {/* Capas */}
      {overlays.map(o=>{
        const px = videoW ? o.x * (videoW - BoundsPadding*0) + BoundsPadding : 0;
        const py = videoH ? o.y * (videoH - BoundsPadding*0) + BoundsPadding : 0;
        const isSel = selectedId === o.id;
        const pan = makePan(o);

        return (
          <View
            key={o.id}
            {...pan.panHandlers}
            style={{
              position:'absolute', left: px, top: py, transform:[{ translateX: -0.5*(o.type==='text' ? (o as any).fontSize*3*o.scale : 30*o.scale) }, { translateY: -20*o.scale }, { rotate: `${o.rotation}deg` }, { scale: o.scale }],
            }}
          >
            {o.type === 'text' ? (
              <Text style={{ color: (o as any).color, fontWeight:'900', fontSize: (o as any).fontSize }}>{(o as any).text}</Text>
            ) : (
              <Text style={{ fontSize: 40 }}>{(o as any).emoji}</Text>
            )}
            {isSel && (
              <View style={{ position:'absolute', top:-30, left:0, right:0, flexDirection:'row', justifyContent:'center', gap:8 }}>
                <TouchableOpacity onPress={()=>removeOverlay(o.id)} style={{ backgroundColor:'#ff2d55', paddingHorizontal:8, paddingVertical:4, borderRadius:8 }}>
                  <Ionicons name="trash-outline" size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
      })}

      {/* Inspector de selección */}
      {selected && (
        <View style={{ position:'absolute', left:12, right:12, bottom: 60, backgroundColor:'#0f1116', borderRadius:12, borderWidth:1, borderColor:'#232838', padding:10 }}>
          <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between' }}>
            <Text style={{ color:'#fff', fontWeight:'800' }}>
              {selected.type === 'text' ? 'Texto' : 'Emoji'}
            </Text>
            <View style={{ flexDirection:'row', gap:8 }}>
              <TouchableOpacity onPress={()=>{ const s = clamp((selected.scale||1) - 0.1, 0.5, 4); updateOverlay(selected.id,{ scale: s }); }}>
                <Ionicons name="remove-circle-outline" size={22} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity onPress={()=>{ const s = clamp((selected.scale||1) + 0.1, 0.5, 4); updateOverlay(selected.id,{ scale: s }); }}>
                <Ionicons name="add-circle-outline" size={22} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity onPress={()=>updateOverlay(selected.id,{ rotation: ((selected.rotation||0) - 10) })}>
                <Ionicons name="refresh-outline" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          {selected.type === 'text' && (
            <>
              <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8, marginTop:8 }}>
                {COLORS.map(c=>(
                  <TouchableOpacity key={c} onPress={()=>updateOverlay(selected.id,{ color: c })} style={{ width:22, height:22, borderRadius:11, backgroundColor: c, borderWidth:2, borderColor:'#1b1e26' }} />
                ))}
              </View>
              <View style={{ flexDirection:'row', alignItems:'center', gap:10, marginTop:8 }}>
                <TouchableOpacity onPress={()=>updateOverlay(selected.id,{ fontSize: clamp((selected as any).fontSize - 2, 14, 64) })}>
                  <Text style={{ color:'#fff', fontSize:20 }}>A-</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={()=>updateOverlay(selected.id,{ fontSize: clamp((selected as any).fontSize + 2, 14, 64) })}>
                  <Text style={{ color:'#fff', fontSize:24 }}>A+</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      )}

      {/* Modal simple para añadir texto */}
      {addingText && (
        <View style={{ position:'absolute', left:12, right:12, bottom: 160, backgroundColor:'#0f1116', borderRadius:12, borderWidth:1, borderColor:'#232838', padding:12 }}>
          <Text style={{ color:'#fff', marginBottom:8, fontWeight:'800' }}>Añadir texto</Text>
          <TextInput
            value={textDraft}
            onChangeText={setTextDraft}
            placeholder="Escribe algo…"
            placeholderTextColor="#8a8f98"
            style={{ backgroundColor:'#141821', color:'#fff', borderRadius:8, paddingHorizontal:10, paddingVertical:8 }}
          />
          <View style={{ flexDirection:'row', justifyContent:'flex-end', gap:10, marginTop:8 }}>
            <TouchableOpacity onPress={()=>setAddingText(false)}><Text style={{ color:'#9aa0a6' }}>Cancelar</Text></TouchableOpacity>
            <TouchableOpacity onPress={confirmText}><Text style={{ color:'#fff', fontWeight:'800' }}>Añadir</Text></TouchableOpacity>
          </View>
        </View>
      )}
    </>
  );
}
