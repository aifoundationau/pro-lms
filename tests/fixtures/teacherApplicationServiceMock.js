// Test stand-in for src/services/teacherApplicationService.js: applications are kept in
// globalThis.__TEST_APPLICATIONS__ (keyed by applicant uid). Validation, saving rules and price
// formatting are the real ones.
import { buildTeacherApplicationPayload } from '../../src/services/teacherApplicationService.js';

export {
  APPLICATION_TEXT_LIMITS,
  MAX_DOCUMENT_URL_CHARS,
  DEFAULT_PROPOSED_TOKEN_RATE,
  isValidDocumentUrl,
  validateDocumentUrl,
  normalizeProposedTokenRate,
  formatProposedTokenRate,
  buildTeacherApplicationPayload,
  isFirestoreSizeError
} from '../../src/services/teacherApplicationService.js';

function store() {
  globalThis.__TEST_APPLICATIONS__ ||= {};
  return globalThis.__TEST_APPLICATIONS__;
}

export async function submitTeacherApplication(applicationData) {
  const application = buildTeacherApplicationPayload(applicationData);
  store()[application.applicant_uid] = application;
  return application;
}

export async function getUserTeacherApplication(uid) {
  return store()[uid] || null;
}

export async function listAllTeacherApplications() {
  return Object.values(store());
}

export async function approveTeacherApplication() {
  throw new Error('Firestore is unavailable.');
}

export async function rejectTeacherApplication() {
  throw new Error('Firestore is unavailable.');
}
