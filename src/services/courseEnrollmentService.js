/**
 * Course Enrollment & Roster Service
 *
 * Implements:
 * - Free Teacher Grant: Teachers can add any student, teacher, or external participant
 *   to any course with 0 tokens required.
 * - Bulk enrolment from pasted email lists or uploaded spreadsheets (.xlsx / .csv).
 * - Firestore 'course_members' collection with deterministic ids (`<courseId>__<email>`), so a
 *   person is enrolled once per course and security rules can check enrolment. Local cache fallback.
 * - Students find their own courses by their sign-in email (listMyEnrolments).
 * - Atomic increment of course enrollment counters. Removal is a status change (no deletes).
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  updateDoc,
  writeBatch,
  serverTimestamp
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { incrementCourseEnrolments } from './lmsRepository.js';
import { normalizeHeader } from './courseSpreadsheetSchema.js';

const STORAGE_COURSE_MEMBERS_KEY = 'ozedu_course_members_cache';
export const COURSE_MEMBERS_COLLECTION = 'course_members';
export const MAX_BULK_MEMBERS = 2000;
const BATCH_SIZE = 400;
const MEMBER_ROLES = new Set(['student', 'teacher', 'guest']);

// In-memory fallback map for non-browser / test environments
const memoryStorage = new Map();

function safeGetStorage(key) {
  try {
    if (typeof localStorage !== 'undefined' && localStorage && typeof localStorage.getItem === 'function') {
      return localStorage.getItem(key);
    }
  } catch {
    // fallback
  }
  return memoryStorage.get(key) || null;
}

function safeSetStorage(key, val) {
  try {
    if (typeof localStorage !== 'undefined' && localStorage && typeof localStorage.setItem === 'function') {
      localStorage.setItem(key, String(val));
      return;
    }
  } catch {
    // fallback
  }
  memoryStorage.set(key, String(val));
}

function readCache() {
  try {
    const raw = safeGetStorage(STORAGE_COURSE_MEMBERS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeCache(list) {
  try {
    safeSetStorage(STORAGE_COURSE_MEMBERS_KEY, JSON.stringify(list.slice(0, 5000)));
  } catch (err) {
    console.warn('Local storage member cache note:', err);
  }
}

// ---------- email helpers ----------

const EMAIL_IN_TEXT = /[^\s@<>()[\],;:"']+@[^\s@<>()[\],;:"']+\.[a-z]{2,}/gi;
const EMAIL_EXACT = /^[^\s@<>()[\],;:"']+@[^\s@<>()[\],;:"']+\.[a-z]{2,}$/i;

export function normalizeMemberEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function isValidMemberEmail(value) {
  return EMAIL_EXACT.test(normalizeMemberEmail(value));
}

/** Deterministic course_members document id for an email member. */
export function memberDocId(courseId, email) {
  return `${String(courseId)}__${normalizeMemberEmail(email)}`;
}

/**
 * Parses pasted text: one person per line ("Name <email>", "email, Name", "Name, email" or just
 * emails separated by commas/semicolons/spaces). Duplicates are removed.
 * @returns {{ members: Array<{email, name}>, invalid: string[], duplicates: string[] }}
 */
export function parseMemberText(text) {
  const members = [];
  const invalid = [];
  const duplicates = [];
  const seen = new Set();
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const emails = line.match(EMAIL_IN_TEXT) || [];
    if (!emails.length) {
      for (const token of line.split(/[,;\s]+/)) if (token.includes('@')) invalid.push(token);
      continue;
    }
    const name = emails.length === 1
      ? line.replace(emails[0], ' ').replace(/[<>"()[\]]/g, ' ').replace(/[,;\t]+/g, ' ').replace(/\s+/g, ' ').trim()
      : '';
    for (const raw of emails) {
      const email = normalizeMemberEmail(raw);
      if (!isValidMemberEmail(email)) {
        invalid.push(raw);
        continue;
      }
      if (seen.has(email)) {
        duplicates.push(email);
        continue;
      }
      seen.add(email);
      members.push({ email, name: name.slice(0, 120) });
    }
  }
  return { members, invalid, duplicates };
}

const EMAIL_HEADERS = new Set(['email', 'email address', 'e mail', 'student email', 'personal email', 'school email', 'work email', 'emails']);
const NAME_HEADERS = new Set(['name', 'full name', 'student name', 'student', 'learner', 'learner name', 'display name', 'preferred name']);
const FIRST_HEADERS = new Set(['first name', 'given name', 'firstname', 'legal first name']);
const LAST_HEADERS = new Set(['last name', 'family name', 'surname', 'lastname', 'legal family name']);

/**
 * Reads a roster spreadsheet (from spreadsheetReader): finds an Email column (and Name, or
 * First/Last name columns). Without a header, every email-looking cell is used.
 */
export function parseRosterSheets(sheets) {
  const members = [];
  const invalid = [];
  const duplicates = [];
  const seen = new Set();
  const add = (rawEmail, name) => {
    const email = normalizeMemberEmail(rawEmail);
    if (!email) return;
    if (!isValidMemberEmail(email)) {
      invalid.push(String(rawEmail).slice(0, 80));
      return;
    }
    if (seen.has(email)) {
      duplicates.push(email);
      return;
    }
    seen.add(email);
    members.push({ email, name: String(name || '').trim().slice(0, 120) });
  };

  for (const sheet of Array.isArray(sheets) ? sheets : []) {
    const rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
    let header = null;
    for (let r = 0; r < Math.min(rows.length, 15) && !header; r++) {
      const normalized = rows[r].map(normalizeHeader);
      const emailCol = normalized.findIndex(h => EMAIL_HEADERS.has(h));
      if (emailCol >= 0) {
        header = {
          row: r,
          email: emailCol,
          name: normalized.findIndex(h => NAME_HEADERS.has(h)),
          first: normalized.findIndex(h => FIRST_HEADERS.has(h)),
          last: normalized.findIndex(h => LAST_HEADERS.has(h))
        };
      }
    }
    if (header) {
      for (const cells of rows.slice(header.row + 1)) {
        const rawEmail = String(cells[header.email] || '').trim();
        if (!rawEmail) continue;
        const fullName = header.name >= 0
          ? cells[header.name]
          : [header.first >= 0 ? cells[header.first] : '', header.last >= 0 ? cells[header.last] : ''].join(' ');
        add(rawEmail, fullName);
      }
    } else {
      for (const cells of rows) {
        for (const cell of cells) {
          for (const match of String(cell || '').match(EMAIL_IN_TEXT) || []) add(match, '');
        }
      }
    }
  }
  return { members, invalid, duplicates };
}

// ---------- enrolment ----------

/** Builds a course_members record (pure; also used by the security-rules tests). */
export function buildMemberRecord({ courseId, courseTitle, memberName, memberEmail, memberRole, addedByUid, addedByName, nowIso }) {
  const cleanEmail = normalizeMemberEmail(memberEmail);
  const cleanName = String(memberName || '').trim().slice(0, 120) || (cleanEmail ? cleanEmail.split('@')[0] : 'Participant');
  const role = MEMBER_ROLES.has(memberRole) ? memberRole : 'student';
  const id = cleanEmail
    ? memberDocId(courseId, cleanEmail)
    : `${String(courseId)}__name__${cleanName.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)}_${Date.now().toString(36)}`;
  return {
    id,
    courseId: String(courseId),
    courseTitle: String(courseTitle || 'Course').slice(0, 300),
    memberName: cleanName,
    memberEmail: cleanEmail,
    memberRole: role,
    status: 'active',
    tokenCost: 0, // 0 TOKENS REQUIRED (Free teacher privilege)
    isFreeTeacherGrant: true,
    addedByUid: String(addedByUid || 'teacher'),
    addedByName: String(addedByName || 'Course Teacher').slice(0, 120),
    enrolledAt: nowIso,
    tag: 'lms',
    tags: ['lms', role]
  };
}

function cacheMember(record) {
  const list = readCache().filter(m => !(m.courseId === record.courseId && (
    m.id === record.id || (record.memberEmail && m.memberEmail === record.memberEmail)
  )));
  list.unshift(record);
  writeCache(list);
}

/**
 * Teachers can add ANY student, teacher, or person to any course.
 * Token Cost: STRICTLY 0 TOKENS (Free Teacher Grant).
 */
export async function addMemberToCourseFree({
  courseId,
  courseTitle = 'Course',
  memberName = '',
  memberEmail = '',
  memberRole = 'student', // 'student' | 'teacher' | 'guest'
  addedByUid = 'teacher',
  addedByName = 'Course Teacher'
}) {
  if (!courseId) {
    throw new Error('Course ID is required.');
  }

  const cleanEmail = normalizeMemberEmail(memberEmail);
  if (!cleanEmail && !String(memberName || '').trim()) {
    throw new Error('Please provide at least a name or an email address.');
  }
  if (cleanEmail && !isValidMemberEmail(cleanEmail)) {
    throw new Error(`"${memberEmail}" is not a valid email address.`);
  }

  const nowIso = new Date().toISOString();
  const newMemberRecord = buildMemberRecord({ courseId, courseTitle, memberName, memberEmail: cleanEmail, memberRole, addedByUid, addedByName, nowIso });

  // 1. Local cache for instant display
  cacheMember(newMemberRecord);

  // 2. Persist to Firestore if available (idempotent: same email = same document)
  let persisted = false;
  let alreadyEnrolled = false;
  if (db) {
    try {
      const memberRef = doc(db, COURSE_MEMBERS_COLLECTION, newMemberRecord.id);
      const existing = await getDoc(memberRef).catch(() => null);
      alreadyEnrolled = Boolean(existing?.exists?.() && existing.data()?.status !== 'removed');
      await setDoc(memberRef, { ...newMemberRecord, updatedAt: serverTimestamp() }, { merge: true });
      persisted = true;
      if (!alreadyEnrolled) {
        await incrementCourseEnrolments([courseId], 1).catch(err => {
          console.warn('Enrolment counter increment note:', err);
        });
      }
    } catch (dbErr) {
      console.warn('Firestore member persistence warning (cached locally):', dbErr);
    }
  }

  return {
    success: true,
    member: newMemberRecord,
    persisted,
    alreadyEnrolled,
    tokenCost: 0,
    message: alreadyEnrolled
      ? `${newMemberRecord.memberName} is already enrolled in "${courseTitle}".`
      : `🎉 Successfully enrolled ${newMemberRecord.memberName} (${newMemberRecord.memberRole}) into "${courseTitle}" at 0 tokens (Teacher Grant Privilege)!`
  };
}

/**
 * Enrols many people at once (pasted list or spreadsheet). Already-enrolled emails are skipped.
 * @returns {Promise<{ added: number, alreadyEnrolled: string[], failed: string[], persisted: boolean }>}
 */
export async function bulkEnrolMembers({ course, members, memberRole = 'student', addedByUid = 'teacher', addedByName = 'Course Teacher' }) {
  if (!course?.id) throw new Error('Course ID is required.');
  const unique = [];
  const seen = new Set();
  for (const m of Array.isArray(members) ? members : []) {
    const email = normalizeMemberEmail(m?.email);
    if (!isValidMemberEmail(email) || seen.has(email)) continue;
    seen.add(email);
    unique.push({ email, name: m?.name || '' });
  }
  if (!unique.length) throw new Error('No valid email addresses to enrol.');
  if (unique.length > MAX_BULK_MEMBERS) throw new Error(`Enrol at most ${MAX_BULK_MEMBERS.toLocaleString()} people at a time.`);

  const roster = await listCourseMembers(course.id).catch(() => []);
  const enrolled = new Set(roster.map(m => normalizeMemberEmail(m.memberEmail)).filter(Boolean));
  const alreadyEnrolled = unique.filter(m => enrolled.has(m.email)).map(m => m.email);
  const toAdd = unique.filter(m => !enrolled.has(m.email));
  const nowIso = new Date().toISOString();
  const records = toAdd.map(m => buildMemberRecord({
    courseId: course.id,
    courseTitle: course.title,
    memberName: m.name,
    memberEmail: m.email,
    memberRole,
    addedByUid,
    addedByName,
    nowIso
  }));

  records.forEach(cacheMember);

  let persisted = false;
  const failed = [];
  if (db && records.length) {
    let written = 0;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const chunk = records.slice(i, i + BATCH_SIZE);
      try {
        const batch = writeBatch(db);
        for (const record of chunk) {
          batch.set(doc(db, COURSE_MEMBERS_COLLECTION, record.id), { ...record, updatedAt: serverTimestamp() }, { merge: true });
        }
        await batch.commit();
        written += chunk.length;
      } catch (err) {
        console.warn('Bulk enrolment batch failed:', err?.code || err);
        failed.push(...chunk.map(r => r.memberEmail));
      }
    }
    persisted = written > 0;
    if (written > 0) {
      await incrementCourseEnrolments([course.id], written).catch(err => console.warn('Enrolment counter note:', err));
    }
  }

  return { added: records.length - failed.length, alreadyEnrolled, failed, persisted };
}

/**
 * Retrieves all active members of a course (Firestore merged with the local cache)
 */
export async function listCourseMembers(courseId) {
  if (!courseId) return [];

  const cid = String(courseId);
  const localMembers = readCache().filter(m => m.courseId === cid && m.status !== 'removed');

  if (!db) {
    return localMembers;
  }

  try {
    const q = query(collection(db, COURSE_MEMBERS_COLLECTION), where('courseId', '==', cid));
    const snap = await getDocs(q);
    const dbMembers = [];
    snap.forEach(d => dbMembers.push({ id: d.id, ...d.data() }));

    // Merge without duplicates (by email, else id); the database wins over the cache.
    const keyOf = m => (m.memberEmail ? `e:${normalizeMemberEmail(m.memberEmail)}` : `i:${m.id}`);
    const mergedMap = new Map();
    localMembers.forEach(m => mergedMap.set(keyOf(m), m));
    dbMembers.forEach(m => mergedMap.set(keyOf(m), m));

    return Array.from(mergedMap.values()).filter(m => m.status !== 'removed');
  } catch (err) {
    console.warn('Error reading course members from Firestore, using local cache:', err);
    return localMembers;
  }
}

/**
 * Courses the signed-in person is enrolled in, found by their sign-in email.
 * @returns {Promise<Array<{ courseId, courseTitle, memberRole, enrolledAt, addedByName, addedByUid }>>}
 */
export async function listMyEnrolments(email) {
  const me = normalizeMemberEmail(email);
  if (!me) return [];
  const fromCache = readCache().filter(m => m.memberEmail === me && m.status !== 'removed');
  if (!db) return fromCache;
  try {
    const snap = await getDocs(query(collection(db, COURSE_MEMBERS_COLLECTION), where('memberEmail', '==', me)));
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(m => m.status !== 'removed');
    const byCourse = new Map();
    for (const m of list) byCourse.set(String(m.courseId), m);
    return Array.from(byCourse.values());
  } catch (err) {
    console.warn('Could not load enrolments:', err?.code || err);
    return fromCache;
  }
}

/**
 * Removes a member from a course (status change — the record is kept for audit)
 */
export async function removeMemberFromCourse({ courseId, memberId, memberEmail }) {
  if (!courseId) return false;

  const cid = String(courseId);
  const email = normalizeMemberEmail(memberEmail);
  writeCache(readCache().filter(m => !(m.courseId === cid && (m.id === memberId || (email && m.memberEmail === email)))));

  if (db && (memberId || email)) {
    const id = memberId || memberDocId(cid, email);
    try {
      await updateDoc(doc(db, COURSE_MEMBERS_COLLECTION, id), {
        status: 'removed',
        removedAt: new Date().toISOString()
      });
      await incrementCourseEnrolments([courseId], -1).catch(() => {});
    } catch (err) {
      console.warn('Error removing member in Firestore:', err?.code || err);
    }
  }

  return true;
}

/**
 * Records completion of a course for a member/student under tag 'lms'.
 * Updates local member cache, course_members collection, and creates an audit record.
 */
export async function completeMemberCourse({
  courseId,
  memberId,
  memberEmail,
  grade = 'Competent / Completed',
  feedback = 'Course requirements completed successfully.'
}) {
  if (!courseId) {
    throw new Error('courseId is required to record completion.');
  }

  const cid = String(courseId);
  const nowIso = new Date().toISOString();

  // 1. Update local storage cache
  let updatedMember = null;
  const list = readCache();
  const target = list.find(m => m.courseId === cid && (m.id === memberId || (memberEmail && m.memberEmail === memberEmail)));
  if (target) {
    target.status = 'completed';
    target.grade = grade;
    target.feedback = feedback;
    target.completedAt = nowIso;
    target.tag = 'lms';
    updatedMember = target;
    writeCache(list);
  }

  // 2. Persist to Firestore
  if (db) {
    try {
      if (memberId) {
        const mRef = doc(db, COURSE_MEMBERS_COLLECTION, memberId);
        await updateDoc(mRef, {
          status: 'completed',
          grade,
          feedback,
          completedAt: nowIso,
          tag: 'lms'
        }).catch(() => {});
      }

      // Record in lms_course_completions
      const compRef = doc(collection(db, 'lms_course_completions'));
      await setDoc(compRef, {
        courseId: cid,
        memberId: memberId || '',
        memberEmail: memberEmail || '',
        grade,
        feedback,
        completedAt: nowIso,
        tag: 'lms'
      });
    } catch (dbErr) {
      console.warn('Firestore member completion warning:', dbErr);
    }
  }

  return {
    success: true,
    courseId: cid,
    memberId,
    memberEmail,
    grade,
    completedAt: nowIso,
    tag: 'lms',
    member: updatedMember
  };
}
