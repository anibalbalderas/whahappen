import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { ensureAnonAuth, auth, db } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { todayKey } from '../lib/date';
import { setSelectedMode } from '../lib/session';
import { getTodayChoice, lockTodayChoice, millisLeft, formatCountdown } from '../lib/choices';

const MOODS = [
  { key: 'caritativo', label: 'Caritativo', icon: 'heart-outline' },
  { key: 'picaro',     label: 'Pícaro',     icon: 'flash-outline' },
  { key: 'creativo',   label: 'Creativo',   icon: 'color-palette-outline' },
  { key: 'rebelde',    label: 'Rebelde',    icon: 'flame-outline' },
  { key: 'troll',      label: 'Troll',      icon: 'game-controller-outline' },
  { key: 'chill',      label: 'Chill',      icon: 'leaf-outline' },
];

export default function Home() {
  const r = useRouter();
  const insets = useSafeAreaInsets();

  const [lockedMode, setLockedMode] = useState<string | null>(null);
  const [left, setLeft] = useState<number>(0); // ms restantes

  // Si ya publicaste hoy, el index redirige al feed
  useEffect(() => {
    (async () => {
      await ensureAnonAuth();
      const uid = auth.currentUser?.uid!;
      const uSnap = await getDoc(doc(db, 'users', uid));
      const unlocked = uSnap.exists() && uSnap.data()?.unlockedDateKey === todayKey();
      if (unlocked) { r.replace('/feed'); return; }

      const { choice } = await getTodayChoice().catch(() => ({ choice: null }));
      if (choice) {
        setLockedMode(choice.mode);
        setLeft(millisLeft(choice.expiresAt));
      }
    })();

    const id = setInterval(async () => {
      try {
        const { choice } = await getTodayChoice();
        if (choice) {
          setLockedMode(choice.mode);
          setLeft(millisLeft(choice.expiresAt));
        }
      } catch {}
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const choose = async (mode: string) => {
    // Si ya hay lock y es distinto, bloquear
    if (lockedMode && lockedMode !== mode && left > 0) {
      Alert.alert('Reto elegido', `Hoy ya elegiste: #${lockedMode}. Te quedan ${formatCountdown(left)}.`);
      return;
    }
    await ensureAnonAuth();
    if (!lockedMode || left === 0) {
      await lockTodayChoice(mode, 30);
      setLockedMode(mode);
    }
    setSelectedMode(mode);
    r.push('/record');
  };

  const globalDisabled = !!lockedMode && lockedMode !== 'global' && left > 0;

  return (
    <LinearGradient colors={['#0b0b0d', '#000']} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, padding: 20, paddingBottom: 20 + insets.bottom }}>
        <Text style={{ color: 'white', fontSize: 30, fontWeight: '900' }}>WhaHappen</Text>

        {/* HERO GLOBAL */}
        <LinearGradient
          colors={['#7F00FF', '#E100FF']}
          start={{x:0,y:0}} end={{x:1,y:1}}
          style={{ borderRadius: 20, padding: 18, marginTop: 16 }}
        >
          <Text style={{ color: '#fff', opacity: 0.9, fontSize: 12 }}>Reto de hoy</Text>
          <Text style={{ color: '#fff', fontWeight: '900', fontSize: 24, marginTop: 4 }}>GLOBAL</Text>
          <Text style={{ color: '#fff', opacity: 0.85, marginTop: 4 }}>
            Toca para revelar el reto y grabar (se bloqueará por 30 min)
          </Text>

          <TouchableOpacity
            onPress={() => choose('global')}
            activeOpacity={0.9}
            disabled={globalDisabled}
            style={{
              marginTop: 14, backgroundColor: 'white', paddingVertical: 12, borderRadius: 12,
              alignItems: 'center', opacity: globalDisabled ? 0.45 : 1
            }}
          >
            <Text style={{ color: '#000', fontWeight: '800' }}>
              {lockedMode === 'global' && left > 0
                ? `Continuar (quedan ${formatCountdown(left)})`
                : globalDisabled
                  ? `Bloqueado`
                  : 'Grabar reto GLOBAL'}
            </Text>
          </TouchableOpacity>
        </LinearGradient>

        {/* Moods */}
        <Text style={{ color: '#c5c7cb', marginTop: 22, marginBottom: 8 }}>Elige tu mood</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          {MOODS.map((m) => {
            const disabled = !!lockedMode && lockedMode !== m.key && left > 0;
            const isMine = lockedMode === m.key && left > 0;
            return (
              <TouchableOpacity
                key={m.key}
                onPress={() => choose(m.key)}
                activeOpacity={0.9}
                disabled={disabled}
                style={{ width: '48%', marginBottom: 12, opacity: disabled ? 0.45 : 1 }}
              >
                <View style={{ backgroundColor: '#101114', borderRadius: 18, borderWidth: 1, borderColor: '#1f2126', padding: 14 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#181a1f', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2a2d34' }}>
                      <Ionicons name={m.icon as any} size={20} color="#fff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: 'white', fontWeight: '800' }}>#{m.label}</Text>
                      <Text style={{ color: '#9aa0a6', fontSize: 12 }} numberOfLines={1}>
                        {isMine ? `Quedan ${formatCountdown(left)}` : 'Toca para jugar'}
                      </Text>
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}
