import { readEnv } from './services/env.js';
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getAuth, browserLocalPersistence, setPersistence, connectAuthEmulator } from "firebase/auth";

// Local emulators for automated tests only (set by `firebase emulators:exec` in Node).
// Browser builds never define these variables, so production always uses the live project.
const nodeEnv = typeof process !== 'undefined' && typeof window === 'undefined' ? process.env : {};
const FIRESTORE_EMULATOR = nodeEnv.FIRESTORE_EMULATOR_HOST || '';
const AUTH_EMULATOR = nodeEnv.FIREBASE_AUTH_EMULATOR_HOST || '';
// Unit tests in Node set this (tests/fixtures/noLiveFirebase.js) so they never reach the live
// project: Firebase stays off and every service takes its offline path. Database checks run
// against the emulator copy instead (npm run test:e2e / test:rules).
const OFFLINE_FOR_TESTS = nodeEnv.OZEDU_FIREBASE_OFFLINE === '1' && !FIRESTORE_EMULATOR;

// Support static cPanel and shared hosting environments via window.__FIREBASE_CONFIG__ runtime injection
const configFromWindow = typeof window !== "undefined" && window.__FIREBASE_CONFIG__ ? window.__FIREBASE_CONFIG__ : null;

export const firebaseConfig = {
  apiKey: configFromWindow?.apiKey || readEnv(() => import.meta.env.VITE_FIREBASE_API_KEY, 'VITE_FIREBASE_API_KEY') || "",
  authDomain: configFromWindow?.authDomain || readEnv(() => import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, 'VITE_FIREBASE_AUTH_DOMAIN') || "ai-foundation-firebase.firebaseapp.com",
  projectId: configFromWindow?.projectId || readEnv(() => import.meta.env.VITE_FIREBASE_PROJECT_ID, 'VITE_FIREBASE_PROJECT_ID') || "ai-foundation-firebase",
  storageBucket: configFromWindow?.storageBucket || readEnv(() => import.meta.env.VITE_FIREBASE_STORAGE_BUCKET, 'VITE_FIREBASE_STORAGE_BUCKET') || "ai-foundation-firebase.firebasestorage.app",
  messagingSenderId: configFromWindow?.messagingSenderId || readEnv(() => import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID, 'VITE_FIREBASE_MESSAGING_SENDER_ID') || "614773274800",
  appId: configFromWindow?.appId || readEnv(() => import.meta.env.VITE_FIREBASE_APP_ID, 'VITE_FIREBASE_APP_ID') || "1:614773274800:web:bcfa9d363de884cf9ea375",
  measurementId: configFromWindow?.measurementId || readEnv(() => import.meta.env.VITE_FIREBASE_MEASUREMENT_ID, 'VITE_FIREBASE_MEASUREMENT_ID') || "G-9V4X460YRL"
};

let app = null;
let analytics = null;
let db = null;
let auth = null;

export function getOrInitAuth() {
  if (auth || OFFLINE_FOR_TESTS) return auth;
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

function initFirebase() {
  try {
    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);

    if (FIRESTORE_EMULATOR) {
      const [host, port] = FIRESTORE_EMULATOR.split(':');
      connectFirestoreEmulator(db, host, Number(port) || 8080);
    }
    if (AUTH_EMULATOR) {
      connectAuthEmulator(auth, `http://${AUTH_EMULATOR}`, { disableWarnings: true });
    }

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
}

if (!OFFLINE_FOR_TESTS) initFirebase();

export { app, analytics, db, auth };
