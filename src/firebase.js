import { initializeApp, getApps, getApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";
import { getAuth, browserLocalPersistence, setPersistence } from "firebase/auth";

// Support static cPanel and shared hosting environments via window.__FIREBASE_CONFIG__ runtime injection
const configFromWindow = typeof window !== "undefined" && window.__FIREBASE_CONFIG__ ? window.__FIREBASE_CONFIG__ : null;

export const firebaseConfig = {
  apiKey: configFromWindow?.apiKey || import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCPeAOWQj8456TeIWDIPsyxyWT7QLrC8J8",
  authDomain: configFromWindow?.authDomain || import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "ai-foundation-firebase.firebaseapp.com",
  projectId: configFromWindow?.projectId || import.meta.env.VITE_FIREBASE_PROJECT_ID || "ai-foundation-firebase",
  storageBucket: configFromWindow?.storageBucket || import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "ai-foundation-firebase.firebasestorage.app",
  messagingSenderId: configFromWindow?.messagingSenderId || import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "614773274800",
  appId: configFromWindow?.appId || import.meta.env.VITE_FIREBASE_APP_ID || "1:614773274800:web:bcfa9d363de884cf9ea375",
  measurementId: configFromWindow?.measurementId || import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-9V4X460YRL"
};

let app = null;
let analytics = null;
let db = null;
let auth = null;

export function getOrInitAuth() {
  if (auth) return auth;
  try {
    const activeApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    auth = getAuth(activeApp);
    if (typeof window !== "undefined" && auth) {
      setPersistence(auth, browserLocalPersistence).catch(() => {});
    }
    return auth;
  } catch (err) {
    console.error("Failed to initialize Firebase Auth on demand:", err);
    return null;
  }
}

try {
  app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);

  // Enforce session persistence using browserLocalPersistence across web runtimes
  if (typeof window !== "undefined" && auth) {
    setPersistence(auth, browserLocalPersistence).catch((err) => {
      console.warn("Auth persistence notice:", err);
    });
  }

  if (typeof window !== "undefined" && firebaseConfig.measurementId) {
    try {
      analytics = getAnalytics(app);
    } catch {
      // Analytics blocked or unavailable; non-critical
    }
  }
} catch (error) {
  console.error("Firebase initialization failed:", error);
}

export { app, analytics, db, auth };
