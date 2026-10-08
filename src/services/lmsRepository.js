// src/services/lmsRepository.js
// Single data-access layer for the shared `lms` namespace.
// All Firestore reads/writes for courses, students and leads go through here.
import { db } from '../firebase';
import {
  collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc, query, where,
  increment, serverTimestamp, writeBatch
} from 'firebase/firestore';

export const LMS_SITE_ID = (import.meta.env.VITE_LMS_SITE_ID || 'lms').trim();

export const LMS_COLLECTIONS = {
  courses: 'lms_courses',
  students: 'lms_students',
  leads: 'lms_leads'
};

const LEGACY_COLLECTIONS = { courses: 'courses', students: 'students' };

// Keep reading legacy collections (read-only) until migration is verified.
export const LEGACY_READ_ENABLED = import.meta.env.VITE_LMS_LEGACY_READ !== 'false';

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
  return {
    title: str(input.title, 300) || 'Untitled Course',
    startDate: isoDateOr(input.startDate, new Date().toISOString().split('T')[0]),
    year: str(input.year, 100),
    description: str(input.description, 20000),
    thumbnail: str(input.thumbnail, 2000),
    outcomes: str(input.outcomes, 20000),
    knowledge: str(input.knowledge, 20000),
    modules: sanitizeArrayOfObjects(input.modules),
    assessments: sanitizeArrayOfObjects(input.assessments),
    students: Number.isFinite(Number(input.students)) ? Math.max(0, Number(input.students)) : 0,
    archived: Boolean(input.archived),
    visibility: input.visibility === 'site' ? 'site' : 'network',
    sourceCourseId: input.sourceCourseId ? str(input.sourceCourseId, 200) : null,
    sourceSiteId: input.sourceSiteId ? str(input.sourceSiteId, 100) : null
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
  const payload = {
    ...normalizeCourse(course),
    siteId: LMS_SITE_ID,
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
  return saveCourse(course.id, { ...rest, archived: Boolean(archived) }, { isNew: Boolean(_legacy) });
}

/** Copies a course (from the network catalog or elsewhere) into this site with lineage. */
export async function copyCourseToSite(sourceCourse) {
  const id = newCourseId();
  const copy = {
    ...sourceCourse,
    students: 0,
    archived: false,
    visibility: 'site',
    sourceCourseId: String(sourceCourse.id ?? ''),
    sourceSiteId: sourceCourse.siteId || 'global-catalog'
  };
  await saveCourse(id, copy, { isNew: true });
  return { id, ...normalizeCourse(copy), siteId: LMS_SITE_ID };
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

  return withRetry(async () => {
    const batch = writeBatch(db);
    batch.set(doc(db, LMS_COLLECTIONS.students, id), {
      ...publicPart,
      id,
      siteId: LMS_SITE_ID,
      enrolledCourseIds,
      enrolments: enrolledCourseIds.map(courseId => ({ siteId: LMS_SITE_ID, courseId })),
      lastUpdated: new Date().toISOString(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    batch.set(doc(db, LMS_COLLECTIONS.students, id, 'private', 'sensitive'), { ...sensitivePart, siteId: LMS_SITE_ID }, { merge: true });
    await batch.commit();
  });
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
    message: str(message, 5000).trim()
  };
  if (!lead.name || !EMAIL.test(lead.email) || !lead.message) {
    throw new Error('Lead requires name, valid email and message.');
  }
  const ref = doc(collection(db, LMS_COLLECTIONS.leads));
  await withRetry(() => setDoc(ref, { ...lead, siteId: LMS_SITE_ID, source: 'contact-form', createdAt: serverTimestamp() }), { retries: 1 });
  return ref.id;
}
