import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export const app = getApps().length ? getApp() : initializeApp();
export const db = getFirestore(app);
