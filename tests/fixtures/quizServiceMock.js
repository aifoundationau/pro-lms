// Stand-in for src/services/quizService.js in UI tests: data comes from globalThis.__TEST_QUIZ__,
// and releaseQuizResults marks attempts with the real quiz model (no Firestore).
import { buildQuizResultUpdate, normalizeQuiz } from '../../src/services/quizModel.js';

export const QUIZ_ATTEMPTS_COLLECTION = 'lms_quiz_attempts';
export const QUIZ_KEYS_COLLECTION = 'lms_quiz_keys';

const state = () => {
  if (!globalThis.__TEST_QUIZ__) globalThis.__TEST_QUIZ__ = {};
  return globalThis.__TEST_QUIZ__;
};

export async function loadQuizAnswerKeys() {
  return { keys: state().keys || {}, ok: true };
}

export async function listCourseQuizAttempts() {
  return (state().attempts || []).map(a => ({ ...a }));
}

export async function listMyQuizAttempts() {
  return state().myAttempts || {};
}

export async function submitQuizAttempt(args) {
  state().submitted = args;
  return { id: 'attempt-1', status: 'submitted', answers: args.answers, submittedAtMs: Date.now() };
}

export async function releaseQuizResults({ quiz, attempts, manualScoresByAttempt = {}, feedbackByAttempt = {}, grader }) {
  state().releaseCalls = (state().releaseCalls || 0) + 1;
  const released = [];
  const skipped = [];
  for (const attempt of attempts) {
    try {
      released.push({
        id: attempt.id,
        update: buildQuizResultUpdate({
          quiz: normalizeQuiz(quiz),
          attempt,
          manualScores: manualScoresByAttempt[attempt.id] || {},
          feedback: feedbackByAttempt[attempt.id] || '',
          grader
        })
      });
    } catch (err) {
      skipped.push({ id: attempt.id, reason: err.message });
    }
  }
  state().released = released;
  return { released, skipped, failed: [] };
}
