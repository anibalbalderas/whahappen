// lib/push.ts
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { auth, db } from './firebase';
import { doc, updateDoc } from 'firebase/firestore';

// Muestra banner/lista cuando la app está abierta
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,   // banner/list
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function registerForPushTokenAndSave() {
  try {
    if (!Device.isDevice) return null;

    // Pide permisos
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return null;

    // Obtén ExpoPushToken
    const token = (await Notifications.getExpoPushTokenAsync()).data;

    // Guarda en tu usuario
    const uid = auth.currentUser?.uid;
    if (uid) {
      await updateDoc(doc(db, 'users', uid), { pushToken: token } as any);
    }

    // Canal Android
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    return token;
  } catch (err) {
    console.warn('registerForPushTokenAndSave error', err);
    return null;
  }
}
