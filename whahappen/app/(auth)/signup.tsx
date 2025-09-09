import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView,
  Platform, Alert, Keyboard, Pressable, Animated, Easing, TouchableWithoutFeedback
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useRouter, Link } from 'expo-router';
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  linkWithCredential,
} from 'firebase/auth';
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
    loop(a2, 900);
    loop(a3, 1800);
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
      {chip('rebelde', a1, 30, 80, '-8deg')}
      {chip('troll', a2, 220, 150, '5deg')}
      {chip('chill', a3, 120, 260, '10deg')}
    </>
  );
}

export default function SignUp() {
  const r = useRouter();
  const [email, setEmail] = useState('');
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [showPwd2, setShowPwd2] = useState(false);
  const [loading, setLoading] = useState(false);

  const register = async () => {
    if (!email.trim() || !pwd) { Alert.alert('Completa los campos'); return; }
    if (pwd.length < 6) { Alert.alert('La contraseña debe tener al menos 6 caracteres'); return; }
    if (pwd !== pwd2) { Alert.alert('Las contraseñas no coinciden'); return; }

    try {
      setLoading(true);
      const u = auth.currentUser;
      if (u && (u as any).isAnonymous) {
        const cred = EmailAuthProvider.credential(email.trim(), pwd);
        await linkWithCredential(u, cred);
      } else {
        await createUserWithEmailAndPassword(auth, email.trim(), pwd);
        await ensureProfileDoc();
        r.replace('/feed');
      }
      r.replace('/');
        } catch (e: any) {
          const code = e?.code || '';
          let msg = 'Intenta de nuevo';
          if (code === 'auth/operation-not-allowed') {
            msg = 'Activa el proveedor Email/Password en Firebase → Authentication → Sign-in method.';
          } else if (code === 'auth/email-already-in-use') {
            msg = 'Ese email ya está registrado. Intenta iniciar sesión.';
          } else if (code === 'auth/invalid-email') {
            msg = 'Email inválido.';
          } else if (code === 'auth/weak-password') {
            msg = 'La contraseña es muy corta (mín. 6).';
          }
          Alert.alert('No se pudo crear la cuenta', msg);
        } finally { setLoading(false); }
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

          <FloatingChips />

          {/* CARD */}
          <BlurView intensity={40} tint="dark" style={{ borderRadius: 20, overflow: 'hidden' }}>
            <View style={{ borderWidth: 1, borderColor: '#1f2126', borderRadius: 20, overflow: 'hidden' }}>
              <LinearGradient colors={['#101114cc', '#0b0b0dcc']} style={{ padding: 20 }}>
                {/* Brand */}
                <View style={{ alignItems: 'center', marginBottom: 14 }}>
                  <Text style={{ color: 'white', fontSize: 32, fontWeight: '900', letterSpacing: 0.5 }}>Únete a WhaHappen</Text>
                  <Text style={{ color: '#c9c9c9', marginTop: 6, textAlign: 'center' }}>
                    Tu lugar para cumplir el reto del día
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
                      returnKeyType="next"
                    />
                    <Pressable onPress={() => setShowPwd(s => !s)} style={{ position: 'absolute', right: 10, top: 10, padding: 6 }}>
                      <Ionicons name={showPwd ? 'eye-off-outline' : 'eye-outline'} size={20} color="#b7b7b7" />
                    </Pressable>
                  </View>

                  <View style={{ position: 'relative' }}>
                    <Ionicons name="lock-closed-outline" size={18} color="#b7b7b7" style={{ position: 'absolute', left: 12, top: 16 }} />
                    <TextInput
                      value={pwd2}
                      onChangeText={setPwd2}
                      placeholder="Repite la contraseña"
                      placeholderTextColor="#888"
                      secureTextEntry={!showPwd2}
                      style={{
                        backgroundColor: '#121212aa', color: 'white', borderRadius: 12, paddingVertical: 14,
                        paddingLeft: 40, paddingRight: 44, borderWidth: 1, borderColor: '#222'
                      }}
                      returnKeyType="go"
                      onSubmitEditing={register}
                    />
                    <Pressable onPress={() => setShowPwd2(s => !s)} style={{ position: 'absolute', right: 10, top: 10, padding: 6 }}>
                      <Ionicons name={showPwd2 ? 'eye-off-outline' : 'eye-outline'} size={20} color="#b7b7b7" />
                    </Pressable>
                  </View>

                  <TouchableOpacity onPress={register} disabled={loading} activeOpacity={0.9}>
                    <LinearGradient
                      colors={primary}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                      style={{ paddingVertical: 14, borderRadius: 12, alignItems: 'center', opacity: loading ? 0.7 : 1 }}
                    >
                      <Text style={{ color: 'white', fontWeight: '900' }}>{loading ? 'Creando…' : 'Crear cuenta'}</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>

                {/* Divider */}
                <View style={{ height: 1, backgroundColor: '#ffffff14', marginVertical: 12 }} />

                <Text style={{ color: '#9aa0a6', textAlign: 'center' }}>
                  ¿Ya tienes cuenta? <Link href="/(auth)/signin" style={{ color: 'white', fontWeight: '800' }}>Inicia sesión</Link>
                </Text>
              </LinearGradient>
            </View>
          </BlurView>
        </LinearGradient>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}
