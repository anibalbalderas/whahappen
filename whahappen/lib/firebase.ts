// lib/firebase.ts
import { initializeApp } from 'firebase/app';
import {
  initializeAuth,
  getReactNativePersistence,
} from 'firebase/auth';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// ⚠️ Pega aquí tu config real (la que ya usabas)
const firebaseConfig = {
  apiKey: "AIzaSyDWhke9kL_PNs4Ki7DTxyjtH5Nqn-olpdo",
  authDomain: "whahappen-feea0.firebaseapp.com",
  projectId: "whahappen-feea0",
  storageBucket: "whahappen-feea0.firebasestorage.app",
  messagingSenderId: "1091720432494",
  appId: "1:1091720432494:web:d75e5a4aab28a894ce8f7f",
  measurementId: "G-8QQL89D1MP"
};

const app = initializeApp(firebaseConfig);

export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(ReactNativeAsyncStorage),
});

export const db = getFirestore(app);
export const storage = getStorage(app);

// Compat: antes usábamos ensureAnonAuth. Ahora exigimos sesión real.
// Mantengo el nombre pero SIN auto login anónimo.
export async function ensureAnonAuth() {
  if (!auth.currentUser) throw new Error('not-authenticated');
}

