/**
 * Student Admin Panel overview: progress and upcoming assessments across a student's courses.
 * Pure module (no Firebase, no DOM).
 */

import { moveUnitAssessmentsToCourse } from '../types/courseBuilderTypes.js';
import { listCourseQuizzes } from './quizModel.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const DUE_SOON_DAYS = 14;

/** "YYYY-MM-DD" -> local-midnight time, or null. */
function dueTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

/** 'graded' | 'submitted' | 'draft' | 'overdue' | 'due' (no submission yet). */
export function assessmentStatus(submission, dueAt, todayStart) {
  if (submission?.status === 'graded') return 'graded';
  if (submission?.status === 'submitted') return 'submitted';
  if (submission && submission.status !== 'draft') return 'submitted';
  if (dueAt !== null && dueAt < todayStart) return 'overdue';
  if (submission?.status === 'draft') return 'draft';
  return 'due';
}

/**
 * @param {Array} courses enrolled courses (units with lessons; assessments at course level)
 * @param {Object<string, Object<string, object>>} submissionsByCourse courseId -> assessmentId -> submission
 * @param {number} now current time (ms)
 * @param {Object<string, Object<string, object>>} quizAttemptsByCourse courseId -> quizId -> attempt
 */
export function summarizeStudentProgress(courses, submissionsByCourse = {}, now = Date.now(), quizAttemptsByCourse = {}) {
  const today = new Date(now);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const stats = { courses: 0, assessments: 0, submitted: 0, graded: 0, overdue: 0, dueSoon: 0, quizzes: 0, quizzesDone: 0 };
  const perCourse = {};
  const upcoming = [];

  for (const rawCourse of Array.isArray(courses) ? courses : []) {
    if (!rawCourse || rawCourse.id === undefined || rawCourse.id === null) continue;
    const course = moveUnitAssessmentsToCourse(rawCourse);
    stats.courses++;
    const subs = submissionsByCourse[course.id] || {};
    const attempts = quizAttemptsByCourse[course.id] || {};
    const progress = { total: 0, submitted: 0, graded: 0, quizzes: 0, quizzesDone: 0 };
    const units = Array.isArray(course.units) ? course.units : [];
    for (const { block } of listCourseQuizzes(course)) {
      progress.quizzes++;
      if (attempts[block.id]) progress.quizzesDone++;
    }
    for (const assessment of Array.isArray(course.assessments) ? course.assessments : []) {
      if (!assessment?.id) continue;
      const unit = units.find(u => u?.id && u.id === assessment.unitId) || {};
      const dueAt = dueTime(assessment.dueDate);
      const status = assessmentStatus(subs[assessment.id], dueAt, todayStart);
      progress.total++;
      if (status === 'graded') progress.graded++;
      if (status === 'graded' || status === 'submitted') progress.submitted++;
      if (status === 'overdue') stats.overdue++;
      if ((status === 'due' || status === 'draft') && dueAt !== null && dueAt - todayStart <= DUE_SOON_DAYS * DAY_MS) stats.dueSoon++;
      if (status === 'due' || status === 'overdue' || status === 'draft') {
        upcoming.push({
          courseId: course.id,
          courseTitle: course.title || 'Course',
          unitTitle: unit.unitTitle || '',
          assessmentId: assessment.id,
          title: assessment.title || 'Assessment',
          type: assessment.type === 'summative' ? 'summative' : 'formative',
          dueDate: dueAt !== null ? assessment.dueDate : '',
          status
        });
      }
    }
    stats.assessments += progress.total;
    stats.submitted += progress.submitted;
    stats.graded += progress.graded;
    stats.quizzes += progress.quizzes;
    stats.quizzesDone += progress.quizzesDone;
    perCourse[course.id] = progress;
  }

  // Overdue first, then by due date (undated last), then by course.
  const order = item => (item.status === 'overdue' ? 0 : 1);
  upcoming.sort((a, b) => order(a) - order(b) ||
    (dueTime(a.dueDate) ?? Infinity) - (dueTime(b.dueDate) ?? Infinity) ||
    String(a.courseTitle).localeCompare(String(b.courseTitle)));

  return { stats, perCourse, upcoming };
}
