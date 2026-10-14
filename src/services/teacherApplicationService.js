/**
 * Teacher Postcard Application & Approval Service for Pro-LMS
 * Manages applicant submission with AI-extracted ID data and Super Admin evaluation
 */

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { sanitizeIdVerification } from './idVerificationService.js';

/**
 * The ID photo is never stored (it is only sent to Gemini for the check). Applicants give a web link
 * to their original document instead, which keeps each application far below Firestore's 1 MiB limit.
 */
export const APPLICATION_TEXT_LIMITS = Object.freeze({
  applicant_name: 200,
  subject_specialty: 200,
  proposed_course_title: 300,
  teaching_bio: 8000,
  postal_address_text: 500
});
export const MAX_DOCUMENT_URL_CHARS = 2000;

/** Proposed course price used when none is given (the application form starts at 10 tokens). */
export const DEFAULT_PROPOSED_TOKEN_RATE = 10;

/** Whole tokens (0 or more), or null for a blank, negative or non-numeric value. */
function wholeTokens(value) {
  if (value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/** The proposed course price to store: 0 means FREE and stays 0; unusable values become 10. */
export function normalizeProposedTokenRate(value) {
  return wholeTokens(value) ?? DEFAULT_PROPOSED_TOKEN_RATE;
}

/** How a proposed price reads: "FREE" for 0 tokens, otherwise "🪙 N Tokens" ('' when none was recorded). */
export function formatProposedTokenRate(value) {
  const tokens = wholeTokens(value);
  if (tokens === null) return '';
  if (tokens === 0) return 'FREE';
  return `🪙 ${tokens} ${tokens === 1 ? 'Token' : 'Tokens'}`;
}

function applicationError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** True for an https:// web address (the link to the applicant's original ID document). */
export function isValidDocumentUrl(value) {
  const s = String(value ?? '').trim();
  if (!s || s.length > MAX_DOCUMENT_URL_CHARS || /\s/.test(s)) return false;
  try {
    const url = new URL(s);
    return url.protocol === 'https:' && Boolean(url.hostname) && url.hostname.includes('.');
  } catch {
    return false;
  }
}

/** '' (no link) or a valid https:// link; anything else is refused with a clear message. */
export function validateDocumentUrl(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  if (!isValidDocumentUrl(s)) {
    throw applicationError('The document link must be a web address starting with https:// — for example a Google Drive, OneDrive or Dropbox share link.', 'ID_DOCUMENT_URL_INVALID');
  }
  return s;
}

/** Validated Firestore document for /teacher_applications/app_<uid>. */
export function buildTeacherApplicationPayload(applicationData, nowIso = new Date().toISOString()) {
  const data = applicationData || {};
  if (!data.applicant_uid) throw new Error('Applicant UID is required.');
  const textOf = (key, fallback = '') => String(data[key] ?? '').trim().slice(0, APPLICATION_TEXT_LIMITS[key]) || fallback;
  const applicationId = `app_${data.applicant_uid}`;
  return {
    id: applicationId,
    applicant_uid: data.applicant_uid,
    applicant_name: textOf('applicant_name', 'Applicant'),
    applicant_email: String(data.applicant_email || '').trim().slice(0, 320),
    subject_specialty: textOf('subject_specialty'),
    teaching_bio: textOf('teaching_bio'),
    proposed_course_title: textOf('proposed_course_title'),
    proposed_token_rate: normalizeProposedTokenRate(data.proposed_token_rate),
    postal_address_text: textOf('postal_address_text', 'OzEdu Academic Registry, Sydney NSW'),
    id_document_url: validateDocumentUrl(data.id_document_url),
    ai_id_verification: sanitizeIdVerification(data.ai_id_verification),
    status: 'pending', // 'pending' | 'approved' | 'rejected'
    submitted_at: nowIso,
    updated_at: nowIso,
    tag: 'lms'
  };
}

/** Firestore's "value is longer than … bytes" / "document exceeds the maximum allowed size" errors. */
export function isFirestoreSizeError(err) {
  return /longer than \d+ bytes|exceeds the maximum allowed size|maximum.*size.*document/i.test(String(err?.message || ''));
}

/**
 * Submits a new Teacher Application with Postcard details and AI-extracted ID data
 */
export async function submitTeacherApplication(applicationData) {
  if (!db) throw new Error('Database is unavailable.');
  const nowIso = new Date().toISOString();
  const payload = buildTeacherApplicationPayload(applicationData, nowIso);
  const applicationId = payload.id;
  const appRef = doc(db, 'teacher_applications', applicationId);

  try {
    await setDoc(appRef, payload, { merge: true });
  } catch (err) {
    if (isFirestoreSizeError(err)) {
      throw applicationError('Your application is too large to save. Please shorten the text and try again.', 'APPLICATION_TOO_LARGE');
    }
    throw err;
  }

  // Update user profile in /users/{uid} to track pending application state
  const userRef = doc(db, 'users', applicationData.applicant_uid);
  await updateDoc(userRef, {
    teacher_application_status: 'pending',
    teacher_application_id: applicationId,
    teacher_application_submitted_at: nowIso
  }).catch(err => console.warn('Could not update user record with application status:', err));

  return payload;
}

/**
 * Loads the current user's teacher application if already submitted
 */
export async function getUserTeacherApplication(uid) {
  if (!db || !uid) return null;
  try {
    const applicationId = `app_${uid}`;
    const appRef = doc(db, 'teacher_applications', applicationId);
    const snap = await getDoc(appRef);
    if (snap.exists()) {
      return snap.data();
    }
  } catch (err) {
    console.warn('Error fetching teacher application for user:', err);
  }
  return null;
}

/**
 * Lists all pending and processed teacher applications for Super Admin review
 */
export async function listAllTeacherApplications(adminUid) {
  if (!db) return [];
  try {
    const appsRef = collection(db, 'teacher_applications');
    const snap = await getDocs(appsRef);
    const list = [];
    snap.forEach(d => list.push(d.data()));
    // Sort newest first
    return list.sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0));
  } catch (err) {
    console.warn('Error loading teacher applications:', err);
    return [];
  }
}

/**
 * Super Admin approves a teacher application and elevates the user's role to 'teacher'
 */
export async function approveTeacherApplication(adminUid, applicationId, applicantUid) {
  if (!db) throw new Error('Database is unavailable.');
  const nowIso = new Date().toISOString();

  // 1. Update application status
  const appRef = doc(db, 'teacher_applications', applicationId);
  await updateDoc(appRef, {
    status: 'approved',
    reviewed_by: adminUid,
    reviewed_at: nowIso
  });

  // 2. Elevate user role to 'teacher'
  const userRef = doc(db, 'users', applicantUid);
  await updateDoc(userRef, {
    role: 'teacher',
    classification: 'teacher',
    teacher_application_status: 'approved',
    role_elevated_at: nowIso,
    role_elevated_by: adminUid
  });

  return true;
}

/**
 * Super Admin rejects a teacher application with feedback
 */
export async function rejectTeacherApplication(adminUid, applicationId, applicantUid, reason = '') {
  if (!db) throw new Error('Database is unavailable.');
  const nowIso = new Date().toISOString();

  const appRef = doc(db, 'teacher_applications', applicationId);
  await updateDoc(appRef, {
    status: 'rejected',
    rejection_reason: reason || 'Application requires additional credentials or documentation.',
    reviewed_by: adminUid,
    reviewed_at: nowIso
  });

  const userRef = doc(db, 'users', applicantUid);
  await updateDoc(userRef, {
    teacher_application_status: 'rejected'
  }).catch(() => {});

  return true;
}
