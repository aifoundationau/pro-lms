// Offline Firebase stand-in for UI tests: every service runs its "database unavailable" path.
export const firebaseConfig = {};
export const app = null;
export const analytics = null;
export const db = null;
export const auth = null;
export function getOrInitAuth() {
  return null;
}
