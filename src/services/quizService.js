/**
 * Unit quiz storage (Firestore):
 * - /lms_quiz_keys/<courseId>                   answer keys (staff only; written with the course)
 * - /lms_quiz_attempts/<courseId>__<quizId>__<uid> one attempt per student per quiz; the student
 *   can resubmit until the teacher releases results, then it is locked.
 * Teachers mark in bulk: closed questions automatically, open answers by hand, then release all.
 */

import { collection, doc, getDoc, getDocs, query, setDoc, where, writeBatch, serverTimestamp, increment } from 'firebase/firestore';
import { db } from '../firebase.js';
import { buildQuizAttemptPayload, buildQuizResultUpdate, quizAttemptDocId, normalizeQuiz } from './quizModel.js';

export const QUIZ_ATTEMPTS_COLLECTION = 'lms_quiz_attempts';
export const QUIZ_KEYS_COLLECTION = 'lms_quiz_keys';
const BATCH_SIZE = 400;

function quizError(message, code = 'QUIZ_FAILED') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function toAttempt(snapshot) {
  const data = snapshot.data() || {};
  return {
    id: snapshot.id,
    ...data,
    submittedAtMs: data.submittedAt?.toMillis?.() || Date.parse(data.submittedAtIso || '') || 0,
    gradedAtMs: data.gradedAt?.toMillis?.() || Date.parse(data.gradedAtIso || '') || 0
  };
}

/**
 * Answer keys for a course (teachers and staff only).
 * @returns {Promise<{ keys: object, ok: boolean, error?: string }>} never rejects
 */
export async function loadQuizAnswerKeys(courseId) {
  if (!db || !courseId) return { keys: {}, ok: false, error: 'offline' };
  try {
    const snap = await getDoc(doc(db, QUIZ_KEYS_COLLECTION, String(courseId)));
    const quizzes = snap.exists() ? snap.data()?.quizzes : null;
    return { keys: quizzes && typeof quizzes === 'object' ? quizzes : {}, ok: true };
  } catch (err) {
    console.warn('Quiz answer keys could not be loaded:', err?.code || err);
    return { keys: {}, ok: false, error: err?.code || 'unavailable' };
  }
}

/** Student submits (or resubmits, until results are released) a quiz attempt. */
export async function submitQuizAttempt({ course, unit, lesson, block, user, answers }) {
  if (!db) throw quizError('Quizzes are unavailable right now (database offline).', 'DB_UNAVAILABLE');
  const fields = buildQuizAttemptPayload({ course, unit, lesson, block, user, answers });
  const id = quizAttemptDocId(course.id, block.id, user.uid);
  const ref = doc(db, QUIZ_ATTEMPTS_COLLECTION, id);
  const existing = await getDoc(ref).catch(() => null);
  if (existing?.exists?.() && existing.data()?.status === 'graded') {
    throw quizError('Your teacher has already released results for this quiz.', 'ALREADY_GRADED');
  }
  const payload = { ...fields, submittedAt: serverTimestamp(), attempts: increment(1) };
  try {
    await setDoc(ref, payload, { merge: true });
  } catch (err) {
    if (err?.code === 'permission-denied') {
      throw quizError('You are not enrolled in this course with your sign-in email, so this quiz was not accepted.', 'NOT_ENROLLED');
    }
    throw quizError('Your answers could not be saved. Check your connection and try again.');
  }
  return { id, ...fields, attempts: (Number(existing?.data?.()?.attempts) || 0) + 1, submittedAtMs: Date.now() };
}

/** The signed-in student's quiz attempts for a course, keyed by quiz id. Never rejects. */
export async function listMyQuizAttempts(courseId, uid) {
  if (!db || !courseId || !uid) return {};
  try {
    const snap = await getDocs(query(collection(db, QUIZ_ATTEMPTS_COLLECTION), where('studentUid', '==', uid), where('courseId', '==', String(courseId))));
    const byQuiz = {};
    snap.forEach(d => {
      const attempt = toAttempt(d);
      byQuiz[attempt.quizId] = attempt;
    });
    return byQuiz;
  } catch (err) {
    console.warn('Could not load your quiz attempts:', err?.code || err);
    return {};
  }
}

/** Every attempt for a course (teacher / staff view), newest first. */
export async function listCourseQuizAttempts(courseId) {
  if (!db || !courseId) return [];
  const snap = await getDocs(query(collection(db, QUIZ_ATTEMPTS_COLLECTION), where('courseId', '==', String(courseId))));
  return snap.docs.map(toAttempt).sort((a, b) => b.submittedAtMs - a.submittedAtMs);
}

/**
 * Bulk release: marks every given attempt (closed questions automatically, open ones with the
 * teacher's scores) and saves the results in batches. Attempts that still need marking are skipped.
 * @param {object} quiz the teacher's quiz, including answer keys
 * @returns {Promise<{ released: Array<{ id: string, update: object }>, skipped: Array<{ id: string, reason: string }>, failed: string[] }>}
 */
export async function releaseQuizResults({ quiz, attempts, manualScoresByAttempt = {}, feedbackByAttempt = {}, grader }) {
  if (!db) throw quizError('Releasing results is unavailable right now (database offline).', 'DB_UNAVAILABLE');
  const cleanQuiz = normalizeQuiz(quiz);
  const nowIso = new Date().toISOString();
  const ready = [];
  const skipped = [];
  for (const attempt of Array.isArray(attempts) ? attempts : []) {
    if (!attempt?.id) continue;
    try {
      const update = buildQuizResultUpdate({
        quiz: cleanQuiz,
        attempt,
        manualScores: manualScoresByAttempt[attempt.id] || {},
        feedback: feedbackByAttempt[attempt.id] || '',
        grader,
        nowIso
      });
      ready.push({ id: attempt.id, update });
    } catch (err) {
      skipped.push({ id: attempt.id, reason: err.message });
    }
  }

  const released = [];
  const failed = [];
  for (let i = 0; i < ready.length; i += BATCH_SIZE) {
    const chunk = ready.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    for (const item of chunk) {
      batch.update(doc(db, QUIZ_ATTEMPTS_COLLECTION, item.id), { ...item.update, gradedAt: serverTimestamp() });
    }
    try {
      await batch.commit();
      released.push(...chunk);
    } catch (err) {
      console.warn('Quiz results batch failed:', err?.code || err);
      failed.push(...chunk.map(item => item.id));
    }
  }
  return { released, skipped, failed };
}
