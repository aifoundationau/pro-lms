/**
 * Import this FIRST in Node unit tests. It switches Firebase off (see src/firebase.js), so a unit
 * test can never read or write the live project; services take their offline paths instead.
 * Database behaviour is tested against the emulator copy: npm run test:e2e and npm run test:rules.
 */
process.env.OZEDU_FIREBASE_OFFLINE = '1';
