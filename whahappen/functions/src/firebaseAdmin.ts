// functions/src/firebaseAdmin.ts
import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

export const app = getApps().length ? getApp() : initializeApp();
export const db = getFirestore(app);

// 👇 Añade estas exports para usarlas en otras funciones
export { FieldValue, Timestamp };
