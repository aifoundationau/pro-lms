/**
 * Teacher Postcard Application & Approval Service for Pro-LMS
 * Manages applicant submission with AI-extracted ID data and Super Admin evaluation
 */

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy
} from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Submits a new Teacher Application with Postcard details and AI-extracted ID data
 */
export async function submitTeacherApplication(applicationData) {
  if (!db) throw new Error('Database is unavailable.');
  if (!applicationData.applicant_uid) throw new Error('Applicant UID is required.');

  const nowIso = new Date().toISOString();
  const applicationId = `app_${applicationData.applicant_uid}`;
  const appRef = doc(db, 'teacher_applications', applicationId);

  const payload = {
    id: applicationId,
    applicant_uid: applicationData.applicant_uid,
    applicant_name: applicationData.applicant_name || 'Applicant',
    applicant_email: applicationData.applicant_email || '',
    subject_specialty: applicationData.subject_specialty || '',
    teaching_bio: applicationData.teaching_bio || '',
    proposed_course_title: applicationData.proposed_course_title || '',
    proposed_token_rate: Number(applicationData.proposed_token_rate) || 10,
    postal_address_text: applicationData.postal_address_text || 'OzEdu Academic Registry, Sydney NSW',
    id_document_preview: applicationData.id_document_preview || '',
    ai_id_verification: applicationData.ai_id_verification || null,
    status: 'pending', // 'pending' | 'approved' | 'rejected'
    submitted_at: nowIso,
    updated_at: nowIso,
    tag: 'lms'
  };

  await setDoc(appRef, payload, { merge: true });

  // Update user profile in /users/{uid} to track pending application state
  const userRef = doc(db, 'users', applicationData.applicant_uid);
  await updateDoc(userRef, {
    teacher_application_status: 'pending',
    teacher_application_id: applicationId,
    teacher_application_submitted_at: nowIso
  }).catch(err => console.warn('Could not update user record with application status:', err));

  return payload;
}

/**
 * Loads the current user's teacher application if already submitted
 */
export async function getUserTeacherApplication(uid) {
  if (!db || !uid) return null;
  try {
    const applicationId = `app_${uid}`;
    const appRef = doc(db, 'teacher_applications', applicationId);
    const snap = await getDoc(appRef);
    if (snap.exists()) {
      return snap.data();
    }
  } catch (err) {
    console.warn('Error fetching teacher application for user:', err);
  }
  return null;
}

/**
 * Lists all pending and processed teacher applications for Super Admin review
 */
export async function listAllTeacherApplications(adminUid) {
  if (!db) return [];
  try {
    const appsRef = collection(db, 'teacher_applications');
    const snap = await getDocs(appsRef);
    const list = [];
    snap.forEach(d => list.push(d.data()));
    // Sort newest first
    return list.sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0));
  } catch (err) {
    console.warn('Error loading teacher applications:', err);
    return [];
  }
}

/**
 * Super Admin approves a teacher application and elevates the user's role to 'teacher'
 */
export async function approveTeacherApplication(adminUid, applicationId, applicantUid) {
  if (!db) throw new Error('Database is unavailable.');
  const nowIso = new Date().toISOString();

  // 1. Update application status
  const appRef = doc(db, 'teacher_applications', applicationId);
  await updateDoc(appRef, {
    status: 'approved',
    reviewed_by: adminUid,
    reviewed_at: nowIso
  });

  // 2. Elevate user role to 'teacher'
  const userRef = doc(db, 'users', applicantUid);
  await updateDoc(userRef, {
    role: 'teacher',
    classification: 'teacher',
    teacher_application_status: 'approved',
    role_elevated_at: nowIso,
    role_elevated_by: adminUid
  });

  return true;
}

/**
 * Super Admin rejects a teacher application with feedback
 */
export async function rejectTeacherApplication(adminUid, applicationId, applicantUid, reason = '') {
  if (!db) throw new Error('Database is unavailable.');
  const nowIso = new Date().toISOString();

  const appRef = doc(db, 'teacher_applications', applicationId);
  await updateDoc(appRef, {
    status: 'rejected',
    rejection_reason: reason || 'Application requires additional credentials or documentation.',
    reviewed_by: adminUid,
    reviewed_at: nowIso
  });

  const userRef = doc(db, 'users', applicantUid);
  await updateDoc(userRef, {
    teacher_application_status: 'rejected'
  }).catch(() => {});

  return true;
}
