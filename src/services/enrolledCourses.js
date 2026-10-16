// src/services/enrolledCourses.js
// The courses a person is enrolled in, kept up to date live: follows their enrolments and every
// enrolled course document, so a teacher's saved changes reach the Student Panel without a reload.
import { subscribeToMyEnrolments } from './courseEnrollmentService.js';
import { subscribeToCourse, catalogCourseById } from './lmsRepository.js';

/** Most courses followed at once (one listener each). */
export const MAX_LIVE_COURSES = 60;
/** How long to wait for a course document before showing its placeholder card. */
export const COURSE_WAIT_MS = 8000;

/** The card shown when a course cannot be read (offline, removed or no access). */
export function placeholderCourse(enrolment) {
  return {
    id: String(enrolment.courseId),
    title: enrolment.courseTitle || 'Course',
    authorName: enrolment.addedByName || 'Course Teacher',
    authorEmail: '',
    units: [],
    assessments: [],
    tag: 'lms'
  };
}

/** One entry per course (the first enrolment wins), capped at MAX_LIVE_COURSES. */
function uniqueEnrolments(list) {
  const seen = new Set();
  const out = [];
  for (const e of Array.isArray(list) ? list : []) {
    const id = e && e.courseId !== undefined && e.courseId !== null ? String(e.courseId) : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ ...e, courseId: id });
    if (out.length >= MAX_LIVE_COURSES) break;
  }
  return out;
}

/**
 * Subscribes to the live list of a person's enrolled courses.
 * onCourses(courses) runs once every course has loaded (or after `waitMs`), then on every change.
 * Archived courses are left out. A course that cannot be read keeps its last version, or falls
 * back to the Global Course catalogue, a course kept in this browser, or a placeholder card.
 * @param {string} email
 * @param {(courses: object[]) => void} onCourses
 * @param {object} [options]
 * @param {(err: Error) => void} [options.onError] the enrolment listener failed
 * @param {(courseId: string) => object|null} [options.localCourse] course kept in this browser
 * @param {number} [options.waitMs]
 * @param {object} [options.listeners] replaces the Firestore listeners (tests)
 * @returns {() => void} unsubscribe
 */
export function subscribeToEnrolledCourses(email, onCourses, {
  onError,
  localCourse,
  waitMs = COURSE_WAIT_MS,
  listeners = {}
} = {}) {
  const followEnrolments = listeners.enrolments || subscribeToMyEnrolments;
  const followCourse = listeners.course || subscribeToCourse;
  const live = new Map(); // courseId -> { course, settled, stop }
  let enrolments = [];
  let received = false;
  let closed = false;
  let waitTimer = null;

  const fallbackFor = (enrolment) => {
    let local = null;
    try {
      local = localCourse?.(enrolment.courseId) || null;
    } catch {
      local = null;
    }
    return catalogCourseById(enrolment.courseId) || local || placeholderCourse(enrolment);
  };

  const emit = () => {
    if (closed || !received) return;
    if (enrolments.some(e => !live.get(e.courseId)?.settled)) return; // wait for each course or the timer
    if (waitTimer) {
      clearTimeout(waitTimer);
      waitTimer = null;
    }
    const all = enrolments
      .map(e => live.get(e.courseId)?.course || fallbackFor(e))
      .filter(Boolean);
    const courses = all.filter(c => !c.archived);
    const archived = all.filter(c => Boolean(c.archived));
    try {
      onCourses(courses, archived);
    } catch (err) {
      console.warn('Enrolled courses listener callback failed:', err);
    }
  };

  const follow = (enrolment) => {
    const entry = { course: null, settled: false, stop: () => {} };
    live.set(enrolment.courseId, entry);
    const stop = followCourse(
      enrolment.courseId,
      course => {
        if (closed || live.get(enrolment.courseId) !== entry) return;
        entry.course = course || null;
        entry.settled = true;
        emit();
      },
      err => {
        if (closed || live.get(enrolment.courseId) !== entry) return;
        // Keep the last version the student saw; otherwise the fallback card is used.
        if (err?.code !== 'DB_UNAVAILABLE') console.warn(`Live course ${enrolment.courseId} stopped:`, err?.code || err);
        entry.settled = true;
        emit();
      }
    );
    entry.stop = typeof stop === 'function' ? stop : () => {};
  };

  const stopEntry = (entry) => {
    try {
      entry.stop();
    } catch {
      // already detached
    }
  };

  const handleEnrolments = (list) => {
    if (closed) return;
    const next = uniqueEnrolments(list);
    const keep = new Set(next.map(e => e.courseId));
    for (const [id, entry] of live) {
      if (!keep.has(id)) {
        stopEntry(entry);
        live.delete(id);
      }
    }
    enrolments = next;
    received = true;
    let added = false;
    for (const e of next) {
      if (!live.has(e.courseId)) {
        follow(e);
        added = true;
      }
    }
    if (added && !waitTimer && waitMs > 0 && enrolments.some(e => !live.get(e.courseId)?.settled)) {
      waitTimer = setTimeout(() => {
        waitTimer = null;
        for (const entry of live.values()) entry.settled = true;
        emit();
      }, waitMs);
    }
    emit();
  };

  let stopEnrolments = () => {};
  try {
    const stop = followEnrolments(email, handleEnrolments, err => {
      if (!closed) onError?.(err);
    });
    if (typeof stop === 'function') stopEnrolments = stop;
  } catch (err) {
    onError?.(err);
  }

  return () => {
    closed = true;
    if (waitTimer) clearTimeout(waitTimer);
    waitTimer = null;
    try {
      stopEnrolments();
    } catch {
      // already detached
    }
    for (const entry of live.values()) stopEntry(entry);
    live.clear();
  };
}
