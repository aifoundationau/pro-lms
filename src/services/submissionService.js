/**
 * Assessment Submission Service (Firestore collection: lms_coursework)
 *
 * - Students submit a written answer and/or a link for each assessment ("submission box").
 *   One document per student per assessment: `<courseId>__<assessmentId>__<uid>`; a student can
 *   resubmit until the teacher grades it.
 * - The course teacher (and staff) list submissions and record a grade and feedback.
 */

import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where, serverTimestamp, increment } from 'firebase/firestore';
import { db } from '../firebase.js';
import { isHttpUrl } from './courseSpreadsheetSchema.js';

export const SUBMISSIONS_COLLECTION = 'lms_coursework';
export const MAX_SUBMISSION_CHARS = 20000;
export const MAX_FEEDBACK_CHARS = 5000;

export function submissionDocId(courseId, assessmentId, uid) {
  return `${String(courseId)}__${String(assessmentId)}__${String(uid)}`;
}

function submissionError(message, code = 'SUBMISSION_FAILED') {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** Validates a student's submission (pure; exported for tests). */
export function validateSubmission({ text = '', linkUrl = '' }) {
  const answer = String(text || '').trim();
  const link = String(linkUrl || '').trim();
  if (!answer && !link) throw submissionError('Write an answer or add a link before submitting.', 'EMPTY_SUBMISSION');
  if (answer.length > MAX_SUBMISSION_CHARS) throw submissionError(`Answers can be up to ${MAX_SUBMISSION_CHARS.toLocaleString()} characters. Share longer work as a Google Drive link.`, 'TOO_LONG');
  if (link && !isHttpUrl(link)) throw submissionError('Links must start with https:// (e.g. a Google Drive or Docs share link).', 'INVALID_LINK');
  return { text: answer, linkUrl: link };
}

function toSubmission(snapshot) {
  const data = snapshot.data() || {};
  return {
    id: snapshot.id,
    ...data,
    submittedAtMs: data.submittedAt?.toMillis?.() || Date.parse(data.submittedAtIso || '') || 0,
    gradedAtMs: data.gradedAt?.toMillis?.() || Date.parse(data.gradedAtIso || '') || 0
  };
}

/**
 * Submission document fields (pure; the caller adds server timestamps and the attempt counter).
 * Shared by submitAssessment and the security-rules tests.
 */
export function buildSubmissionPayload({ course, assessment, unit, user, text, linkUrl, nowIso = new Date().toISOString() }) {
  const clean = validateSubmission({ text, linkUrl });
  return {
    courseId: String(course.id),
    courseTitle: String(course.title || '').slice(0, 300),
    teacherUid: String(course.authorId || ''),
    unitId: String(unit?.id || ''),
    unitTitle: String(unit?.unitTitle || '').slice(0, 300),
    assessmentId: String(assessment.id),
    assessmentTitle: String(assessment.title || '').slice(0, 300),
    studentUid: user.uid,
    studentEmail: String(user.email).toLowerCase(),
    studentName: String(user.displayName || user.email.split('@')[0]).slice(0, 120),
    text: clean.text,
    linkUrl: clean.linkUrl,
    status: 'submitted',
    submittedAtIso: nowIso,
    tag: 'lms'
  };
}

/** Student submits (or resubmits) an assessment. */
export async function submitAssessment({ course, assessment, unit, user, text, linkUrl }) {
  if (!db) throw submissionError('Submissions are unavailable right now (database offline).', 'DB_UNAVAILABLE');
  if (!user?.uid || !user?.email) throw submissionError('Please sign in to submit.', 'NOT_SIGNED_IN');
  if (!course?.id || !assessment?.id) throw submissionError('This assessment cannot accept submissions yet.', 'INVALID_ASSESSMENT');
  const fields = buildSubmissionPayload({ course, assessment, unit, user, text, linkUrl });

  const id = submissionDocId(course.id, assessment.id, user.uid);
  const ref = doc(db, SUBMISSIONS_COLLECTION, id);
  const existing = await getDoc(ref).catch(() => null);
  if (existing?.exists?.() && existing.data()?.status === 'graded') {
    throw submissionError('This assessment has already been graded. Message your teacher if you need to resubmit.', 'ALREADY_GRADED');
  }

  const payload = { ...fields, submittedAt: serverTimestamp(), attempts: increment(1) };
  try {
    await setDoc(ref, payload, { merge: true });
  } catch (err) {
    if (err?.code === 'permission-denied') {
      throw submissionError('You are not enrolled in this course with your sign-in email, so this submission was not accepted.', 'NOT_ENROLLED');
    }
    throw submissionError('Your submission could not be saved. Check your connection and try again.');
  }
  return { id, ...payload, attempts: (Number(existing?.data?.()?.attempts) || 0) + 1, submittedAtMs: Date.now() };
}

/** The signed-in student's submissions for a course, keyed by assessment id. */
export async function listMySubmissions(courseId, uid) {
  if (!db || !courseId || !uid) return {};
  try {
    const snap = await getDocs(query(collection(db, SUBMISSIONS_COLLECTION), where('studentUid', '==', uid), where('courseId', '==', String(courseId))));
    const byAssessment = {};
    snap.forEach(d => {
      const s = toSubmission(d);
      byAssessment[s.assessmentId] = s;
    });
    return byAssessment;
  } catch (err) {
    console.warn('Could not load your submissions:', err?.code || err);
    return {};
  }
}

/** All submissions for a course (teacher / staff view), newest first. */
export async function listCourseSubmissions(courseId) {
  if (!db || !courseId) return [];
  const snap = await getDocs(query(collection(db, SUBMISSIONS_COLLECTION), where('courseId', '==', String(courseId))));
  return snap.docs.map(toSubmission).sort((a, b) => b.submittedAtMs - a.submittedAtMs);
}

/** Teacher records a grade and feedback. */
export async function gradeSubmission({ submissionId, grade, feedback = '', grader }) {
  if (!db) throw submissionError('Grading is unavailable right now (database offline).', 'DB_UNAVAILABLE');
  const cleanGrade = String(grade || '').trim().slice(0, 60);
  if (!cleanGrade) throw submissionError('Enter a grade (e.g. 85%, Competent, HD).', 'EMPTY_GRADE');
  const cleanFeedback = String(feedback || '').trim().slice(0, MAX_FEEDBACK_CHARS);
  const nowIso = new Date().toISOString();
  const update = {
    status: 'graded',
    grade: cleanGrade,
    feedback: cleanFeedback,
    gradedByUid: String(grader?.uid || ''),
    gradedByName: String(grader?.displayName || grader?.email || 'Teacher').slice(0, 120),
    gradedAt: serverTimestamp(),
    gradedAtIso: nowIso
  };
  try {
    await updateDoc(doc(db, SUBMISSIONS_COLLECTION, String(submissionId)), update);
  } catch (err) {
    if (err?.code === 'permission-denied') throw submissionError('Only the course teacher can grade this submission.', 'NOT_ALLOWED');
    throw submissionError('The grade could not be saved. Check your connection and try again.');
  }
  return { ...update, gradedAtMs: Date.now() };
}
