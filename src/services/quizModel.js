/**
 * Unit quizzes ("Quiz & Questions" blocks): pure model (no Firebase, no DOM).
 *
 * - Question types: multiple choice, true/false, short answer (closed: marked automatically against
 *   the answer key) and open questions (marked by the teacher).
 * - Answer keys (correct options, accepted answers, model answers) never travel with the course:
 *   every signed-in user can read course documents, so keys are split off into the staff-only
 *   lms_quiz_keys collection and merged back only for teachers.
 * - Marking: scoreQuizAttempt() marks closed questions and applies the teacher's scores for open
 *   ones; buildQuizResultUpdate() produces the "released results" written to the attempt.
 */

import { QUIZ_QUESTION_TYPES, QUIZ_KEY_FIELDS, QUIZ_LIMITS, generateEntityId } from '../types/courseBuilderTypes.js';

const TYPE_SET = new Set(QUIZ_QUESTION_TYPES.map(t => t.type));
export const CLOSED_QUESTION_TYPES = new Set(QUIZ_QUESTION_TYPES.filter(t => t.closed).map(t => t.type));
export const MAX_QUIZ_FEEDBACK_CHARS = 5000;

function str(value, max) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, max) : '';
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clampPoints(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(QUIZ_LIMITS.points, Math.max(0, Math.round(n * 100) / 100));
}

export function isQuizBlock(block) {
  return isObject(block) && block.type === 'quiz';
}

export function questionTypeLabel(type) {
  return QUIZ_QUESTION_TYPES.find(t => t.type === type)?.label || 'Question';
}

/** Every quiz block in a course, in order: [{ unit, lesson, block, unitIndex, lessonIndex }]. */
export function listCourseQuizzes(course) {
  const found = [];
  list(course?.units).forEach((unit, unitIndex) => {
    list(unit?.lessons).forEach((lesson, lessonIndex) => {
      for (const block of list(lesson?.blocks)) {
        if (isQuizBlock(block)) found.push({ unit, lesson, block, unitIndex, lessonIndex });
      }
    });
  });
  return found;
}

/** A bounded, typed question. Answer-key fields are kept only when the input has them. */
export function normalizeQuizQuestion(raw) {
  const source = isObject(raw) ? raw : {};
  const type = TYPE_SET.has(source.type) ? source.type : 'open';
  const question = {
    id: str(source.id, 80) || generateEntityId('q'),
    type,
    prompt: str(source.prompt, QUIZ_LIMITS.prompt),
    points: clampPoints(source.points, type === 'open' ? 5 : 1)
  };
  if (type === 'multiple_choice') {
    question.options = list(source.options).slice(0, QUIZ_LIMITS.options).map(option => ({
      id: str(option?.id, 80) || generateEntityId('opt'),
      text: str(typeof option === 'string' ? option : option?.text, QUIZ_LIMITS.option)
    }));
    question.allowMultiple = Boolean(source.allowMultiple);
    if ('correctOptionIds' in source) {
      const ids = new Set(question.options.map(o => o.id));
      question.correctOptionIds = Array.from(new Set(list(source.correctOptionIds).map(String))).filter(id => ids.has(id));
    }
  } else if (type === 'true_false') {
    if (typeof source.correctAnswer === 'boolean') question.correctAnswer = source.correctAnswer;
  } else if (type === 'short_answer') {
    if ('acceptedAnswers' in source) {
      question.acceptedAnswers = list(source.acceptedAnswers).map(a => str(a, QUIZ_LIMITS.option).trim()).filter(Boolean).slice(0, 20);
    }
  } else if ('modelAnswer' in source) {
    question.modelAnswer = str(source.modelAnswer, QUIZ_LIMITS.answer);
  }
  return question;
}

export function normalizeQuiz(quiz) {
  const source = isObject(quiz) ? quiz : {};
  return {
    instructions: str(source.instructions, 5000),
    questions: list(source.questions).filter(isObject).slice(0, QUIZ_LIMITS.questions).map(normalizeQuizQuestion)
  };
}

/** The question without its answer key (what students receive). */
export function publicQuestion(question) {
  const out = { ...question };
  for (const key of QUIZ_KEY_FIELDS) delete out[key];
  return out;
}

function mapQuizBlocks(course, transform) {
  if (!isObject(course) || !Array.isArray(course.units)) return course;
  let changed = false;
  const units = course.units.map(unit => {
    if (!isObject(unit) || !Array.isArray(unit.lessons)) return unit;
    let unitChanged = false;
    const lessons = unit.lessons.map(lesson => {
      if (!isObject(lesson) || !Array.isArray(lesson.blocks)) return lesson;
      let lessonChanged = false;
      const blocks = lesson.blocks.map(block => {
        if (!isQuizBlock(block)) return block;
        const next = transform(block);
        if (next !== block) lessonChanged = true;
        return next;
      });
      if (!lessonChanged) return lesson;
      unitChanged = true;
      return { ...lesson, blocks };
    });
    if (!unitChanged) return unit;
    changed = true;
    return { ...unit, lessons };
  });
  return changed ? { ...course, units } : course;
}

/** The course with every quiz answer key removed — what is stored in lms_courses and shown to students. */
export function stripQuizAnswerKeys(course) {
  return mapQuizBlocks(course, block => {
    const questions = list(block.quiz?.questions);
    if (!questions.some(q => isObject(q) && QUIZ_KEY_FIELDS.some(k => k in q))) return block;
    return { ...block, quiz: { ...block.quiz, questions: questions.map(q => (isObject(q) ? publicQuestion(q) : q)) } };
  });
}

/** { [quizBlockId]: { [questionId]: { ...answer key fields } } } for every question that has a key. */
export function extractQuizAnswerKeys(course) {
  const keys = {};
  for (const { block } of listCourseQuizzes(course)) {
    const quizId = str(block.id, 120);
    if (!quizId) continue;
    for (const q of list(block.quiz?.questions)) {
      if (!isObject(q) || !q.id) continue;
      const entry = {};
      for (const field of QUIZ_KEY_FIELDS) {
        if (q[field] !== undefined) entry[field] = q[field];
      }
      if (!Object.keys(entry).length) continue;
      if (!keys[quizId]) keys[quizId] = {};
      keys[quizId][String(q.id)] = JSON.parse(JSON.stringify(entry));
    }
  }
  return keys;
}

/** Puts answer keys back into a (teacher's) course. Fields already present on a question are kept. */
export function mergeQuizAnswerKeys(course, keys) {
  if (!isObject(keys) || !Object.keys(keys).length) return course;
  return mapQuizBlocks(course, block => {
    const quizKeys = keys[block.id];
    if (!isObject(quizKeys)) return block;
    let changed = false;
    const questions = list(block.quiz?.questions).map(q => {
      const entry = isObject(q) ? quizKeys[q.id] : null;
      if (!isObject(entry)) return q;
      const next = { ...q };
      for (const field of QUIZ_KEY_FIELDS) {
        if (next[field] === undefined && entry[field] !== undefined) {
          next[field] = entry[field];
          changed = true;
        }
      }
      return next;
    });
    return changed ? { ...block, quiz: { ...block.quiz, questions } } : block;
  });
}

/** Re-keys answer keys after quiz blocks get new ids (e.g. a unit imported from another course). */
export function remapQuizAnswerKeys(keys, idMap) {
  const out = {};
  for (const [oldId, entry] of Object.entries(isObject(keys) ? keys : {})) {
    if (idMap[oldId]) out[idMap[oldId]] = entry;
  }
  return out;
}

/** Firestore document for /lms_quiz_keys/<courseId>. */
export function buildQuizKeysDoc(courseId, keys) {
  return { courseId: String(courseId), quizzes: keys, tag: 'lms' };
}

// ---------- answers & marking ----------

export function normalizeAnswerText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?;:,]+$/, '');
}

/** Student answers cleaned against the quiz: known questions only, typed per question. */
export function cleanQuizAnswers(quiz, answers) {
  const source = isObject(answers) ? answers : {};
  const clean = {};
  for (const q of list(quiz?.questions)) {
    if (!isObject(q) || !(q.id in source)) continue;
    const value = source[q.id];
    if (q.type === 'multiple_choice') {
      const ids = new Set(list(q.options).map(o => o.id));
      const picked = Array.from(new Set(list(value).map(String))).filter(id => ids.has(id));
      const kept = q.allowMultiple ? picked : picked.slice(0, 1);
      if (kept.length) clean[q.id] = kept;
    } else if (q.type === 'true_false') {
      if (typeof value === 'boolean') clean[q.id] = value;
    } else {
      const text = String(value ?? '').trim().slice(0, QUIZ_LIMITS.answer);
      if (text) clean[q.id] = text;
    }
  }
  return clean;
}

export function countAnswered(quiz, answers) {
  const clean = cleanQuizAnswers(quiz, answers);
  return list(quiz?.questions).filter(q => isObject(q) && q.id in clean).length;
}

function sameSet(a, b) {
  const x = new Set(list(a).map(String));
  const y = new Set(list(b).map(String));
  return x.size === y.size && [...x].every(v => y.has(v));
}

/**
 * Marks one attempt. Closed questions are checked against the answer key; open questions (and
 * closed ones without a key) take the teacher's score from `manualScores`. A manual score also
 * overrides an automatic mark (e.g. a spelling variant of a short answer).
 * @returns {{ results: Array<{ questionId, type, points, earned, correct, needsMarking, overridden }>,
 *   score: number, maxScore: number, percent: number, pending: number, autoMarked: number }}
 */
export function scoreQuizAttempt(quiz, answers, manualScores = {}) {
  const given = cleanQuizAnswers(quiz, answers);
  const manual = isObject(manualScores) ? manualScores : {};
  const results = [];
  for (const q of list(quiz?.questions)) {
    if (!isObject(q) || !q.id) continue;
    const points = clampPoints(q.points, q.type === 'open' ? 5 : 1);
    const answered = q.id in given;
    const answer = given[q.id];
    const manualValue = manual[q.id];
    const result = { questionId: q.id, type: q.type, points, earned: 0, correct: null, needsMarking: false, overridden: false };

    let autoCorrect = null; // null = cannot be marked automatically
    if (q.type === 'multiple_choice' && list(q.correctOptionIds).length) autoCorrect = answered && sameSet(answer, q.correctOptionIds);
    else if (q.type === 'true_false' && typeof q.correctAnswer === 'boolean') autoCorrect = answered && answer === q.correctAnswer;
    else if (q.type === 'short_answer' && list(q.acceptedAnswers).length) {
      const typed = normalizeAnswerText(answer);
      autoCorrect = answered && q.acceptedAnswers.some(a => normalizeAnswerText(a) === typed);
    }

    if (typeof manualValue === 'number' && Number.isFinite(manualValue)) {
      result.earned = Math.min(points, Math.max(0, manualValue));
      result.correct = result.earned >= points && points > 0;
      result.overridden = autoCorrect !== null;
    } else if (autoCorrect !== null) {
      result.correct = autoCorrect;
      result.earned = autoCorrect ? points : 0;
    } else if (answered) {
      result.needsMarking = true; // open answer (or no answer key yet): the teacher marks it
    } else {
      result.correct = false; // unanswered: nothing to mark
    }
    results.push(result);
  }
  const maxScore = results.reduce((sum, r) => sum + r.points, 0);
  const score = Math.round(results.reduce((sum, r) => sum + r.earned, 0) * 100) / 100;
  return {
    results,
    score,
    maxScore,
    percent: maxScore ? Math.round((score / maxScore) * 100) : 0,
    pending: results.filter(r => r.needsMarking).length,
    autoMarked: results.filter(r => r.correct !== null && !r.overridden && !r.needsMarking && CLOSED_QUESTION_TYPES.has(r.type)).length
  };
}

export function quizAttemptDocId(courseId, quizId, uid) {
  return `${String(courseId)}__${String(quizId)}__${String(uid)}`;
}

function quizError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** Attempt fields a student writes (no marks; the caller adds server timestamps and attempt count). */
export function buildQuizAttemptPayload({ course, unit, lesson, block, user, answers, nowIso = new Date().toISOString() }) {
  if (!user?.uid || !user?.email) throw quizError('Please sign in to submit the quiz.', 'NOT_SIGNED_IN');
  if (!course?.id || !isQuizBlock(block)) throw quizError('This quiz cannot accept answers yet.', 'INVALID_QUIZ');
  const quiz = normalizeQuiz(block.quiz);
  if (!quiz.questions.length) throw quizError('This quiz has no questions yet.', 'EMPTY_QUIZ');
  const clean = cleanQuizAnswers(quiz, answers);
  if (!Object.keys(clean).length) throw quizError('Answer at least one question before submitting.', 'EMPTY_ATTEMPT');
  return {
    courseId: String(course.id),
    courseTitle: str(course.title, 300),
    teacherUid: str(course.authorId, 200),
    unitId: str(unit?.id, 120),
    unitTitle: str(unit?.unitTitle, 300),
    lessonId: str(lesson?.id, 120),
    lessonTitle: str(lesson?.title, 300),
    quizId: String(block.id),
    quizTitle: str(block.title, 300) || 'Quiz',
    studentUid: user.uid,
    studentEmail: String(user.email).toLowerCase(),
    studentName: str(user.displayName || String(user.email).split('@')[0], 120),
    answers: clean,
    questionCount: quiz.questions.length,
    status: 'submitted',
    submittedAtIso: nowIso,
    tag: 'lms'
  };
}

/** The marks written to an attempt when the teacher releases results (teacher's quiz includes keys). */
export function buildQuizResultUpdate({ quiz, attempt, manualScores = {}, feedback = '', grader, nowIso = new Date().toISOString() }) {
  const marked = scoreQuizAttempt(quiz, attempt?.answers, manualScores);
  if (marked.pending > 0) {
    throw quizError(`${marked.pending} answer${marked.pending === 1 ? '' : 's'} still need${marked.pending === 1 ? 's' : ''} marking.`, 'NEEDS_MARKING');
  }
  return {
    status: 'graded',
    score: marked.score,
    maxScore: marked.maxScore,
    percent: marked.percent,
    grade: `${marked.percent}%`,
    results: marked.results.map(r => ({ questionId: r.questionId, earned: r.earned, points: r.points, correct: r.correct })),
    feedback: String(feedback || '').trim().slice(0, MAX_QUIZ_FEEDBACK_CHARS),
    gradedByUid: String(grader?.uid || ''),
    gradedByName: str(grader?.displayName || grader?.email || 'Teacher', 120),
    gradedAtIso: nowIso
  };
}

/** Rows for the results spreadsheet: one per attempt, one column per question. */
export function quizResultsTable(quiz, attempts, manualScoresByAttempt = {}) {
  const questions = list(quiz?.questions).filter(isObject);
  const header = ['Student', 'Email', 'Status', ...questions.map((q, i) => `Q${i + 1} (${q.points ?? 1})`), 'Score', 'Out of', '%'];
  const rows = list(attempts).map(attempt => {
    const released = attempt?.status === 'graded' && Array.isArray(attempt.results);
    const marked = released
      ? { results: attempt.results, score: attempt.score, maxScore: attempt.maxScore, percent: attempt.percent, pending: 0 }
      : scoreQuizAttempt(quiz, attempt?.answers, manualScoresByAttempt[attempt?.id] || {});
    const byId = new Map(list(marked.results).map(r => [r.questionId, r]));
    return [
      attempt?.studentName || '',
      attempt?.studentEmail || '',
      released ? 'Released' : marked.pending ? `${marked.pending} to mark` : 'Ready to release',
      ...questions.map(q => {
        const r = byId.get(q.id);
        return r ? (r.needsMarking ? '' : r.earned) : '';
      }),
      marked.score,
      marked.maxScore,
      marked.percent
    ];
  });
  return { header, rows };
}
