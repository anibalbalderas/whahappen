// app/editor.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Pressable,
  Keyboard,
  ScrollView,
  Animated,
  Easing,
  StatusBar,
  StyleSheet,
  PanResponder,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Dimensions,
} from "react-native";
import { Video, Audio } from "expo-av";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const FILL = StyleSheet.absoluteFillObject;

const T = {
  bg: "#000",
  sheet: "#0f1116f2",
  text: "#fff",
  textDim: "#9aa0a6",
};
const glass = {
  borderRadius: 16,
  overflow: "hidden" as const,
  borderWidth: 1,
  borderColor: "#1f2230",
  backgroundColor: "#0e1015cc",
};

type Movable =
  | {
      id: string;
      type: "text";
      text: string;
      color: string;
      fontSize: number;
      x: number; // 0..1
      y: number; // 0..1
      scale?: number;
      startMs: number;
      endMs: number;
    }
  | {
      id: string;
      type: "emoji";
      emoji: string;
      x: number;
      y: number;
      scale?: number;
      startMs: number;
      endMs: number;
    };

type ClipModel = {
  id: string;
  track: string;
  label: string;
  color: string;
  startMs: number;
  endMs: number;
  movable: boolean;
  resizable: boolean;
  deletable?: boolean;
};

const EMOJIS = ["😄", "🔥", "👏", "😍", "😎", "🤯", "🙌", "🕺", "💃", "🎉", "✨", "💡"];

export default function Editor() {
  const r = useRouter();
  const insets = useSafeAreaInsets();

  // Video
  const [uri, setUri] = useState<string | null>(null);
  const videoRef = useRef<Video>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [status, setStatus] = useState<{ positionMillis: number; durationMillis: number } | null>(null);
  const curMs = status?.positionMillis ?? 0;
  const durMs = status?.durationMillis ?? 0;

  // Viewport
  const [vpW, setVpW] = useState(Dimensions.get("window").width);
  const [vpH, setVpH] = useState(Math.round(Dimensions.get("window").height));

  // Trim
  const [trimStartMs, setTrimStartMs] = useState(0);
  const [trimEndMs, setTrimEndMs] = useState<number | null>(null);
  const endMs = trimEndMs ?? durMs;

  // Overlays
  const [overlays, setOverlays] = useState<Movable[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Texto
  const [textDraft, setTextDraft] = useState("");
  const [textColor, setTextColor] = useState("#ffffff");
  const [textSize, setTextSize] = useState(28);

  // Música (URL)
  const [bgm, setBgm] = useState<{ url: string; title: string } | null>(null);
  const [bgmSound, setBgmSound] = useState<Audio.Sound | null>(null);
  const [bgmVol, setBgmVol] = useState(0.8);
  const [muteOriginal, setMuteOriginal] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");

  type Tool = "edit" | "text" | "stickers" | "sound";
  const [tool, setTool] = useState<Tool>("edit");

  // Mostrar/Ocultar UI
  const [uiHidden, setUiHidden] = useState(false);

  // Teclado
  const [kh, setKh] = useState(0);
  useEffect(() => {
    const sh = Keyboard.addListener("keyboardDidShow", (e) => setKh(e.endCoordinates.height));
    const hd = Keyboard.addListener("keyboardDidHide", () => setKh(0));
    return () => {
      sh.remove();
      hd.remove();
    };
  }, []);

  /* ───────── Sheet / Timeline (altura medida real + animación) ───────── */
  const RULER_H = 44;                 // ← más alto y fácil de tocar
  const VISIBLE_TRACKS_H = 200;
  const [measuredSheetH, setMeasuredSheetH] = useState(0);
  const sheetY = useRef(new Animated.Value(0)).current;

  const animateSheet = (to: number) =>
    Animated.timing(sheetY, {
      toValue: to,
      duration: 240,
      easing: to === 0 ? Easing.out(Easing.quad) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start();

  // Abre/cierra según herramienta (cuando ya tenemos la altura medida)
  useEffect(() => {
    if (!measuredSheetH) return;
    if (!uiHidden && tool === "edit") animateSheet(0);
    else animateSheet(measuredSheetH);
  }, [tool, uiHidden, measuredSheetH]);

  /* ───────── Timeline ───────── */
  const MIN_ZOOM = 0.02;
  const MAX_ZOOM = 0.3;
  const [pxPerMs, setPxPerMs] = useState(0.08);
  const [tlW, setTlW] = useState(0);
  const [contentW, setContentW] = useState(1);
  const tlRef = useRef<ScrollView>(null);
  const tlOffsetXRef = useRef(0);
  const [tlKey, setTlKey] = useState(0);
  const [scrubActive, setScrubActive] = useState(false);
  const [showScrubHint, setShowScrubHint] = useState(true); // hint hasta primer uso

  // Montaje
  useEffect(() => {
    try {
      const { getRecordedUri } = require("../lib/session");
      setUri(getRecordedUri() ?? null);
    } catch {
      setUri(null);
    }
  }, []);
  useEffect(() => {
    (async () => {
      if (videoRef.current) {
        await videoRef.current.setIsLoopingAsync(true);
        await videoRef.current.playAsync();
        setIsPlaying(true);
      }
    })();
  }, [videoRef.current]);

  useEffect(() => () => void bgmSound?.unloadAsync(), [bgmSound]);

  useEffect(() => {
    const width = Math.max(1, Math.round(Math.max(endMs, 1) * pxPerMs));
    setContentW(width);
  }, [endMs, pxPerMs]);

  // Auto-follow (si no estás haciendo scrub)
  useEffect(() => {
    if (!isPlaying || tlW <= 0 || scrubActive) return;
    const x = curMs * pxPerMs;
    const left = tlOffsetXRef.current ?? 0;
    const right = left + tlW;
    const margin = 60;
    if (x < left + margin || x > right - margin) {
      const target = Math.max(0, x - tlW / 2);
      tlRef.current?.scrollTo({ x: target, y: 0, animated: false });
    }
  }, [curMs, pxPerMs, isPlaying, tlW, scrubActive]);

  const centerOn = (ms: number, animated = false) => {
    if (!tlRef.current || tlW <= 0 || !isFinite(ms)) return;
    const want = Math.max(0, Math.min(ms * pxPerMs - tlW / 2, contentW - tlW));
    tlRef.current.scrollTo({ x: want, y: 0, animated });
  };
  const changeZoom = (next: number) => {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    setPxPerMs(clamped);
    setTlKey((k) => k + 1);
    requestAnimationFrame(() => requestAnimationFrame(() => centerOn(curMs, false)));
  };
  const onTlScroll = (ev: NativeSyntheticEvent<NativeScrollEvent>) => {
    tlOffsetXRef.current = ev.nativeEvent.contentOffset.x;
  };

  // SCRUB en la ruler (con perilla/“thumb”)
  const startScrub = async (xInView: number) => {
    setScrubActive(true);
    setShowScrubHint(false);
    if (isPlaying) {
      await videoRef.current?.pauseAsync();
      await bgmSound?.pauseAsync();
      setIsPlaying(false);
    }
    moveScrub(xInView);
  };
  const moveScrub = (xInView: number) => {
    const globalX = (tlOffsetXRef.current ?? 0) + xInView;
    const ms = Math.max(0, Math.min(globalX / pxPerMs, endMs));
    seekTo(ms);
  };
  const endScrub = () => setScrubActive(false);

  // Player status
  const onStatus = async (st: any) => {
    if (!st?.isLoaded) return;
    const pos = st.positionMillis ?? 0;
    const dur = st.durationMillis ?? 0;
    setStatus({ positionMillis: pos, durationMillis: dur });
    const _end = trimEndMs ?? dur;
    if (pos > _end - 30) {
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
  }

  // Cargar BGM (URL)
  useEffect(() => {
    (async () => {
      if (!bgm) {
        await bgmSound?.unloadAsync();
        setBgmSound(null);
        return;
      }
      const { sound } = await Audio.Sound.createAsync(
        { uri: bgm.url },
        { shouldPlay: isPlaying, isLooping: true, volume: bgmVol }
      );
      setBgmSound(sound);
      await sound.setPositionAsync(Math.max(0, curMs - trimStartMs));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgm?.url]);

  useEffect(() => {
    if (bgmSound) bgmSound.setVolumeAsync(bgmVol);
  }, [bgmVol, bgmSound]);

  const togglePlay = async () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      await videoRef.current.pauseAsync();
      await bgmSound?.pauseAsync();
      setIsPlaying(false);
    } else {
      await videoRef.current.playAsync();
      if (bgmSound) await bgmSound.playAsync();
      setIsPlaying(true);
    }
  };

  const visibleOverlays = useMemo(
    () => overlays.filter((o) => curMs >= o.startMs && o.endMs > curMs),
    [overlays, curMs]
  );

  // Clips
  const clips: ClipModel[] = useMemo(() => {
    const arr: ClipModel[] = [
      {
        id: "video",
        track: "video",
        label: "Clip",
        color: "#e5e7eb",
        startMs: trimStartMs,
        endMs: endMs,
        movable: false,
        resizable: true,
        deletable: false,
      },
    ];
    overlays.forEach((o, i) =>
      arr.push({
        id: `ov-${o.id}`,
        track: `ov-${o.id}`,
        label: o.type === "text" ? `Texto ${i + 1}` : `Sticker ${i + 1}`,
        color: o.type === "text" ? "#93c5fd" : "#fde68a",
        startMs: o.startMs,
        endMs: o.endMs,
        movable: true,
        resizable: true,
        deletable: true,
      })
    );
    return arr;
  }, [overlays, trimStartMs, endMs]);

  // Añadir overlays
  const addText = () => {
    if (!textDraft.trim()) return;
    const id = Math.random().toString(36).slice(2, 9);
    const _end = (trimEndMs ?? durMs) || curMs + 3000;
    setOverlays((o) => [
      ...o,
      {
        id,
        type: "text",
        text: textDraft.trim(),
        color: textColor,
        fontSize: textSize,
        x: 0.5,
        y: 0.6,
        scale: 1,
        startMs: curMs,
        endMs: Math.min(curMs + 3000, _end),
      } as Movable,
    ]);
    setTextDraft("");
    setSelectedId(id);
  };

  const addEmoji = (emoji: string) => {
    const id = Math.random().toString(36).slice(2, 9);
    const _end = (trimEndMs ?? durMs) || curMs + 2000;
    setOverlays((o) => [
      ...o,
      {
        id,
        type: "emoji",
        emoji,
        x: 0.5,
        y: 0.5,
        scale: 1,
        startMs: curMs,
        endMs: Math.min(curMs + 2000, _end),
      } as Movable,
    ]);
    setSelectedId(id);
  };

  const seekTo = async (ms: number) => {
    try {
      await videoRef.current?.setPositionAsync(ms);
      setStatus((s) => (s ? { ...s, positionMillis: ms } : s));
      await syncAudios(ms);
    } catch {}
  };

  const goReview = () => {
    try {
      const { saveDraft } = require("../lib/draft");
      saveDraft({
        trim: { startMs: trimStartMs, endMs },
        overlays,
        audio: bgm ? { url: bgm.url, title: bgm.title, volume: bgmVol } : null,
        muteOriginal,
      });
    } catch {}
    Keyboard.dismiss();
    r.push("/review-upload");
  };

  const onClipChange = (id: string, patch: Partial<ClipModel>) => {
    if (id === "video") {
      if (typeof patch.startMs === "number") setTrimStartMs(Math.max(0, Math.min(patch.startMs, (trimEndMs ?? durMs) - 300)));
      if (typeof patch.endMs === "number") setTrimEndMs(Math.max(trimStartMs + 300, Math.min(patch.endMs, durMs)));
      return;
    }
    const ovId = id.replace("ov-", "");
    setOverlays((arr) =>
      arr.map((o) =>
        o.id === ovId
          ? ({
              ...o,
              startMs: typeof patch.startMs === "number" ? patch.startMs : o.startMs,
              endMs: typeof patch.endMs === "number" ? patch.endMs : o.endMs,
            } as Movable)
          : o
      )
    );
  };

  const onDeleteClip = (id: string) => {
    if (id === "video") return;
    const ovId = id.replace("ov-", "");
    setOverlays((arr) => arr.filter((o) => o.id !== ovId));
  };

  const pauseIfPlaying = async () => {
    if (isPlaying) {
      await videoRef.current?.pauseAsync();
      await bgmSound?.pauseAsync();
      setIsPlaying(false);
    }
  };

  const showEmpty = !uri;

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

      {/* Top bar */}
      {!uiHidden && (
        <View style={{ position: "absolute", top: (insets.top || 12) + 10, left: 10, right: 10, zIndex: 40, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <TouchableOpacity onPress={() => ((r as any).canGoBack?.() ? r.back() : r.replace("/feed"))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="chevron-back" size={28} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={goReview} activeOpacity={0.9} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: "#ffffffcc" }}>
            <Text style={{ color: "#000", fontWeight: "900" }}>Siguiente</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* PREVIEW */}
      <Pressable style={{ flex: 1 }} onPress={() => setUiHidden((v) => !v)} onLongPress={togglePlay}>
        <View
          style={{ flex: 1 }}
          onLayout={(e) => {
            setVpW(e.nativeEvent.layout.width);
            setVpH(e.nativeEvent.layout.height);
          }}
        >
          {!showEmpty ? (
            <>
              <Video
                ref={videoRef}
                source={{ uri: uri! }}
                style={FILL}
                resizeMode="cover"
                isLooping
                shouldPlay
                onPlaybackStatusUpdate={onStatus}
                isMuted={muteOriginal}
              />
              {/* Overlays */}
              <View pointerEvents="box-none" style={FILL}>
                {visibleOverlays.map((o) => (
                  <DragOverlay
                    key={o.id}
                    item={o}
                    selected={selectedId === o.id}
                    vpW={vpW}
                    vpH={vpH}
                    onSelect={() => setSelectedId(o.id)}
                    onChange={(patch) =>
                      setOverlays((arr) =>
                        arr.map((x) => (x.id === o.id ? ({ ...x, ...patch } as Movable) : x))
                      )
                    }
                  />
                ))}
              </View>

              {!isPlaying && !uiHidden && (
                <View pointerEvents="none" style={[FILL, { alignItems: "center", justifyContent: "center" }]}>
                  <Ionicons name="play-circle" size={84} color="#ffffffaa" />
                </View>
              )}
            </>
          ) : (
            <View style={[FILL, { alignItems: "center", justifyContent: "center" }]}>
              <Text style={{ color: T.text }}>No hay video para editar.</Text>
            </View>
          )}
        </View>
      </Pressable>

      {/* Menú lateral */}
      {!uiHidden && (
        <View style={{ position: "absolute", right: 10, top: (insets.top || 12) + 68, zIndex: 40 }}>
          {(["edit", "text", "stickers", "sound"] as Tool[]).map((k) => (
            <TouchableOpacity key={k} onPress={() => setTool(k)} activeOpacity={0.9} style={{ marginBottom: 12 }}>
              <View
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 23,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: tool === k ? "#ffffff" : "#101318",
                  borderWidth: 1,
                  borderColor: tool === k ? "#ffffff" : "#252a36",
                }}
              >
                <Ionicons
                  name={
                    k === "edit"
                      ? "cut-outline"
                      : k === "text"
                      ? ("text-outline" as any)
                      : k === "stickers"
                      ? "happy-outline"
                      : "musical-notes-outline"
                  }
                  size={20}
                  color={tool === k ? "#000" : "#fff"}
                />
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* TEXTO */}
      {!uiHidden && tool === "text" && (
        <View style={{ position: "absolute", left: 16, right: 16, bottom: (kh || 0) + (insets.bottom || 12) + 16 }}>
          <View style={[glass, { padding: 12, borderRadius: 14 }]}>
            <Text style={{ color: "#fff", fontWeight: "800", marginBottom: 6 }}>Texto</Text>
            <TextInput
              value={textDraft}
              onChangeText={setTextDraft}
              placeholder="Escribe algo…"
              placeholderTextColor="#8a8f98"
              style={{ color: "#fff", paddingHorizontal: 10, paddingVertical: 10, borderRadius: 10 }}
              returnKeyType="done"
              onSubmitEditing={addText}
            />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {["#ffffff", "#ff2d55", "#ffd60a", "#0ad3ff", "#6ee7b7", "#c084fc"].map((c) => (
                  <TouchableOpacity key={c} onPress={() => setTextColor(c)} style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c, borderWidth: 1, borderColor: "#222" }} />
                ))}
              </View>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <TouchableOpacity onPress={() => setTextSize((s) => Math.max(12, s - 2))}>
                  <Ionicons name="remove-circle-outline" size={24} color="#fff" />
                </TouchableOpacity>
                <Text style={{ color: "#fff" }}>{textSize}</Text>
                <TouchableOpacity onPress={() => setTextSize((s) => Math.min(64, s + 2))}>
                  <Ionicons name="add-circle-outline" size={24} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={addText} activeOpacity={0.9} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: "#fff" }}>
                  <Text style={{ color: "#000", fontWeight: "900" }}>Añadir</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* STICKERS */}
      {!uiHidden && tool === "stickers" && (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: (insets.bottom || 12) + 12 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12 }}>
            {EMOJIS.map((e) => (
              <TouchableOpacity
                key={e}
                onPress={() => addEmoji(e)}
                style={{ marginRight: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: "#13161c", borderWidth: 1, borderColor: "#252a36" }}
              >
                <Text style={{ fontSize: 22 }}>{e}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* SONIDO (URL) */}
      {!uiHidden && tool === "sound" && (
        <View style={{ position: "absolute", left: 16, right: 16, bottom: (kh || 0) + (insets.bottom || 12) + 16 }}>
          <View style={[glass, { padding: 12, borderRadius: 14 }]}>
            <Text style={{ color: "#fff", fontWeight: "800", marginBottom: 10 }}>Sonido</Text>
            <Text style={{ color: T.textDim, marginBottom: 6 }}>Pega una URL directa a un MP3/OGG/M4A público.</Text>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <TextInput
                value={urlDraft}
                onChangeText={setUrlDraft}
                placeholder="https://.../tema.mp3"
                placeholderTextColor="#8a8f98"
                autoCapitalize="none"
                autoCorrect={false}
                style={{ flex: 1, color: "#fff", paddingHorizontal: 10, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: "#252a36" }}
              />
              <TouchableOpacity
                onPress={() => {
                  const u = (urlDraft || "").trim();
                  if (!/^https?:\/\//i.test(u)) return;
                  setBgm({ url: u, title: u.split("/").pop() || "Audio" });
                }}
                style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: "#fff" }}
              >
                <Text style={{ color: "#000", fontWeight: "900" }}>{bgm ? "Cambiar" : "Usar URL"}</Text>
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: "row", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
              {!!bgm && (
                <TouchableOpacity onPress={() => setBgm(null)} style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: "#121318", borderWidth: 1, borderColor: "#252a36" }}>
                  <Text style={{ color: "#fff", fontWeight: "900" }}>Quitar</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => setMuteOriginal((m) => !m)} style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: "#121318", borderWidth: 1, borderColor: "#252a36" }}>
                <Text style={{ color: "#fff" }}>{muteOriginal ? "Silenciar original: ON" : "Silenciar original: OFF"}</Text>
              </TouchableOpacity>
              {!!bgm && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <TouchableOpacity onPress={() => setBgmVol((v) => Math.max(0, +(v - 0.1).toFixed(2)))}><Ionicons name="remove-circle-outline" size={24} color="#fff" /></TouchableOpacity>
                  <Text style={{ color: "#fff" }}>{Math.round(bgmVol * 100)}%</Text>
                  <TouchableOpacity onPress={() => setBgmVol((v) => Math.min(1, +(v + 0.1).toFixed(2)))}><Ionicons name="add-circle-outline" size={24} color="#fff" /></TouchableOpacity>
                </View>
              )}
            </View>
            {!!bgm && <Text style={{ color: T.textDim, marginTop: 8 }}>Actual: {bgm.title}</Text>}
          </View>
        </View>
      )}

      {/* TIMELINE (medido y animado) */}
      {!uiHidden && (
        <Animated.View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            transform: [{ translateY: sheetY }],
          }}
        >
          <View
            onLayout={(e) => {
              const h = Math.round(e.nativeEvent.layout.height);
              if (h && h !== measuredSheetH) {
                setMeasuredSheetH(h);
                // Si la herramienta no es edit, escóndelo de inmediato al medir
                if (tool !== "edit") sheetY.setValue(h);
              }
            }}
            style={[
              { backgroundColor: T.sheet },
              glass,
              { borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
            ]}
          >
            {/* handle */}
            <View style={{ alignItems: "center", paddingTop: 8 }}>
              <View style={{ width: 60, height: 6, backgroundColor: "#2a2e36", borderRadius: 3 }} />
            </View>

            {/* Controles */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 16, paddingRight: 16, paddingTop: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <TouchableOpacity onPress={togglePlay} style={{ padding: 6 }}>
                  <Ionicons name={isPlaying ? "pause-circle-outline" : "play-circle-outline"} size={24} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => changeZoom(pxPerMs * 0.8)} style={{ padding: 6 }}>
                  <Ionicons name="remove-circle-outline" size={22} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => changeZoom(pxPerMs * 1.25)} style={{ padding: 6 }}>
                  <Ionicons name="add-circle-outline" size={22} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => centerOn(curMs, true)} style={{ padding: 6 }}>
                  <Ionicons name="radio-button-on-outline" size={22} color="#fff" />
                </TouchableOpacity>
                <Text style={{ color: T.textDim }}>Zoom {pxPerMs.toFixed(2)} px/ms</Text>
              </View>
            </View>

            {/* Área timeline */}
            <View onLayout={(e) => setTlW(e.nativeEvent.layout.width)} style={{ paddingTop: 8, paddingHorizontal: 12, paddingBottom: (insets.bottom || 12) + 12 }}>
              <ScrollView
                key={`tl-${tlKey}`}
                ref={tlRef}
                horizontal
                onScroll={onTlScroll}
                scrollEventThrottle={16}
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <View style={{ width: contentW }}>
                  {/* RULER visible y clara */}
                  <View
                    style={{
                      height: RULER_H,
                      backgroundColor: "#0c1018",
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: "#1f2430",
                      justifyContent: "center",
                    }}
                    onStartShouldSetResponder={() => true}
                    onResponderGrant={(e) => startScrub(e.nativeEvent.locationX)}
                    onResponderMove={(e) => moveScrub(e.nativeEvent.locationX)}
                    onResponderRelease={endScrub}
                  >
                    {/* marcas cada segundo */}
                    <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, flexDirection: "row" }}>
                      {Array.from({ length: Math.max(1, Math.ceil((endMs || 1) / 1000)) }).map((_, i) => (
                        <View key={i} style={{ width: 1000 * pxPerMs, borderRightWidth: 1, borderRightColor: "#293042" }} />
                      ))}
                    </View>
                    {/* hint inicial */}
                    {showScrubHint && (
                      <View style={{ alignItems: "center" }}>
                        <Text style={{ color: "#9aa0a6", fontSize: 12 }}>Arrastra aquí para moverte</Text>
                      </View>
                    )}
                    {/* “thumb” del playhead para dar pista táctil */}
                    <View
                      style={{
                        position: "absolute",
                        left: curMs * pxPerMs - 10,
                        top: (RULER_H - 20) / 2,
                        width: 20,
                        height: 20,
                        borderRadius: 10,
                        backgroundColor: "#fff",
                      }}
                    />
                  </View>

                  {/* PISTAS (scroll vertical si hay muchas) */}
                  <View style={{ height: VISIBLE_TRACKS_H }}>
                    <ScrollView nestedScrollEnabled showsVerticalScrollIndicator contentContainerStyle={{ paddingVertical: 6 }}>
                      <TimelineContent
                        width={contentW}
                        pxPerMs={pxPerMs}
                        clips={clips}
                        durationMs={endMs}
                        onChange={onClipChange}
                        onDelete={onDeleteClip}
                        onBeginDragClip={pauseIfPlaying}
                        trackHeight={36}
                        gap={8}
                      />
                    </ScrollView>
                  </View>

                  {/* Playhead vertical (cubre ruler + pistas) */}
                  <View
                    pointerEvents="none"
                    style={{
                      position: "absolute",
                      left: curMs * pxPerMs,
                      top: 0,
                      height: RULER_H + VISIBLE_TRACKS_H,
                      width: 2,
                      backgroundColor: "#ff2d55",
                    }}
                  />
                </View>
              </ScrollView>
            </View>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

/* ───────── Overlays arrastrables ───────── */
function DragOverlay({
  item,
  selected,
  vpW,
  vpH,
  onChange,
  onSelect,
}: {
  item: Movable;
  selected: boolean;
  vpW: number;
  vpH: number;
  onChange: (patch: Partial<Movable>) => void;
  onSelect: () => void;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const startRef = useRef({ x: item.x, y: item.y });

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startRef.current = { x: item.x, y: item.y };
        onSelect();
      },
      onPanResponderMove: (_evt, g) => {
        if (!vpW || !vpH) return;
        const dxPct = g.dx / vpW;
        const dyPct = g.dy / vpH;
        let nx = startRef.current.x + dxPct;
        let ny = startRef.current.y + dyPct;

        const halfW = (size.w || 64) / vpW / 2;
        const halfH = (size.h || 64) / vpH / 2;
        nx = Math.max(0 + halfW, Math.min(1 - halfW, nx));
        ny = Math.max(0 + halfH, Math.min(1 - halfH, ny));

        onChange({ x: nx, y: ny });
      },
      onPanResponderRelease: () => {},
    })
  ).current;

  const isText = item.type === "text";
  const baseStyle: any = isText ? { fontSize: (item as any).fontSize, color: (item as any).color, fontWeight: "900" } : { fontSize: 44 };

  const left = item.x * vpW;
  const top = item.y * vpH;

  return (
    <View
      {...pan.panHandlers}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      style={{
        position: "absolute",
        left,
        top,
        transform: [{ translateX: -size.w / 2 }, { translateY: -size.h / 2 }],
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
        backgroundColor: selected ? "#ffffff22" : "transparent",
      }}
    >
      <Text style={[baseStyle]}>{isText ? (item as any).text : (item as any).emoji}</Text>
    </View>
  );
}

/* ───────── Timeline ───────── */
function TimelineContent({
  width,
  pxPerMs,
  clips,
  durationMs,
  onChange,
  onDelete,
  onBeginDragClip,
  trackHeight = 26,
  gap = 6,
}: {
  width: number;
  pxPerMs: number;
  clips: ClipModel[];
  durationMs: number;
  onChange: (id: string, patch: Partial<ClipModel>) => void;
  onDelete: (id: string) => void;
  onBeginDragClip?: () => void;
  trackHeight?: number;
  gap?: number;
}) {
  const totalH = clips.length * (trackHeight + gap);

  return (
    <View style={{ width, height: Math.max(totalH, trackHeight) }}>
      {clips.map((c, i) => (
        <ClipBox
          key={c.id}
          y={i * (trackHeight + gap)}
          h={trackHeight}
          pxPerMs={pxPerMs}
          clip={c}
          durationMs={durationMs}
          onChange={onChange}
          onDelete={onDelete}
          onBeginDrag={onBeginDragClip}
        />
      ))}
    </View>
  );
}

function ClipBox({
  y,
  h,
  pxPerMs,
  clip,
  durationMs,
  onChange,
  onDelete,
  onBeginDrag,
}: {
  y: number;
  h: number;
  pxPerMs: number;
  clip: ClipModel;
  durationMs: number;
  onChange: (id: string, patch: Partial<ClipModel>) => void;
  onDelete: (id: string) => void;
  onBeginDrag?: () => void;
}) {
  const MIN = 300; // 300ms
  const [box, setBox] = useState({ start: clip.startMs, end: clip.endMs });
  useEffect(() => setBox({ start: clip.startMs, end: clip.endMs }), [clip.startMs, clip.endMs]);

  // mover clip completo
  const drag = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => clip.movable,
      onPanResponderGrant: () => onBeginDrag?.(),
      onPanResponderMove: (_evt, g) => {
        if (!clip.movable) return;
        const deltaMs = g.dx / pxPerMs;
        let s = clip.startMs + deltaMs;
        let e = clip.endMs + deltaMs;
        const len = e - s;
        if (s < 0) {
          e += -s;
          s = 0;
        }
        if (e > durationMs) {
          const dif = e - durationMs;
          s -= dif;
          e = durationMs;
        }
        if (len >= MIN) setBox({ start: s, end: e });
      },
      onPanResponderRelease: (_e, g) => {
        if (!clip.movable) return;
        const deltaMs = g.dx / pxPerMs;
        let s = Math.max(0, Math.min(clip.startMs + deltaMs, durationMs - MIN));
        let e = Math.max(s + MIN, Math.min(clip.endMs + deltaMs, durationMs));
        onChange(clip.id, { startMs: s, endMs: e });
      },
    })
  ).current;

  // resize izquierda
  const resizeL = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => clip.resizable,
      onPanResponderGrant: () => onBeginDrag?.(),
      onPanResponderMove: (_evt, g) => {
        if (!clip.resizable) return;
        let s = clip.startMs + g.dx / pxPerMs;
        s = Math.max(0, Math.min(s, clip.endMs - MIN));
        setBox({ start: s, end: clip.endMs });
      },
      onPanResponderRelease: (_e, g) => {
        if (!clip.resizable) return;
        let s = clip.startMs + g.dx / pxPerMs;
        s = Math.max(0, Math.min(s, clip.endMs - MIN));
        onChange(clip.id, { startMs: s });
      },
    })
  ).current;

  // resize derecha
  const resizeR = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => clip.resizable,
      onPanResponderGrant: () => onBeginDrag?.(),
      onPanResponderMove: (_evt, g) => {
        if (!clip.resizable) return;
        let e = clip.endMs + g.dx / pxPerMs;
        e = Math.max(clip.startMs + MIN, Math.min(e, durationMs));
        setBox({ start: clip.startMs, end: e });
      },
      onPanResponderRelease: (_e, g) => {
        if (!clip.resizable) return;
        let e = clip.endMs + g.dx / pxPerMs;
        e = Math.max(clip.startMs + MIN, Math.min(e, durationMs));
        onChange(clip.id, { endMs: e });
      },
    })
  ).current;

  const left = box.start * pxPerMs;
  const width = Math.max(6, (box.end - box.start) * pxPerMs);
  const bg = clip.color;

  return (
    <View style={{ position: "absolute", left, top: y, height: h, width }}>
      {/* caja */}
      <View
        {...drag.panHandlers}
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: bg,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: "#0b0b0d",
          justifyContent: "center",
        }}
      >
        <Text numberOfLines={1} style={{ color: "#000", fontSize: 11, fontWeight: "800", paddingHorizontal: 6 }}>
          {clip.label}
        </Text>
      </View>

      {/* asas */}
      <View {...resizeL.panHandlers} style={{ position: "absolute", left: -6, top: 0, width: 12, height: h, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 4, height: h - 8, backgroundColor: "#111827", borderRadius: 2 }} />
      </View>
      <View {...resizeR.panHandlers} style={{ position: "absolute", right: -6, top: 0, width: 12, height: h, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 4, height: h - 8, backgroundColor: "#111827", borderRadius: 2 }} />
      </View>

      {/* borrar */}
      {clip.deletable && (
        <TouchableOpacity onPress={() => onDelete(clip.id)} style={{ position: "absolute", right: 4, top: -16, backgroundColor: "#ef4444", borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 }}>
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 10 }}>X</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
