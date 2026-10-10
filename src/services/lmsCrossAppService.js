/**
 * src/services/lmsCrossAppService.js
 *
 * Universal Cross-Application LMS Service & SDK
 * Enables multiple educational websites and applications in the ecosystem
 * to query categories and courses tagged with 'lms', and record course completions.
 */

import {
  listLmsCoursesByTag,
  getLmsCourseById,
  listLmsCategories,
  completeCourseForStudent,
  LMS_SITE_ID,
  LMS_COLLECTIONS
} from './lmsRepository.js';

import { ALL_GLOBAL_COURSES, LMS_CATEGORIES } from './globalCoursesData.js';
import { db } from '../firebase.js';
import { collection, query, where, getDocs } from 'firebase/firestore';

/**
 * Standard tag constant across the ecosystem
 */
export const LMS_TAG = 'lms';

/**
 * Fetches all categories tagged with 'lms'
 * Usable by any website in the network to populate navigation, filters, or course lists.
 */
export async function fetchLmsCategories() {
  try {
    const categories = await listLmsCategories();
    return categories.map(cat => ({
      ...cat,
      tag: LMS_TAG
    }));
  } catch (err) {
    console.warn('LMS Cross-App: Error fetching categories, returning catalog:', err);
    return LMS_CATEGORIES.map(cat => ({ ...cat, tag: LMS_TAG }));
  }
}

/**
 * Fetches courses tagged with 'lms', optionally filtered by category or AQF level.
 */
export async function fetchLmsCourses({
  category = 'ALL',
  aqfLevel = 'ALL',
  tag = LMS_TAG,
  keyword = '',
  limit = 100
} = {}) {
  try {
    let courses = await listLmsCoursesByTag({ tag, category, limitCount: limit });

    if (aqfLevel && aqfLevel !== 'ALL') {
      courses = courses.filter(c => Number(c.aqfLevel) === Number(aqfLevel));
    }

    if (keyword && keyword.trim()) {
      const q = keyword.toLowerCase().trim();
      courses = courses.filter(c =>
        (c.title || '').toLowerCase().includes(q) ||
        (c.code || '').toLowerCase().includes(q) ||
        (c.description || '').toLowerCase().includes(q)
      );
    }

    return courses.map(c => ({
      ...c,
      tag: LMS_TAG,
      tags: Array.from(new Set([...(Array.isArray(c.tags) ? c.tags : []), LMS_TAG]))
    }));
  } catch (err) {
    console.warn('LMS Cross-App: Error fetching courses, falling back to local catalog:', err);
    let fallback = ALL_GLOBAL_COURSES.filter(c => c.tag === tag || (Array.isArray(c.tags) && c.tags.includes(tag)));
    if (category && category !== 'ALL') {
      fallback = fallback.filter(c => (c.category || '').toLowerCase() === category.toLowerCase());
    }
    return fallback.slice(0, limit);
  }
}

/**
 * Fetches a single course with its complete curriculum structure by ID
 */
export async function fetchLmsCourseById(courseId) {
  if (!courseId) return null;
  const course = await getLmsCourseById(courseId);
  if (!course) return null;
  return {
    ...course,
    tag: LMS_TAG,
    tags: Array.from(new Set([...(Array.isArray(course.tags) ? course.tags : []), LMS_TAG]))
  };
}

/**
 * Completes a course for a student across any ecosystem app.
 * Persists completion record into `lms_course_completions` and updates student progress.
 */
export async function completeLmsCourse({
  studentId,
  studentEmail = '',
  studentName = '',
  courseId,
  courseTitle = '',
  grade = 'Competent / Completed',
  completionDate = new Date().toISOString().split('T')[0],
  appSource = LMS_SITE_ID
}) {
  if (!studentId && !studentEmail) {
    throw new Error('completeLmsCourse requires either studentId or studentEmail.');
  }
  if (!courseId) {
    throw new Error('completeLmsCourse requires a valid courseId.');
  }

  const sid = studentId || studentEmail.replace(/[^a-zA-Z0-9]/g, '_');

  const result = await completeCourseForStudent({
    studentId: sid,
    courseId,
    grade,
    completionDate
  });

  return {
    success: true,
    tag: LMS_TAG,
    studentId: sid,
    studentEmail,
    studentName,
    courseId: String(courseId),
    courseTitle,
    grade,
    completionDate,
    completedAt: new Date().toISOString(),
    appSource,
    message: `🎉 Course ${courseId} verified and completed under 'lms' tag.`
  };
}

/**
 * Retrieves student completion records tagged with 'lms'
 */
export async function fetchStudentLmsCompletions(studentIdOrEmail) {
  if (!studentIdOrEmail) return [];
  const queryKey = String(studentIdOrEmail);

  if (!db) return [];

  try {
    const q1 = query(
      collection(db, LMS_COLLECTIONS.completions),
      where('studentId', '==', queryKey)
    );
    const snap1 = await getDocs(q1);
    const list = snap1.docs.map(d => ({ id: d.id, ...d.data() }));

    if (list.length === 0 && queryKey.includes('@')) {
      const q2 = query(
        collection(db, LMS_COLLECTIONS.completions),
        where('memberEmail', '==', queryKey)
      );
      const snap2 = await getDocs(q2);
      return snap2.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    return list;
  } catch (err) {
    console.warn('LMS Cross-App: Error fetching completions from Firestore:', err);
    return [];
  }
}

/**
 * Generates copy-paste integration snippet for external websites
 */
export function generateExternalWebsiteIntegrationSnippet(origin = 'https://pro-lms.vercel.app') {
  return `<!-- OzEdu LMS Cross-App Integration Snippet -->
<script>
  // 1. Fetch all LMS courses
  async function loadLmsCourses(category = 'ALL') {
    const res = await fetch('${origin}/api/lms/courses?category=' + encodeURIComponent(category) + '&tag=lms');
    const data = await res.json();
    return data.courses; // Array of courses tagged with 'lms'
  }

  // 2. Fetch all LMS categories
  async function loadLmsCategories() {
    const res = await fetch('${origin}/api/lms/categories');
    const data = await res.json();
    return data.categories; // Array of categories tagged with 'lms'
  }

  // 3. Complete course for student from another website
  async function markLmsCourseCompleted({ studentId, studentEmail, courseId, grade }) {
    const res = await fetch('${origin}/api/lms/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId,
        studentEmail,
        courseId,
        grade: grade || 'Competent / Completed',
        tag: 'lms',
        appSource: window.location.hostname
      })
    });
    return await res.json();
  }
</script>`;
}
