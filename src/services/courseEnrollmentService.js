/**
 * Course Enrollment & Roster Service
 *
 * Implements:
 * - Free Teacher Grant: Teachers can add any student, teacher, or external participant
 *   to any course with 0 tokens required.
 * - Firestore integration with 'course_members' collection and local storage fallback.
 * - Atomic increment of course enrollment counters.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
  increment,
  updateDoc
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { incrementCourseEnrolments } from './lmsRepository.js';

const STORAGE_COURSE_MEMBERS_KEY = 'ozedu_course_members_cache';

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

  const cleanEmail = (memberEmail || '').trim().toLowerCase();
  const cleanName = (memberName || '').trim() || (cleanEmail ? cleanEmail.split('@')[0] : 'Participant');

  if (!cleanEmail && !cleanName) {
    throw new Error('Please provide at least a name or an email address.');
  }

  const memberId = `cm_${courseId}_${(cleanEmail || cleanName).replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
  const nowIso = new Date().toISOString();

  const newMemberRecord = {
    id: memberId,
    courseId: String(courseId),
    courseTitle,
    memberName: cleanName,
    memberEmail: cleanEmail,
    memberRole, // 'student' | 'teacher' | 'guest'
    tokenCost: 0, // 0 TOKENS REQUIRED (Free teacher privilege)
    isFreeTeacherGrant: true,
    addedByUid,
    addedByName,
    enrolledAt: nowIso,
    tag: 'lms',
    tags: ['lms', memberRole]
  };

  // 1. Save to local storage cache for instant reactive display
  try {
    const raw = safeGetStorage(STORAGE_COURSE_MEMBERS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    // Avoid duplicate enrollment for the same email in the same course
    const filtered = list.filter(m => !(m.courseId === String(courseId) && m.memberEmail && m.memberEmail === cleanEmail));
    filtered.unshift(newMemberRecord);
    safeSetStorage(STORAGE_COURSE_MEMBERS_KEY, JSON.stringify(filtered));
  } catch (err) {
    console.warn('Local storage member cache note:', err);
  }

  // 2. Persist to Firestore if available
  if (db) {
    try {
      const memberRef = doc(db, 'course_members', memberId);
      await setDoc(memberRef, newMemberRecord);

      // Increment enrollment counter atomically
      await incrementCourseEnrolments([courseId], 1).catch(err => {
        console.warn('Enrolment counter increment note:', err);
      });

      // If user exists in 'users' collection, append courseId to their enrolledCourseIds
      if (cleanEmail) {
        try {
          const userQuery = query(collection(db, 'users'), where('email', '==', cleanEmail));
          const snap = await getDocs(userQuery);
          snap.forEach(async (uDoc) => {
            const data = uDoc.data();
            const currentCourses = Array.isArray(data.enrolledCourseIds) ? data.enrolledCourseIds : [];
            if (!currentCourses.includes(String(courseId))) {
              await updateDoc(uDoc.ref, {
                enrolledCourseIds: [...currentCourses, String(courseId)],
                lastEnrolledAt: nowIso
              });
            }
          });
        } catch (uErr) {
          console.warn('User enrolled courses update note:', uErr);
        }
      }
    } catch (dbErr) {
      console.warn('Firestore member persistence warning (cached locally):', dbErr);
    }
  }

  return {
    success: true,
    member: newMemberRecord,
    tokenCost: 0,
    message: `🎉 Successfully enrolled ${cleanName} (${memberRole}) into "${courseTitle}" at 0 tokens (Teacher Grant Privilege)!`
  };
}

/**
 * Retrieves all enrolled members for a specific course
 */
export async function listCourseMembers(courseId) {
  if (!courseId) return [];

  const cid = String(courseId);
  let localMembers = [];

  try {
    const raw = safeGetStorage(STORAGE_COURSE_MEMBERS_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      localMembers = list.filter(m => m.courseId === cid);
    }
  } catch {
    localMembers = [];
  }

  if (!db) {
    return localMembers;
  }

  try {
    const q = query(collection(db, 'course_members'), where('courseId', '==', cid));
    const snap = await getDocs(q);
    const dbMembers = [];
    snap.forEach(d => dbMembers.push({ id: d.id, ...d.data() }));

    // Merge without duplicates by email or id
    const mergedMap = new Map();
    localMembers.forEach(m => mergedMap.set(m.id || m.memberEmail, m));
    dbMembers.forEach(m => mergedMap.set(m.id || m.memberEmail, m));

    return Array.from(mergedMap.values());
  } catch (err) {
    console.warn('Error reading course members from Firestore, using local cache:', err);
    return localMembers;
  }
}

/**
 * Removes a member from a course
 */
export async function removeMemberFromCourse({ courseId, memberId, memberEmail }) {
  if (!courseId) return false;

  const cid = String(courseId);

  // Remove from local storage
  try {
    const raw = safeGetStorage(STORAGE_COURSE_MEMBERS_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      const filtered = list.filter(m => !(m.courseId === cid && (m.id === memberId || (memberEmail && m.memberEmail === memberEmail))));
      safeSetStorage(STORAGE_COURSE_MEMBERS_KEY, JSON.stringify(filtered));
    }
  } catch (err) {
    console.warn('Error updating local member cache:', err);
  }

  // Remove from Firestore
  if (db && memberId) {
    try {
      await deleteDoc(doc(db, 'course_members', memberId));
      await incrementCourseEnrolments([courseId], -1).catch(() => {});
    } catch (err) {
      console.warn('Error deleting member from Firestore:', err);
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
  try {
    const raw = safeGetStorage(STORAGE_COURSE_MEMBERS_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      const target = list.find(m => m.courseId === cid && (m.id === memberId || (memberEmail && m.memberEmail === memberEmail)));
      if (target) {
        target.status = 'completed';
        target.grade = grade;
        target.feedback = feedback;
        target.completedAt = nowIso;
        target.tag = 'lms';
        updatedMember = target;
        safeSetStorage(STORAGE_COURSE_MEMBERS_KEY, JSON.stringify(list));
      }
    }
  } catch (err) {
    console.warn('Local cache member completion note:', err);
  }

  // 2. Persist to Firestore
  if (db) {
    try {
      if (memberId) {
        const mRef = doc(db, 'course_members', memberId);
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
