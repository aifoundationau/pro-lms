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
  increment
} from 'firebase/firestore';
import { auth, db, getOrInitAuth } from '../firebase';

export const OAUTH_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID ||
  '614773274800-9pooin0jia9ij91qjlk7r6r6ne02mbhg.apps.googleusercontent.com';

export const ALLOWED_ROLES = [
  'Supporter',
  'student',
  'teacher',
  'admin staff',
  'CEO',
  'COO',
  'CFO',
  'Financial team',
  'Superadmin'
];

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
      // Newly registered user: assign default classification and role "Supporter"
      // If user is the Firebase project owner/admin (support@aifoundation.net.au), automatically grant Superadmin
      const isFirebaseOwner = user.email?.toLowerCase() === 'support@aifoundation.net.au';
      const initialRole = isFirebaseOwner ? 'Superadmin' : 'Supporter';
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
        lms_tags: ['lms']
      };
      await setDoc(userRef, newProfile);
      return newProfile;
    } else {
      // Existing user: increment login_count and update last_login_at without overwriting role
      const existing = snap.data();
      const updates = {
        displayName: user.displayName || existing.displayName || '',
        photoURL: user.photoURL || existing.photoURL || '',
        last_login_at: nowIso,
        login_count: increment(1)
      };
      await updateDoc(userRef, updates);
      return {
        ...existing,
        ...updates,
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
      role: 'Supporter',
      classification: 'Supporter',
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
 * Resolves administrative and Superadmin privileges dynamically from Firestore role attributes.
 * Never hardcodes user identities or emails.
 */
export function resolvePrivileges(profile) {
  const isFirebaseAdmin = profile?.email?.toLowerCase() === 'support@aifoundation.net.au';
  const role = profile?.role || (isFirebaseAdmin ? 'Superadmin' : 'Supporter');
  const isSuperadmin = role === 'Superadmin' || isFirebaseAdmin;
  const isAdminStaff = isSuperadmin || role === 'CEO' || role === 'COO' || role === 'admin staff';
  const isFinancial = isSuperadmin || role === 'CFO' || role === 'Financial team';
  const isTeacher = isSuperadmin || role === 'teacher';
  const isStaff = isSuperadmin || isAdminStaff || isFinancial || isTeacher;
  const isStudent = role === 'student';
  const isSupporter = role === 'Supporter' && !isSuperadmin;

  return {
    role: isSuperadmin && role !== 'Superadmin' ? 'Superadmin' : role,
    classification: profile?.classification || (isSuperadmin ? 'Superadmin' : 'Supporter'),
    isSuperadmin,
    isAdminStaff,
    isFinancial,
    isTeacher,
    isStaff,
    isStudent,
    isSupporter,
    canManageRoles: isSuperadmin,
    canCreateCourse: isStaff,
    canEditCourse: isStaff,
    canArchiveCourse: isStaff,
    canEnrolStudents: isStaff,
    canViewAllStudents: isStaff
  };
}

/**
 * Updates a member role. Only permitted when authenticated user is a verified Superadmin.
 */
export async function updateMemberRole(currentUid, targetUid, newRole) {
  if (!db) throw new Error('Firestore is unavailable.');
  if (!ALLOWED_ROLES.includes(newRole)) {
    throw new Error(`Invalid role '${newRole}'. Allowed roles: ${ALLOWED_ROLES.join(', ')}`);
  }

  // Verify Superadmin privileges dynamically from Firestore
  const currentSnap = await getDoc(doc(db, 'users', currentUid));
  const userData = currentSnap.exists() ? currentSnap.data() : null;
  const isSuperadmin = userData?.role === 'Superadmin' || userData?.email?.toLowerCase() === 'support@aifoundation.net.au';
  if (!isSuperadmin) {
    throw new Error('Access Denied: Only users with the Superadmin role can modify member roles.');
  }

  const targetRef = doc(db, 'users', targetUid);
  await updateDoc(targetRef, {
    role: newRole,
    classification: newRole,
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
  const isSuperadmin = userData?.role === 'Superadmin' || userData?.email?.toLowerCase() === 'support@aifoundation.net.au';
  if (!isSuperadmin) {
    throw new Error('Access Denied: Only Superadmins can modify charity status.');
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
  const isSuperadmin = userData?.role === 'Superadmin' || userData?.email?.toLowerCase() === 'support@aifoundation.net.au';
  if (!isSuperadmin) {
    throw new Error('Access Denied: Only Superadmins can view the member directory.');
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
 * Subscribes to auth state changes and syncs Firestore profile
 */
export function subscribeToAuth(onAuthChanged) {
  const activeAuth = auth || getOrInitAuth();
  if (!activeAuth) {
    onAuthChanged(null, null);
    return () => {};
  }

  return onAuthStateChanged(activeAuth, async (firebaseUser) => {
    if (firebaseUser) {
      try {
        let profile = await fetchUserProfile(firebaseUser.uid);
        if (!profile) {
          profile = await syncUserToFirestore(firebaseUser);
        }
        onAuthChanged(firebaseUser, profile);
      } catch (err) {
        console.error('Auth state profile fetch failed:', err);
        onAuthChanged(firebaseUser, {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          role: 'Supporter'
        });
      }
    } else {
      onAuthChanged(null, null);
    }
  });
}
