// app/profile/edit.tsx
import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, Alert, Image,
  Platform, KeyboardAvoidingView, ScrollView
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import { auth, db } from '../../lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function EditProfile() {
  const r = useRouter();
  const insets = useSafeAreaInsets();
  const uid = auth.currentUser?.uid!;
  const [bio, setBio] = useState('');
  const [photo, setPhoto] = useState<string | null>(null); // file:// o dataURL o https://
  const [saving, setSaving] = useState(false);
  const [errImg, setErrImg] = useState(false);

  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, 'users', uid));
      const d = snap.data() as any;
      setBio(d?.bio ?? '');
      // preferimos dataURL si ya existe, si no, fallback a photoURL
      setPhoto(d?.photoDataURL ?? d?.photoURL ?? null);
    })();
  }, [uid]);

  // Picker compatible con SDKs antiguos: usa MediaTypeOptions si MediaType no existe
  const pick = async () => {
    try {
      const mediaTypes =
        (ImagePicker as any).MediaType?.Images ?? ImagePicker.MediaTypeOptions.Images;

      const res: any = await ImagePicker.launchImageLibraryAsync({
        mediaTypes,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });

      const wasCanceled = (res?.canceled ?? res?.cancelled) === true;
      if (wasCanceled) return;

      const uri = res?.assets?.[0]?.uri ?? res?.uri;
      if (!uri) throw new Error('No se recibió imagen');

      setErrImg(false);
      setPhoto(uri); // file://
    } catch (e: any) {
      Alert.alert('No se pudo abrir la galería', e?.message ?? 'Intenta de nuevo');
    }
  };

  const goBack = () => {
    if (r.canGoBack?.()) r.back();
    else r.replace(`/profile/${uid}`);
  };

  const save = async () => {
    try {
      setSaving(true);

      let updates: any = { bio: bio.trim() };

      // Si elegiste nueva imagen local, la convertimos a dataURL y la guardamos en Firestore
      if (photo && photo.startsWith('file:')) {
        const manipulated = await ImageManipulator.manipulateAsync(
          photo,
          [{ resize: { width: 640 } }],
          { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG, base64: true }
        );

        const base64 =
          manipulated.base64 ??
          (await FileSystem.readAsStringAsync(manipulated.uri, {
            encoding: FileSystem.EncodingType.Base64,
          }));

        if (!base64 || base64.length < 10) {
          throw new Error('La imagen quedó vacía al convertir a base64.');
        }

        const dataUrl = `data:image/jpeg;base64,${base64}`;
        updates.photoDataURL = dataUrl;
        setPhoto(`${dataUrl}`); // refresca local
      }

      await setDoc(doc(db, 'users', uid), updates, { merge: true });

      Alert.alert('Listo', 'Perfil actualizado');
      r.replace(`/profile/${uid}`);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding', android: undefined })} style={{ flex: 1 }}>
      <LinearGradient colors={['#0b0b0d', '#000']} style={{ flex: 1 }}>
        {/* Glows estilo login/register */}
        <LinearGradient
          colors={['#7F00FF33', '#E100FF11', 'transparent']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ position: 'absolute', width: 380, height: 380, borderRadius: 999, top: -90, right: -80 }}
        />
        <LinearGradient
          colors={['#E100FF33', '#7F00FF11', 'transparent']}
          start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }}
          style={{ position: 'absolute', width: 340, height: 340, borderRadius: 999, bottom: -70, left: -70 }}
        />

        {/* Back flotante */}
        <View
          pointerEvents="box-none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + 56, zIndex: 9999 }}
        >
          <TouchableOpacity
            onPress={goBack}
            style={{ position: 'absolute', top: insets.top + 8, left: 12, padding: 12 }}
            hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
          >
            <Ionicons name="chevron-back" size={28} color="#fff" />
          </TouchableOpacity>
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingTop: insets.top + 12,
            paddingBottom: insets.bottom + 24,
            paddingHorizontal: 16,
          }}
        >
          <Text style={{ color: 'white', fontWeight: '900', fontSize: 26, textAlign: 'center', marginBottom: 12 }}>
            Ajusta tu perfil
          </Text>

          <BlurView intensity={40} tint="dark" style={{ borderRadius: 20, overflow: 'hidden' }}>
            <View style={{ borderWidth: 1, borderColor: '#1f2126', borderRadius: 20, overflow: 'hidden' }}>
              <View style={{ padding: 18, gap: 18, alignItems: 'center' }}>
                {/* Avatar + texto (tap abre galería) */}
                <TouchableOpacity onPress={pick} activeOpacity={0.9} style={{ alignItems: 'center' }}>
                  {photo && !errImg ? (
                    <Image
                      source={{ uri: photo }}
                      onError={() => setErrImg(true)}
                      style={{
                        width: 124, height: 124, borderRadius: 62,
                        backgroundColor: '#111', borderWidth: 1, borderColor: '#ffffff33'
                      }}
                    />
                  ) : (
                    <View
                      style={{
                        width: 124, height: 124, borderRadius: 62,
                        backgroundColor: '#2a2d34', alignItems: 'center', justifyContent: 'center',
                        borderWidth: 1, borderColor: '#ffffff22'
                      }}
                    >
                      <Ionicons name="person" size={52} color="#888" />
                    </View>
                  )}
                  <Text style={{ color:'#9aa0a6', marginTop: 10 }}>Toca para cambiar foto</Text>
                </TouchableOpacity>

                {/* Bio */}
                <View style={{ alignSelf: 'stretch' }}>
                  <Text style={{ color: '#c9c9c9', marginBottom: 8 }}>Bio</Text>
                  <TextInput
                    value={bio}
                    onChangeText={setBio}
                    placeholder="Cuéntanos algo de ti…"
                    placeholderTextColor="#888"
                    multiline
                    style={{
                      minHeight: 110,
                      backgroundColor: '#121212',
                      color: 'white',
                      borderRadius: 14,
                      padding: 14,
                      borderWidth: 1,
                      borderColor: '#222',
                    }}
                  />
                </View>

                {/* Guardar */}
                <TouchableOpacity onPress={save} disabled={saving} activeOpacity={0.9} style={{ alignSelf: 'stretch' }}>
                  <View
                    style={{
                      backgroundColor: 'white',
                      paddingVertical: 14,
                      borderRadius: 14,
                      alignItems: 'center',
                      opacity: saving ? 0.7 : 1,
                    }}
                  >
                    <Text style={{ color: 'black', fontWeight: '900' }}>
                      {saving ? 'Guardando…' : 'Guardar'}
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          </BlurView>
        </ScrollView>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}
