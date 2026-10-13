// Test stand-in for src/services/authService.js: the signed-in user comes from
// globalThis.__TEST_AUTH__ = { user, profile }. Role logic is the real one.
export { ALLOWED_ROLES, resolvePrivileges } from '../../src/services/rolePrivileges.js';

export const OAUTH_CLIENT_ID = 'test-client-id';

export function subscribeToAuth(onAuthChanged) {
  const state = globalThis.__TEST_AUTH__ || {};
  queueMicrotask(() => onAuthChanged(state.user || null, state.profile || null));
  return () => {};
}

export async function handleAuthRedirect() {
  return null;
}

export async function signInWithGoogle() {
  const state = globalThis.__TEST_AUTH__ || {};
  return { user: state.user || null, profile: state.profile || null };
}

export async function logoutUser() {}

export async function fetchUserProfile() {
  return (globalThis.__TEST_AUTH__ || {}).profile || null;
}

export async function syncUserToFirestore(user) {
  return { uid: user?.uid, email: user?.email, role: 'Supporter', classification: 'Supporter' };
}

export async function updateMemberRole() {
  throw new Error('Firestore is unavailable.');
}

export async function updateUserCharityStatus() {
  throw new Error('Firestore is unavailable.');
}

export async function listAllUsers() {
  return [];
}
