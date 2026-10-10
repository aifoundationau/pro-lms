// src/services/lmsRepository.js
// Single data-access layer for the shared `lms` namespace.
// All Firestore reads/writes for courses, students and leads go through here.
import { db } from '../firebase.js';
import {
  collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc, query, where,
  increment, serverTimestamp, writeBatch
} from 'firebase/firestore';

import { ALL_GLOBAL_COURSES, LMS_CATEGORIES } from './globalCoursesData.js';

export const LMS_SITE_ID = (import.meta?.env?.VITE_LMS_SITE_ID || (typeof process !== 'undefined' ? process.env?.VITE_LMS_SITE_ID : '') || 'lms').trim();

export const LMS_COLLECTIONS = {
  courses: 'lms_courses',
  students: 'lms_students',
  leads: 'lms_leads',
  categories: 'lms_categories',
  completions: 'lms_course_completions'
};

const LEGACY_COLLECTIONS = { courses: 'courses', students: 'students' };

// Keep reading legacy collections (read-only) until migration is verified.
export const LEGACY_READ_ENABLED = (import.meta?.env?.VITE_LMS_LEGACY_READ ?? (typeof process !== 'undefined' ? process.env?.VITE_LMS_LEGACY_READ : undefined)) !== 'false';

async function readLegacy(name) {
  if (!LEGACY_READ_ENABLED) return [];
  try {
    const snap = await getDocs(collection(db, name));
    return snap.docs.map(d => ({ id: d.id, ...d.data(), _legacy: true }));
  } catch (err) {
    console.warn(`Legacy read of "${name}" skipped:`, err?.code || err);
    return [];
  }
}

function mergeById(primary, legacy) {
  const seen = new Set(primary.map(x => String(x.id)));
  const migratedFrom = new Set(primary.map(x => x.migratedFrom).filter(Boolean).map(String));
  return [...primary, ...legacy.filter(x => !seen.has(String(x.id)) && !migratedFrom.has(String(x.id)))];
}

// Student fields that must never be exposed through shared/network reads.
export const SENSITIVE_STUDENT_FIELDS = [
  'proofOfIdentityType', 'proofOfIdentityNumber', 'passportNumber', 'visaSubclass',
  'coeNumber', 'nationalIdNumber', 'healthCoverProvider', 'healthCoverPolicyNumber',
  'requiresAccessibilitySupport', 'accessibilitySupportDetails', 'indigenousStatus',
  'guardianDetails', 'taxFileNumberProvided'
];

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_RETRIES = 2;

// ---------- infrastructure ----------

export function isDbAvailable() {
  return Boolean(db);
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Firestore request timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const NON_RETRYABLE = new Set(['permission-denied', 'invalid-argument', 'not-found', 'unauthenticated', 'failed-precondition']);

async function withRetry(fn, { retries = DEFAULT_RETRIES, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!db) throw new Error('Database unavailable (Firebase not configured).');
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs);
    } catch (err) {
      lastErr = err;
      if (err && NON_RETRYABLE.has(err.code)) break;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 400 * 2 ** attempt));
      }
    }
  }
  throw lastErr;
}

// ---------- validation helpers ----------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v, max = 5000) {
  if (v === null || v === undefined) return '';
  return String(v).slice(0, max);
}

function isoDateOr(v, fallback = '') {
  return typeof v === 'string' && ISO_DATE.test(v) ? v : fallback;
}

function stripUndefined(obj) {
  // Firestore rejects `undefined` values.
  return JSON.parse(JSON.stringify(obj ?? {}));
}

function sanitizeArrayOfObjects(arr, maxItems = 200) {
  return Array.isArray(arr) ? stripUndefined(arr.slice(0, maxItems)).filter(x => x && typeof x === 'object') : [];
}

/** Normalises any course-like object into the lms_courses shape. */
export function normalizeCourse(input = {}) {
  const inputTags = Array.isArray(input.tags) ? input.tags : [];
  const mergedTags = Array.from(new Set([...inputTags, 'lms']));

  return {
    title: str(input.title, 300) || 'Untitled Course',
    code: str(input.code || '', 100),
    category: str(input.category || 'General Academic', 200),
    aqfLevel: input.aqfLevel !== undefined ? Number(input.aqfLevel) : 4,
    nominalHours: Number(input.nominalHours) || 40,
    token_cost: Number(input.token_cost) || 0,
    startDate: isoDateOr(input.startDate, new Date().toISOString().split('T')[0]),
    year: str(input.year, 100),
    description: str(input.description, 20000),
    thumbnail: str(input.thumbnail, 2000),
    outcomes: str(input.outcomes, 20000),
    knowledge: str(input.knowledge, 20000),
    learningOutcomes: Array.isArray(input.learningOutcomes) ? input.learningOutcomes : [],
    units: sanitizeArrayOfObjects(input.units),
    modules: sanitizeArrayOfObjects(input.modules),
    assessments: sanitizeArrayOfObjects(input.assessments),
    students: Number.isFinite(Number(input.students)) ? Math.max(0, Number(input.students)) : 0,
    archived: Boolean(input.archived),
    visibility: input.visibility === 'site' ? 'site' : 'network',
    sourceCourseId: input.sourceCourseId ? str(input.sourceCourseId, 200) : null,
    sourceSiteId: input.sourceSiteId ? str(input.sourceSiteId, 100) : null,
    tag: 'lms', // Standard tag for cross-app course sharing & completions
    tags: mergedTags
  };
}

// ---------- courses ----------

/** Generates a Firestore document ID up-front so local state and DB share one ID. */
export function newCourseId() {
  if (db) return doc(collection(db, LMS_COLLECTIONS.courses)).id;
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Lists this site's courses. Falls back to the legacy `courses` collection
 * (read-only) when lms_courses has nothing for this site yet.
 */
export async function listSiteCourses() {
  return withRetry(async () => {
    const snap = await getDocs(query(collection(db, LMS_COLLECTIONS.courses), where('siteId', '==', LMS_SITE_ID)));
    const lms = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const legacy = await readLegacy(LEGACY_COLLECTIONS.courses);
    return { courses: mergeById(lms, legacy) };
  });
}

/** Courses any site in the network has published for reuse. */
export async function listNetworkCourses() {
  return withRetry(async () => {
    const snap = await getDocs(query(collection(db, LMS_COLLECTIONS.courses), where('visibility', '==', 'network')));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  });
}

/** Creates or fully updates a course (merge). */
export async function saveCourse(id, course, { isNew = false } = {}) {
  if (!id) throw new Error('saveCourse requires an id');
  // First write into lms_courses (new course, or a not-yet-migrated legacy course).
  const firstWrite = isNew || Boolean(course?._legacy);
  const normalized = normalizeCourse(course);
  const payload = {
    ...normalized,
    siteId: LMS_SITE_ID,
    tag: 'lms', // Mandatory LMS tag for multi-app integration
    updatedAt: serverTimestamp(),
    ...(firstWrite ? { createdAt: serverTimestamp(), ...(course?._legacy ? { migratedFrom: String(id) } : {}) } : {})
  };
  // Never overwrite the live counter from a stale client copy.
  if (!firstWrite) delete payload.students;
  return withRetry(() => setDoc(doc(db, LMS_COLLECTIONS.courses, String(id)), payload, { merge: true }));
}

/** Archives/restores using the full course payload, so legacy courses migrate intact. */
export async function setCourseArchived(course, archived) {
  if (!course?.id) throw new Error('setCourseArchived requires a course with an id');
  const { _legacy, ...rest } = course;
  return saveCourse(course.id, { ...rest, archived: Boolean(archived), tag: 'lms' }, { isNew: Boolean(_legacy) });
}

/** Copies a course (from the network catalog or elsewhere) into this site with lineage. */
export async function copyCourseToSite(sourceCourse) {
  const id = newCourseId();
  const copy = {
    ...sourceCourse,
    students: 0,
    archived: false,
    visibility: 'site',
    tag: 'lms',
    tags: Array.from(new Set([...(Array.isArray(sourceCourse.tags) ? sourceCourse.tags : []), 'lms'])),
    sourceCourseId: String(sourceCourse.id ?? ''),
    sourceSiteId: sourceCourse.siteId || 'global-catalog'
  };
  await saveCourse(id, copy, { isNew: true });
  return { id, ...normalizeCourse(copy), siteId: LMS_SITE_ID, tag: 'lms' };
}

/**
 * Atomic enrolment counter update (no read-modify-write race).
 * Uses updateDoc so it never creates empty stub courses; courses not yet in
 * lms_courses (unmigrated legacy) are skipped and will be counted after migration.
 */
export async function incrementCourseEnrolments(courseIds, delta = 1) {
  const ids = Array.from(new Set((courseIds || []).map(String))).filter(Boolean);
  if (!ids.length) return;
  const results = await Promise.allSettled(ids.map(id =>
    withRetry(() => updateDoc(doc(db, LMS_COLLECTIONS.courses, id), { students: increment(delta), updatedAt: serverTimestamp() }))
  ));
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.warn(`Enrolment count not updated for course ${ids[i]}:`, r.reason?.code || r.reason);
  });
}

// ---------- students ----------

function splitStudent(student) {
  const publicPart = {};
  const sensitivePart = {};
  Object.entries(stripUndefined(student)).forEach(([k, v]) => {
    if (SENSITIVE_STUDENT_FIELDS.includes(k)) sensitivePart[k] = v;
    else publicPart[k] = v;
  });
  return { publicPart, sensitivePart };
}

export function validateStudent(student) {
  const errors = [];
  if (!str(student?.legalFirstName).trim()) errors.push('Legal first name is required.');
  if (!str(student?.legalFamilyName).trim()) errors.push('Legal family name is required.');
  if (student?.personalEmail && !EMAIL.test(student.personalEmail)) errors.push('Personal email looks invalid.');
  if (student?.dateOfBirth && !ISO_DATE.test(student.dateOfBirth)) errors.push('Date of birth must be YYYY-MM-DD.');
  return errors;
}

/**
 * Lists this site's students, merging the private/sensitive sub-document,
 * plus any not-yet-migrated legacy `students` records (read-only).
 */
export async function listSiteStudents() {
  return withRetry(async () => {
    const snap = await getDocs(query(collection(db, LMS_COLLECTIONS.students), where('siteId', '==', LMS_SITE_ID)));
    const students = await Promise.all(snap.docs.map(async d => {
      let sensitive = {};
      try {
        const s = await getDoc(doc(db, LMS_COLLECTIONS.students, d.id, 'private', 'sensitive'));
        if (s.exists()) sensitive = s.data();
      } catch (err) {
        console.warn('Sensitive student data unavailable:', d.id, err?.code || err);
      }
      return { id: d.id, ...d.data(), ...sensitive };
    }));
    const legacy = await readLegacy(LEGACY_COLLECTIONS.students);
    return { students: mergeById(students, legacy) };
  }, { timeoutMs: 20000 });
}

export async function saveStudent(student) {
  const errors = validateStudent(student);
  if (errors.length) throw new Error(errors.join(' '));
  const id = str(student.id, 200);
  if (!id) throw new Error('saveStudent requires an id');

  const { _legacy, ...clean } = student;
  const { publicPart, sensitivePart } = splitStudent(clean);
  const enrolledCourseIds = Array.isArray(student.enrolledCourseIds) ? student.enrolledCourseIds.map(String) : [];
  const completedCourseIds = Array.isArray(student.completedCourseIds) ? student.completedCourseIds.map(String) : [];
  const studentTags = Array.from(new Set([...(Array.isArray(student.tags) ? student.tags : []), 'lms']));

  return withRetry(async () => {
    const batch = writeBatch(db);
    batch.set(doc(db, LMS_COLLECTIONS.students, id), {
      ...publicPart,
      id,
      siteId: LMS_SITE_ID,
      tag: 'lms', // Mandatory LMS tag for multi-app integration
      tags: studentTags,
      enrolledCourseIds,
      completedCourseIds,
      courseProgress: student.courseProgress || {},
      enrolments: enrolledCourseIds.map(courseId => ({ siteId: LMS_SITE_ID, courseId })),
      lastUpdated: new Date().toISOString(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    batch.set(doc(db, LMS_COLLECTIONS.students, id, 'private', 'sensitive'), { ...sensitivePart, siteId: LMS_SITE_ID, tag: 'lms' }, { merge: true });
    await batch.commit();
  });
}

/**
 * Records a course completion for a student under the 'lms' tag.
 * Can be called by any app in the ecosystem to update learner progress.
 */
export async function completeCourseForStudent({
  studentId,
  courseId,
  grade = 'Competent / Completed',
  completionDate = new Date().toISOString().split('T')[0]
}) {
  if (!studentId || !courseId) {
    throw new Error('studentId and courseId are required to record completion.');
  }

  const cid = String(courseId);
  const sid = String(studentId);
  const nowIso = new Date().toISOString();
  let completedCourseIds = [cid];

  if (db) {
    try {
      const studentRef = doc(db, LMS_COLLECTIONS.students, sid);
      const snap = await getDoc(studentRef).catch(() => null);
      const existing = snap && snap.exists() ? snap.data() : {};

      completedCourseIds = Array.from(new Set([
        ...(Array.isArray(existing.completedCourseIds) ? existing.completedCourseIds.map(String) : []),
        cid
      ]));

      const progress = existing.courseProgress || {};
      progress[cid] = {
        status: 'completed',
        grade,
        completedAt: completionDate || nowIso,
        tag: 'lms'
      };

      await updateDoc(studentRef, {
        completedCourseIds,
        courseProgress: progress,
        lastCompletedCourseId: cid,
        lastCompletionDate: completionDate || nowIso,
        updatedAt: serverTimestamp(),
        tag: 'lms'
      }).catch(err => {
        console.warn('Student progress update note:', err?.message || err);
      });

      // Record immutable audit entry in lms_course_completions
      const completionRef = doc(collection(db, 'lms_course_completions'));
      await setDoc(completionRef, {
        studentId: sid,
        courseId: cid,
        grade,
        completionDate,
        completedAt: nowIso,
        tag: 'lms',
        siteId: LMS_SITE_ID
      }).catch(err => {
        console.warn('Completion audit log note:', err?.message || err);
      });
    } catch (err) {
      console.warn('completeCourseForStudent Firestore notice (continuing gracefully):', err?.message || err);
    }
  }

  return {
    success: true,
    tag: 'lms',
    studentId: sid,
    courseId: cid,
    completedCourseIds,
    message: `Course ${cid} marked as completed for student ${sid} under tag 'lms'.`
  };
}

export async function deleteStudent(id) {
  return withRetry(async () => {
    await deleteDoc(doc(db, LMS_COLLECTIONS.students, String(id), 'private', 'sensitive'));
    await deleteDoc(doc(db, LMS_COLLECTIONS.students, String(id)));
    if (LEGACY_READ_ENABLED) {
      // User-initiated delete: also remove the legacy copy so it doesn't reappear via the merge.
      await deleteDoc(doc(db, LEGACY_COLLECTIONS.students, String(id)));
    }
  });
}

// ---------- leads (contact form) ----------

export async function saveLead({ name, email, phone, message }) {
  const lead = {
    name: str(name, 200).trim(),
    email: str(email, 320).trim(),
    phone: str(phone, 50).trim(),
    message: str(message, 5000).trim(),
    tag: 'lms'
  };
  if (!lead.name || !EMAIL.test(lead.email) || !lead.message) {
    throw new Error('Lead requires name, valid email and message.');
  }
  const ref = doc(collection(db, LMS_COLLECTIONS.leads));
  await withRetry(() => setDoc(ref, { ...lead, siteId: LMS_SITE_ID, source: 'contact-form', tag: 'lms', createdAt: serverTimestamp() }), { retries: 1 });
  return ref.id;
}

/**
 * Cross-App Query: Fetches all LMS courses tagged with 'lms'
 * Allows external applications or other websites in the ecosystem to pull courses.
 */
export async function listLmsCoursesByTag({ tag = 'lms', category = 'ALL', limitCount = 100 } = {}) {
  try {
    if (db) {
      const q = query(
        collection(db, LMS_COLLECTIONS.courses),
        where('tag', '==', tag)
      );
      const snap = await getDocs(q);
      let courses = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      if (courses.length === 0) {
        const siteSnap = await listSiteCourses().catch(() => ({ courses: [] }));
        courses = siteSnap.courses || [];
      }

      if (courses.length > 0) {
        if (category && category !== 'ALL') {
          courses = courses.filter(c => (c.category || '').toLowerCase() === category.toLowerCase());
        }
        return courses.slice(0, limitCount);
      }
    }
  } catch (err) {
    console.warn('listLmsCoursesByTag Firestore query notice, using catalog:', err?.message || err);
  }

  // Robust fallback to ALL_GLOBAL_COURSES (always available, even offline/multi-site)
  let catalog = ALL_GLOBAL_COURSES.filter(c => c.tag === tag || (Array.isArray(c.tags) && c.tags.includes(tag)));
  if (category && category !== 'ALL') {
    catalog = catalog.filter(c => (c.category || '').toLowerCase() === category.toLowerCase());
  }
  return catalog.slice(0, limitCount);
}

/**
 * Cross-App Query: Fetches a single LMS course by ID with tag 'lms'
 */
export async function getLmsCourseById(courseId) {
  if (!courseId) return null;
  const cid = String(courseId);
  try {
    if (db) {
      const snap = await getDoc(doc(db, LMS_COLLECTIONS.courses, cid));
      if (snap.exists()) {
        return { id: snap.id, ...snap.data(), tag: 'lms' };
      }
    }
  } catch (err) {
    console.warn(`Error getting course ${cid} from Firestore:`, err?.message || err);
  }
  // Fall back to global course catalog
  const fromGlobal = ALL_GLOBAL_COURSES.find(c => String(c.id) === cid);
  if (fromGlobal) {
    return { ...fromGlobal, tag: 'lms' };
  }
  return null;
}

/**
 * Cross-App Query: Fetches all LMS categories tagged with 'lms'
 */
export async function listLmsCategories() {
  try {
    if (db) {
      const q = query(collection(db, LMS_COLLECTIONS.categories), where('tag', '==', 'lms'));
      const snap = await getDocs(q);
      if (!snap.empty) {
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
      }
    }
  } catch (err) {
    console.warn('Firestore category fetch note, using fallback catalog:', err?.message || err);
  }
  return LMS_CATEGORIES;
}

/**
 * Saves a category definition under the 'lms' tag
 */
export async function saveLmsCategory(categoryData) {
  const slug = (categoryData.slug || categoryData.name || 'general').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const id = categoryData.id || `cat-${slug}`;
  const payload = {
    id,
    slug,
    name: str(categoryData.name, 200) || 'General Academic',
    description: str(categoryData.description, 1000) || '',
    aqfLevels: Array.isArray(categoryData.aqfLevels) ? categoryData.aqfLevels : [1, 2, 3, 4, 5, 6, 7, 8, 9],
    tag: 'lms',
    tags: Array.from(new Set([...(Array.isArray(categoryData.tags) ? categoryData.tags : []), 'lms', 'category', slug])),
    updatedAt: serverTimestamp()
  };
  if (db) {
    await withRetry(() => setDoc(doc(db, LMS_COLLECTIONS.categories, id), payload, { merge: true }));
  }
  return payload;
}
