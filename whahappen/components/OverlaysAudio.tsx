// components/OverlaysAudio.tsx
import { useEffect, useRef } from 'react';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';

type Track = { url?: string; volume?: number };
type Props = {
  bgm?: Track;
  voice?: Track;
  playing: boolean;
  positionMs: number; // para sincronizar con el video (loop manual)
};

export default function OverlaysAudio({ bgm, voice, playing, positionMs }: Props) {
  const bgmRef = useRef<Audio.Sound | null>(null);
  const voiceRef = useRef<Audio.Sound | null>(null);

  // modo audio
  useEffect(() => {
    (async () => {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        interruptionModeIOS: InterruptionModeIOS.DoNotMix,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
        shouldDuckAndroid: true,
      });
    })();
  }, []);

  // cargar/descargar pistas
  useEffect(() => {
    (async () => {
      // bgm
      try {
        await bgmRef.current?.unloadAsync();
        bgmRef.current = null;
        if (bgm?.url) {
          const { sound } = await Audio.Sound.createAsync({ uri: bgm.url }, { isLooping: true, shouldPlay: playing, volume: bgm.volume ?? 1 });
          bgmRef.current = sound;
          await sound.setPositionAsync(positionMs);
        }
      } catch {}
      // voice
      try {
        await voiceRef.current?.unloadAsync();
        voiceRef.current = null;
        if (voice?.url) {
          const { sound } = await Audio.Sound.createAsync({ uri: voice.url }, { isLooping: true, shouldPlay: playing, volume: voice.volume ?? 1 });
          voiceRef.current = sound;
          await sound.setPositionAsync(positionMs);
        }
      } catch {}
    })();
    return () => { bgmRef.current?.unloadAsync(); voiceRef.current?.unloadAsync(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgm?.url, voice?.url]);

  // play/pause
  useEffect(() => {
    (async () => {
      const sounds = [bgmRef.current, voiceRef.current].filter(Boolean) as Audio.Sound[];
      for (const s of sounds) {
        if (playing) await s.playAsync(); else await s.pauseAsync();
      }
    })();
  }, [playing]);

  // volumes
  useEffect(() => { if (bgmRef.current && typeof bgm?.volume === 'number') bgmRef.current.setVolumeAsync(bgm.volume); }, [bgm?.volume]);
  useEffect(() => { if (voiceRef.current && typeof voice?.volume === 'number') voiceRef.current.setVolumeAsync(voice.volume); }, [voice?.volume]);

  // seek
  useEffect(() => {
    (async () => {
      const sounds = [bgmRef.current, voiceRef.current].filter(Boolean) as Audio.Sound[];
      for (const s of sounds) { try { await s.setPositionAsync(positionMs); } catch {} }
    })();
  }, [positionMs]);

  return null;
}
