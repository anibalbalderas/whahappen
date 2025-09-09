import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView,
  Platform, Alert, Keyboard, Animated, Easing, Pressable, TouchableWithoutFeedback
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useRouter, Link } from 'expo-router';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { Ionicons } from '@expo/vector-icons';
import { auth } from '../../lib/firebase';
import { ensureProfileDoc } from '../../lib/profile';

const primary = ['#7F00FF', '#E100FF'];

function FloatingChips() {
  const a1 = useRef(new Animated.Value(0)).current;
  const a2 = useRef(new Animated.Value(0)).current;
  const a3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = (val: Animated.Value, delay = 0) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(val, { toValue: 1, duration: 6000, easing: Easing.inOut(Easing.quad), useNativeDriver: true, delay }),
          Animated.timing(val, { toValue: 0, duration: 6000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ])
      ).start();
    loop(a1);
    loop(a2, 1200);
    loop(a3, 2400);
  }, []);

  const chip = (label: string, val: Animated.Value, x: number, y: number, rotate = '-6deg') => {
    const translateY = val.interpolate({ inputRange: [0, 1], outputRange: [0, -16] });
    const opacity = val.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.9] });
    return (
      <Animated.View
        style={{
          position: 'absolute', left: x, top: y, transform: [{ translateY }, { rotate: rotate as any }], opacity
        }}
      >
        <View style={{ backgroundColor: '#ffffff22', borderColor: '#ffffff33', borderWidth: 1, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999 }}>
          <Text style={{ color: '#fff' }}>#{label}</Text>
        </View>
      </Animated.View>
    );
  };

  return (
    <>
      {chip('global', a1, 20, 90, '-8deg')}
      {chip('caritativo', a2, 240, 160, '5deg')}
      {chip('creativo', a3, 80, 260, '10deg')}
    </>
  );
}

export default function SignIn() {
  const r = useRouter();
  const [email, setEmail] = useState('');
  const [pwd, setPwd] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);

  const login = async () => {
    try {
      setLoading(true);
      await signInWithEmailAndPassword(auth, email.trim(), pwd);
      await ensureProfileDoc();
      r.replace('/feed');
    } catch (e: any) {
      Alert.alert('No se pudo iniciar sesión', e?.message ?? 'Revisa tus datos');
    } finally { setLoading(false); }
  };

  const forgot = async () => {
    if (!email.trim()) { Alert.alert('Escribe tu email para enviarte el enlace'); return; }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      Alert.alert('Listo', 'Te enviamos un enlace para restablecer tu contraseña.');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No pudimos enviar el correo.');
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding', android: undefined })} style={{ flex: 1 }}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <LinearGradient colors={['#0b0b0d', '#000']} style={{ flex: 1, padding: 20, justifyContent: 'center' }}>
          {/* halos morados */}
          <LinearGradient
            colors={['#7F00FF33', '#E100FF11', 'transparent']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ position: 'absolute', width: 360, height: 360, borderRadius: 999, top: -80, right: -80 }}
          />
          <LinearGradient
            colors={['#E100FF33', '#7F00FF11', 'transparent']}
            start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }}
            style={{ position: 'absolute', width: 320, height: 320, borderRadius: 999, bottom: -60, left: -60 }}
          />

          {/* chips flotantes temáticos */}
          <FloatingChips />

          {/* CARD */}
          <BlurView intensity={40} tint="dark" style={{ borderRadius: 20, overflow: 'hidden' }}>
            <View style={{ borderWidth: 1, borderColor: '#1f2126', borderRadius: 20, overflow: 'hidden' }}>
              <LinearGradient colors={['#101114cc', '#0b0b0dcc']} style={{ padding: 20 }}>
                {/* Brand */}
                <View style={{ alignItems: 'center', marginBottom: 14 }}>
                  <Text style={{ color: 'white', fontSize: 32, fontWeight: '900', letterSpacing: 0.5 }}>WhaHappen</Text>
                  <Text style={{ color: '#c9c9c9', marginTop: 6, textAlign: 'center' }}>
                    Retos diarios. Crea • Comparte • Compite
                  </Text>
                </View>

                {/* Inputs */}
                <View style={{ gap: 12 }}>
                  <View style={{ position: 'relative' }}>
                    <Ionicons name="mail-outline" size={18} color="#b7b7b7" style={{ position: 'absolute', left: 12, top: 16 }} />
                    <TextInput
                      value={email}
                      onChangeText={setEmail}
                      placeholder="Email"
                      placeholderTextColor="#888"
                      autoCapitalize="none"
                      keyboardType="email-address"
                      style={{
                        backgroundColor: '#121212aa', color: 'white', borderRadius: 12, paddingVertical: 14,
                        paddingLeft: 40, paddingRight: 14, borderWidth: 1, borderColor: '#222'
                      }}
                      returnKeyType="next"
                      onSubmitEditing={Keyboard.dismiss}
                    />
                  </View>

                  <View style={{ position: 'relative' }}>
                    <Ionicons name="lock-closed-outline" size={18} color="#b7b7b7" style={{ position: 'absolute', left: 12, top: 16 }} />
                    <TextInput
                      value={pwd}
                      onChangeText={setPwd}
                      placeholder="Contraseña"
                      placeholderTextColor="#888"
                      secureTextEntry={!showPwd}
                      style={{
                        backgroundColor: '#121212aa', color: 'white', borderRadius: 12, paddingVertical: 14,
                        paddingLeft: 40, paddingRight: 44, borderWidth: 1, borderColor: '#222'
                      }}
                      returnKeyType="go"
                      onSubmitEditing={login}
                    />
                    <Pressable onPress={() => setShowPwd(s => !s)} style={{ position: 'absolute', right: 10, top: 10, padding: 6 }}>
                      <Ionicons name={showPwd ? 'eye-off-outline' : 'eye-outline'} size={20} color="#b7b7b7" />
                    </Pressable>
                  </View>

                  <TouchableOpacity onPress={login} disabled={loading} activeOpacity={0.9}>
                    <LinearGradient
                      colors={primary}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                      style={{ paddingVertical: 14, borderRadius: 12, alignItems: 'center', opacity: loading ? 0.7 : 1 }}
                    >
                      <Text style={{ color: 'white', fontWeight: '900' }}>{loading ? 'Entrando…' : 'Entrar'}</Text>
                    </LinearGradient>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={forgot} style={{ paddingVertical: 8, alignSelf: 'center' }}>
                    <Text style={{ color: '#9aa0a6' }}>¿Olvidaste tu contraseña?</Text>
                  </TouchableOpacity>
                </View>

                {/* Divider */}
                <View style={{ height: 1, backgroundColor: '#ffffff14', marginVertical: 12 }} />

                <Text style={{ color: '#9aa0a6', textAlign: 'center' }}>
                  ¿No tienes cuenta? <Link href="/(auth)/signup" style={{ color: 'white', fontWeight: '800' }}>Regístrate</Link>
                </Text>
              </LinearGradient>
            </View>
          </BlurView>
        </LinearGradient>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}
