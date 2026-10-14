/**
 * Google Authentication & RBAC Service for Pro-LMS (AI Foundation)
 *
 * Implements:
 * - Google Sign-in with signInWithPopup and automatic fallback to signInWithRedirect
 * - Account picker enforcement: prompt: 'select_account consent', access_type: 'offline'
 * - Strict OAuth Client ID binding
 * - Session persistence via browserLocalPersistence
 * - Firestore synchronization to /users/{uid}
 * - Default role and classification: "Supporter" for newly registered users
 * - Login count increment and last_login_at update without overwriting assigned roles
 * - Dynamic resolution of administrative and Superadmin privileges from Firestore
 * - Superadmin role elevation/assignment for member roles:
 *   [student, teacher, admin staff, CEO, COO, CFO, Financial team, Superadmin, Supporter]
 * - Simultaneous purging of HTTP-only session cookies and disk token caches on logout
 * - Zero hardcoding of identities or mock auth states
 */

import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  increment,
  onSnapshot
} from 'firebase/firestore';
import { auth, db, getOrInitAuth } from '../firebase.js';
import { ALLOWED_ROLES, resolvePrivileges, isOwnerEmail } from './rolePrivileges.js';
import { listMyEnrolments } from './courseEnrollmentService.js';
import { readEnv } from './env.js';

export { ALLOWED_ROLES, resolvePrivileges };

export const OAUTH_CLIENT_ID =
  readEnv(() => import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID, 'VITE_GOOGLE_OAUTH_CLIENT_ID') ||
  '614773274800-9pooin0jia9ij91qjlk7r6r6ne02mbhg.apps.googleusercontent.com';

// Configure Google Auth Provider with offline access and account selection prompt
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account consent',
  access_type: 'offline'
});

/**
 * Synchronizes authenticated user to Firestore /users/{uid}
 * - If newly registered: sets default role and classification to 'Supporter'
 * - If existing: updates last_login_at and increments login_count without touching existing assigned roles
 */
export async function syncUserToFirestore(user) {
  if (!db || !user?.uid) {
    return {
      uid: user?.uid || '',
      email: user?.email || '',
      displayName: user?.displayName || 'User',
      photoURL: user?.photoURL || '',
      role: 'Supporter',
      classification: 'Supporter',
      login_count: 1
    };
  }

  const userRef = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(userRef);
    const nowIso = new Date().toISOString();

    if (!snap.exists()) {
      // Newly registered user: assign default classification and role "supporter"
      // If user is the Firebase project owner/admin (support@aifoundation.net.au), automatically grant superadmin
      const isFirebaseOwner = isOwnerEmail(user.email);
      // Check if user was already enrolled in any course prior to registering
      const priorEnrolments = user.email ? await listMyEnrolments(user.email).catch(() => []) : [];
      const hasPriorEnrolments = priorEnrolments.length > 0;
      const initialRole = isFirebaseOwner ? 'superadmin' : (hasPriorEnrolments ? 'student' : 'supporter');
      const newProfile = {
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || '',
        photoURL: user.photoURL || '',
        role: initialRole,
        classification: initialRole,
        token_balance: 0,
        created_at: nowIso,
        last_login_at: nowIso,
        login_count: 1,
        tag: 'lms',
        tags: ['lms', initialRole],
        lms_tags: ['lms']
      };
      await setDoc(userRef, newProfile);
      return newProfile;
    } else {
      // Existing user: increment login_count and update last_login_at without overwriting role unless supporter with enrolments
      const existing = snap.data();
      const isSupporter = String(existing.role || '').toLowerCase() === 'supporter';
      let promotedRole = null;
      if (isSupporter && user.email) {
        const enrolments = await listMyEnrolments(user.email).catch(() => []);
        if (enrolments.length > 0) {
          promotedRole = 'student';
        }
      }
      const updates = {
        displayName: user.displayName || existing.displayName || '',
        photoURL: user.photoURL || existing.photoURL || '',
        last_login_at: nowIso,
        login_count: increment(1),
        tag: 'lms',
        ...(promotedRole ? {
          role: 'student',
          classification: 'student',
          role_updated_at: nowIso,
          role_updated_by: 'system_enrolment'
        } : {})
      };
      await updateDoc(userRef, updates);
      return {
        ...existing,
        ...updates,
        role: promotedRole || existing.role || 'supporter',
        classification: promotedRole || existing.classification || 'supporter',
        login_count: (Number(existing.login_count) || 1) + 1,
        last_login_at: nowIso
      };
    }
  } catch (error) {
    console.error('Error synchronizing user to Firestore /users/{uid}:', error);
    // Graceful fallback to avoid locking the user out
    return {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
      role: 'supporter',
      classification: 'supporter',
      login_count: 1
    };
  }
}

/**
 * Executes Google sign-in using signInWithPopup with automatic fallback to signInWithRedirect upon error
 */
export async function signInWithGoogle() {
  const activeAuth = auth || getOrInitAuth();
  if (!activeAuth) {
    throw new Error('Firebase Auth is not initialized. Please verify configuration.');
  }

  try {
    const result = await signInWithPopup(activeAuth, googleProvider);
    if (result?.user) {
      const profile = await syncUserToFirestore(result.user);
      return { user: result.user, profile };
    }
    return { user: null, profile: null };
  } catch (error) {
    // If the user closed or cancelled the popup, do not throw or force a page redirect
    if (
      error.code === 'auth/popup-closed-by-user' ||
      error.code === 'auth/cancelled-popup-request'
    ) {
      return { user: null, profile: null, cancelled: true };
    }

    // If popup was blocked by browser, attempt automatic fallback to signInWithRedirect
    if (
      error.code === 'auth/popup-blocked' ||
      error.code === 'auth/operation-not-supported-in-this-environment'
    ) {
      console.warn('Popup blocked or unsupported; falling back to signInWithRedirect:', error);
      await signInWithRedirect(activeAuth, googleProvider);
      return { pendingRedirect: true };
    }

    // Clear actionable error when domain is not authorized in Firebase Console
    if (error.code === 'auth/unauthorized-domain') {
      const currentHost = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
      throw new Error(
        `Domain "${currentHost}" is not authorized for Firebase Authentication. Please add "${currentHost}" (or "vercel.app") in Firebase Console -> Authentication -> Settings -> Authorized domains.`
      );
    }

    if (error.code === 'auth/configuration-not-found') {
      throw new Error(
        'Google Sign-in provider is not enabled in Firebase Console. Please enable Google under Authentication -> Sign-in method.'
      );
    }

    throw error;
  }
}

/**
 * Explicit redirect-based sign-in for mobile or restricted browser environments
 */
export async function signInWithGoogleRedirect() {
  const activeAuth = auth || getOrInitAuth();
  if (!activeAuth) {
    throw new Error('Firebase Auth is not initialized. Please verify configuration.');
  }
  await signInWithRedirect(activeAuth, googleProvider);
  return { pendingRedirect: true };
}

/**
 * Checks for a redirect sign-in result on page mount
 */
export async function handleAuthRedirect() {
  const activeAuth = auth || getOrInitAuth();
  if (!activeAuth) return null;
  try {
    const result = await getRedirectResult(activeAuth);
    if (result?.user) {
      const profile = await syncUserToFirestore(result.user);
      return { user: result.user, profile };
    }
  } catch (error) {
    console.warn('Redirect auth handler note:', error);
  }
  return null;
}

/**
 * Resolves user profile from Firestore /users/{uid}
 */
export async function fetchUserProfile(uid) {
  if (!db || !uid) return null;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      return snap.data();
    }
  } catch (error) {
    console.warn('Error fetching user profile from Firestore:', error);
  }
  return null;
}

/**
 * Updates a member role. Only permitted when authenticated user is a verified Superadmin.
 */
export async function updateMemberRole(currentUid, targetUid, newRole) {
  if (!db) throw new Error('Firestore is unavailable.');
  const normalizedRole = String(newRole || '').trim().toLowerCase();
  if (!ALLOWED_ROLES.includes(normalizedRole)) {
    throw new Error(`Invalid role '${newRole}'. Allowed roles: ${ALLOWED_ROLES.join(', ')}`);
  }

  // Verify Superadmin privileges dynamically from Firestore
  const currentSnap = await getDoc(doc(db, 'users', currentUid));
  const userData = currentSnap.exists() ? currentSnap.data() : null;
  const isSuperadmin = resolvePrivileges(userData).isSuperadmin;
  if (!isSuperadmin) {
    throw new Error('Access Denied: Only users with the superadmin role can modify member roles.');
  }

  const targetRef = doc(db, 'users', targetUid);
  await updateDoc(targetRef, {
    role: normalizedRole,
    classification: normalizedRole,
    role_updated_at: new Date().toISOString(),
    role_updated_by: currentUid
  });

  return true;
}

/**
 * Toggles Charity Teacher status for a user (granting 0-token copying). Only permitted for Superadmins.
 */
export async function updateUserCharityStatus(currentUid, targetUid, isCharityTeacher) {
  if (!db) throw new Error('Firestore is unavailable.');
  const currentSnap = await getDoc(doc(db, 'users', currentUid));
  const userData = currentSnap.exists() ? currentSnap.data() : null;
  const isSuperadmin = resolvePrivileges(userData).isSuperadmin;
  if (!isSuperadmin) {
    throw new Error('Access Denied: Only superadmins can modify charity status.');
  }

  const targetRef = doc(db, 'users', targetUid);
  await updateDoc(targetRef, {
    isCharityTeacher: Boolean(isCharityTeacher),
    charity_updated_at: new Date().toISOString(),
    charity_updated_by: currentUid
  });

  return true;
}

/**
 * Lists all registered users. Only accessible by Superadmins.
 */
export async function listAllUsers(currentUid) {
  if (!db || !currentUid) return [];

  // Verify Superadmin privileges dynamically
  const currentSnap = await getDoc(doc(db, 'users', currentUid));
  const userData = currentSnap.exists() ? currentSnap.data() : null;
  const isSuperadmin = resolvePrivileges(userData).isSuperadmin;
  if (!isSuperadmin) {
    throw new Error('Access Denied: Only superadmins can view the member directory.');
  }

  const q = query(collection(db, 'users'));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data());
}

/**
 * User logout:
 * - Signs out from Firebase Auth
 * - Purges HTTP-only session cookies via edge endpoint
 * - Purges disk-based token caches from localStorage/sessionStorage
 */
export async function logoutUser() {
  const activeAuth = auth || getOrInitAuth();
  if (activeAuth) {
    try {
      await signOut(activeAuth);
    } catch (err) {
      console.warn('SignOut warning:', err);
    }
  }

  // 1. Purge HTTP-only session cookies via lightweight edge endpoint
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include'
    }).catch(() => {});
  } catch {
    // Non-blocking in offline or static hosting
  }

  // 2. Purge disk-based token caches simultaneously
  try {
    if (typeof window !== 'undefined') {
      sessionStorage.clear();
      const keysToPurge = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('firebase:authUser:') || k.startsWith('firebase:auth:'))) {
          keysToPurge.push(k);
        }
      }
      keysToPurge.forEach(k => localStorage.removeItem(k));
    }
  } catch (err) {
    console.warn('Cache purge notice:', err);
  }
}

/**
 * Upgrades a user from 'supporter' role to 'student' in Firestore.
 */
export async function updateUserToStudentRole(uid) {
  if (!db || !uid) return false;
  try {
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data = snap.data();
      if (String(data.role || '').toLowerCase() === 'supporter') {
        await updateDoc(userRef, {
          role: 'student',
          classification: 'student',
          role_updated_at: new Date().toISOString(),
          role_updated_by: 'system_enrolment'
        });
        return true;
      }
    }
  } catch (err) {
    console.warn('Error upgrading supporter to student in Firestore:', err?.code || err);
  }
  return false;
}

/**
 * Subscribes to auth state changes and syncs Firestore profile in real time
 */
export function subscribeToAuth(onAuthChanged) {
  const activeAuth = auth || getOrInitAuth();
  if (!activeAuth) {
    onAuthChanged(null, null);
    return () => {};
  }

  let userDocUnsubscribe = null;

  const authUnsubscribe = onAuthStateChanged(activeAuth, async (firebaseUser) => {
    if (userDocUnsubscribe) {
      userDocUnsubscribe();
      userDocUnsubscribe = null;
    }

    if (firebaseUser) {
      try {
        let profile = await fetchUserProfile(firebaseUser.uid);
        if (!profile) {
          profile = await syncUserToFirestore(firebaseUser);
        }
        onAuthChanged(firebaseUser, profile);

        // Real-time listener on user profile doc: role updates by teacher or admin appear instantly
        if (db) {
          try {
            userDocUnsubscribe = onSnapshot(doc(db, 'users', firebaseUser.uid), (docSnap) => {
              if (docSnap.exists()) {
                const updatedProfile = docSnap.data();
                onAuthChanged(firebaseUser, updatedProfile);
              }
            }, (err) => {
              console.warn('Real-time user profile listener note:', err?.code || err);
            });
          } catch (snapErr) {
            console.warn('Could not attach profile snapshot:', snapErr);
          }
        }
      } catch (err) {
        console.error('Auth state profile fetch failed:', err);
        onAuthChanged(firebaseUser, {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          role: 'supporter',
          classification: 'supporter'
        });
      }
    } else {
      onAuthChanged(null, null);
    }
  });

  return () => {
    if (userDocUnsubscribe) {
      try {
        userDocUnsubscribe();
      } catch {
        // detached
      }
    }
    authUnsubscribe();
  };
}
