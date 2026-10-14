/**
 * Firestore security rules verification (runs against the local Firestore emulator).
 *
 * Run:  npm run test:rules
 *   (= firebase emulators:exec --only firestore --project demo-ozedu-rules "node tests/firestoreRules.test.js")
 * Needs Java 11+ for the emulator. Without FIRESTORE_EMULATOR_HOST this suite is skipped.
 */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, writeBatch, arrayUnion, increment, serverTimestamp, limit, setLogLevel
} from 'firebase/firestore';
import { buildMessage, SUPERADMIN_INBOX } from '../src/services/messageService.js';
import { buildMemberRecord, memberDocId } from '../src/services/courseEnrollmentService.js';
import { buildSubmissionPayload, submissionDocId } from '../src/services/submissionService.js';
import { normalizeCourse } from '../src/services/lmsRepository.js';
import { buildQuizKeysDoc, buildQuizAttemptPayload, quizAttemptDocId } from '../src/services/quizModel.js';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.log('⏭️  Firestore rules tests skipped: no emulator running (use `npm run test:rules`).');
  process.exit(0);
}

const PEOPLE = {
  owner: { uid: 'owner', email: 'support@aifoundation.net.au', displayName: 'Owner' },
  admin: { uid: 'sa2', email: 'admin2@example.com', displayName: 'Second Admin' },
  teacherA: { uid: 'teacherA', email: 'teacher.a@example.com', displayName: 'Teacher A' },
  teacherB: { uid: 'teacherB', email: 'teacher.b@example.com', displayName: 'Teacher B' },
  student: { uid: 'stu1', email: 'stu1@example.com', displayName: 'Student One' },
  outsider: { uid: 'stu2', email: 'stu2@example.com', displayName: 'Outsider' }
};
const PROFILES = {
  admin: { role: 'Superadmin', email: PEOPLE.admin.email },
  teacherA: { role: 'teacher', email: PEOPLE.teacherA.email },
  teacherB: { role: 'teacher', email: PEOPLE.teacherB.email },
  student: { role: 'Supporter', email: PEOPLE.student.email },
  outsider: { role: 'Supporter', email: PEOPLE.outsider.email },
  owner: { role: 'Superadmin', email: PEOPLE.owner.email }
};

let passed = 0;
async function check(label, fn) {
  try {
    await fn();
    passed++;
  } catch (err) {
    console.error(`❌ ${label}`);
    throw err;
  }
}

async function run() {
  console.log('🧪 Firestore Security Rules Test Suite (emulator)\n');
  const env = await initializeTestEnvironment({
    projectId: 'demo-ozedu-rules',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') }
  });
  // Denied writes are expected in this suite; keep the SDK quiet about them.
  setLogLevel('silent');
  const instances = new Map();
  const as = key => {
    if (!instances.has(key)) instances.set(key, env.authenticatedContext(PEOPLE[key].uid, { email: PEOPLE[key].email, email_verified: true }).firestore());
    return instances.get(key);
  };
  const anon = env.unauthenticatedContext().firestore();

  try {
    await env.clearFirestore();
    // Seed: profiles, two courses (one legacy/unowned), one enrolment, settings
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'users', 'sa2'), { uid: 'sa2', email: PEOPLE.admin.email, role: 'Superadmin', classification: 'Superadmin', token_balance: 0 });
      await setDoc(doc(db, 'users', 'teacherA'), { uid: 'teacherA', email: PEOPLE.teacherA.email, role: 'teacher', classification: 'teacher', token_balance: 5 });
      await setDoc(doc(db, 'users', 'teacherB'), { uid: 'teacherB', email: PEOPLE.teacherB.email, role: 'teacher', classification: 'teacher', token_balance: 5 });
      await setDoc(doc(db, 'users', 'stu1'), { uid: 'stu1', email: PEOPLE.student.email, role: 'Supporter', classification: 'Supporter', token_balance: 20 });
      await setDoc(doc(db, 'users', 'stu2'), { uid: 'stu2', email: PEOPLE.outsider.email, role: 'Supporter', classification: 'Supporter', token_balance: 0 });
      await setDoc(doc(db, 'lms_courses', 'c1'), { ...normalizeCourse({ title: 'Bio', authorId: 'teacherA', authorEmail: PEOPLE.teacherA.email, authorName: 'Teacher A' }), siteId: 'lms' });
      await setDoc(doc(db, 'lms_courses', 'legacy'), { title: 'Old course', siteId: 'lms', visibility: 'site' });
      // A published Global Course by Teacher B (author email stored with capitals by an older client)
      await setDoc(doc(db, 'lms_courses', 'net1'), { ...normalizeCourse({ title: 'Chemistry', authorId: 'teacherB', authorEmail: PEOPLE.teacherB.email, authorName: 'Teacher B' }), authorEmail: 'Teacher.B@Example.com', visibility: 'network', siteId: 'lms' });
      await setDoc(doc(db, 'course_members', memberDocId('c1', PEOPLE.student.email)), buildMemberRecord({
        courseId: 'c1', courseTitle: 'Bio', memberName: 'Student One', memberEmail: PEOPLE.student.email, memberRole: 'student', addedByUid: 'teacherA', addedByName: 'Teacher A', nowIso: '2026-10-13T00:00:00Z'
      }));
      await setDoc(doc(db, 'system_settings', 'token_config'), { token_price_aud: 1, pool_balance: 100 });
    });

    // ---------- users ----------
    const newUser = env.authenticatedContext('newbie', { email: 'newbie@example.com', email_verified: true }).firestore();
    await check('new Supporter profile', () => assertSucceeds(setDoc(doc(newUser, 'users', 'newbie'), { uid: 'newbie', email: 'newbie@example.com', role: 'Supporter', classification: 'Supporter', token_balance: 0 })));
    await check('no self-made teacher', () => assertFails(setDoc(doc(newUser, 'users', 'newbie2'), { role: 'teacher', classification: 'teacher', token_balance: 0 })));
    const greedy = env.authenticatedContext('greedy', { email: 'greedy@example.com', email_verified: true }).firestore();
    await check('no starting tokens', () => assertFails(setDoc(doc(greedy, 'users', 'greedy'), { role: 'Supporter', classification: 'Supporter', token_balance: 500 })));
    await check('no self Charity Pass at signup', () => assertFails(setDoc(doc(greedy, 'users', 'greedy'), { role: 'Supporter', classification: 'Supporter', token_balance: 0, isCharityTeacher: true })));
    await check('owner registers as Superadmin', () => assertSucceeds(setDoc(doc(as('owner'), 'users', 'owner'), { uid: 'owner', email: PEOPLE.owner.email, role: 'Superadmin', classification: 'Superadmin', token_balance: 0 })));
    await check('others cannot register as Superadmin', () => assertFails(setDoc(doc(greedy, 'users', 'greedy'), { role: 'Superadmin', classification: 'Superadmin', token_balance: 0 })));
    await check('student cannot add tokens to self', () => assertFails(updateDoc(doc(as('student'), 'users', 'stu1'), { token_balance: 999 })));
    await check('student can spend tokens', () => assertSucceeds(updateDoc(doc(as('student'), 'users', 'stu1'), { token_balance: 10 })));
    await check('student cannot self-grant Charity Pass', () => assertFails(updateDoc(doc(as('student'), 'users', 'stu1'), { isCharityTeacher: true })));
    await check('student cannot change role', () => assertFails(updateDoc(doc(as('student'), 'users', 'stu1'), { role: 'teacher' })));
    await check('student updates profile', () => assertSucceeds(updateDoc(doc(as('student'), 'users', 'stu1'), { displayName: 'Stu', login_count: increment(1) })));
    await check('Super Admin gives tokens', () => assertSucceeds(updateDoc(doc(as('admin'), 'users', 'stu1'), { token_balance: increment(999) })));
    await check('owner account (email) gives tokens', () => assertSucceeds(updateDoc(doc(as('owner'), 'users', 'stu2'), { token_balance: increment(5) })));
    await check('teacher cannot give tokens', () => assertFails(updateDoc(doc(as('teacherA'), 'users', 'stu2'), { token_balance: increment(5) })));
    await check('Super Admin changes roles', () => assertSucceeds(updateDoc(doc(as('admin'), 'users', 'stu2'), { role: 'student', classification: 'student' })));
    await check('no user deletes', () => assertFails(deleteDoc(doc(as('admin'), 'users', 'stu2'))));
    console.log('✅ users: Supporter signup, no self-elevation or self-credit, Super Admin grants & roles');

    // ---------- courses & copies ----------
    const ownCourse = { ...normalizeCourse({ title: 'Mine', authorId: 'teacherA', authorEmail: PEOPLE.teacherA.email }), siteId: 'lms' };
    await check('teacher creates own course', () => assertSucceeds(setDoc(doc(as('teacherA'), 'lms_courses', 'c2'), ownCourse)));
    await check('teacher cannot create a course for someone else', () => assertFails(setDoc(doc(as('teacherA'), 'lms_courses', 'c3'), { ...ownCourse, authorId: 'teacherB' })));
    await check('students cannot create courses', () => assertFails(setDoc(doc(as('student'), 'lms_courses', 'c4'), { ...ownCourse, authorId: 'stu1' })));
    await check('owner edits course', () => assertSucceeds(setDoc(doc(as('teacherA'), 'lms_courses', 'c1'), { title: 'Bio 2' }, { merge: true })));
    await check('other teacher cannot edit', () => assertFails(setDoc(doc(as('teacherB'), 'lms_courses', 'c1'), { title: 'Hijack' }, { merge: true })));
    await check('owner cannot give the course away', () => assertFails(updateDoc(doc(as('teacherA'), 'lms_courses', 'c1'), { authorId: 'teacherB' })));
    await check('teacher claims a legacy course on save', () => assertSucceeds(setDoc(doc(as('teacherB'), 'lms_courses', 'legacy'), { authorId: 'teacherB', title: 'Old course' }, { merge: true })));
    await check('claimed course is now protected', () => assertFails(setDoc(doc(as('teacherA'), 'lms_courses', 'legacy'), { title: 'x' }, { merge: true })));
    await check('Super Admin edits any course', () => assertSucceeds(updateDoc(doc(as('admin'), 'lms_courses', 'c1'), { category: 'Science' })));
    await check('owner bumps student counter', () => assertSucceeds(updateDoc(doc(as('teacherA'), 'lms_courses', 'c1'), { students: increment(1), updatedAt: serverTimestamp() })));
    await check('no course deletes', () => assertFails(deleteDoc(doc(as('admin'), 'lms_courses', 'c1'))));
    await check('students can read courses', () => assertSucceeds(getDoc(doc(as('student'), 'lms_courses', 'c1'))));
    const copyRecord = { sourceCourseId: 'net1', sourceTitle: 'Net', copyCourseId: 'copy1', copyTitle: 'Net', teacherUid: 'teacherB', teacherEmail: PEOPLE.teacherB.email, copiedAtIso: '2026-10-13', copiedAt: serverTimestamp(), tag: 'lms' };
    await check('teacher records a Global Search copy', () => assertSucceeds(setDoc(doc(as('teacherB'), 'course_copies', 'copy1'), copyRecord)));
    await check('copy record must be the teacher\'s own', () => assertFails(setDoc(doc(as('teacherA'), 'course_copies', 'copy2'), { ...copyRecord, copyCourseId: 'copy2' })));
    await check('copy records are immutable', () => assertFails(updateDoc(doc(as('teacherB'), 'course_copies', 'copy1'), { copyTitle: 'x' })));
    await check('students cannot read copy records', () => assertFails(getDoc(doc(as('student'), 'course_copies', 'copy1'))));
    console.log('✅ courses: owner-only edits, legacy claim, Super Admin override, copy records (teacher, copy, date)');

    // ---------- rosters ----------
    const member = email => buildMemberRecord({ courseId: 'c1', courseTitle: 'Bio', memberName: '', memberEmail: email, memberRole: 'student', addedByUid: 'teacherA', addedByName: 'Teacher A', nowIso: '2026-10-13T00:00:00Z' });
    await check('owner enrols a student', () => assertSucceeds(setDoc(doc(as('teacherA'), 'course_members', memberDocId('c1', 'new@example.com')), member('new@example.com'))));
    await check('member id must match course + email', () => assertFails(setDoc(doc(as('teacherA'), 'course_members', 'c1__someone-else@example.com'), member('new2@example.com'))));
    await check('other teacher cannot enrol into c1', () => assertFails(setDoc(doc(as('teacherB'), 'course_members', memberDocId('c1', 'x@example.com')), member('x@example.com'))));
    await check('students cannot enrol themselves', () => assertFails(setDoc(doc(as('outsider'), 'course_members', memberDocId('c1', PEOPLE.outsider.email)), member(PEOPLE.outsider.email))));
    await check('bulk enrolment batch', () => {
      const batch = writeBatch(as('teacherA'));
      for (const e of ['b1@example.com', 'b2@example.com', 'b3@example.com']) batch.set(doc(as('teacherA'), 'course_members', memberDocId('c1', e)), member(e), { merge: true });
      return assertSucceeds(batch.commit());
    });
    await check('student lists own enrolments by email', async () => {
      const snap = await assertSucceeds(getDocs(query(collection(as('student'), 'course_members'), where('memberEmail', '==', PEOPLE.student.email))));
      assert.strictEqual(snap.size, 1);
    });
    await check('student cannot list a course roster', () => assertFails(getDocs(query(collection(as('student'), 'course_members'), where('courseId', '==', 'c1')))));
    await check('teacher lists the roster', () => assertSucceeds(getDocs(query(collection(as('teacherA'), 'course_members'), where('courseId', '==', 'c1')))));
    await check('removal is a status change', () => assertSucceeds(updateDoc(doc(as('teacherA'), 'course_members', memberDocId('c1', 'b3@example.com')), { status: 'removed' })));
    await check('no roster deletes', () => assertFails(deleteDoc(doc(as('teacherA'), 'course_members', memberDocId('c1', 'b2@example.com')))));
    console.log('✅ rosters: owner enrols (single & bulk), deterministic ids, students see only their own');

    // ---------- submissions ----------
    const course = { id: 'c1', title: 'Bio', authorId: 'teacherA' };
    const assessment = { id: 'a1', title: 'Essay' };
    const subId = submissionDocId('c1', 'a1', 'stu1');
    const submission = { ...buildSubmissionPayload({ course, assessment, unit: { id: 'u1', unitTitle: 'Cells' }, user: PEOPLE.student, text: 'My answer', linkUrl: '' }), submittedAt: serverTimestamp(), attempts: increment(1) };
    await check('student reads missing submission', () => assertSucceeds(getDoc(doc(as('student'), 'lms_coursework', subId))));
    await check('enrolled student submits', () => assertSucceeds(setDoc(doc(as('student'), 'lms_coursework', subId), submission, { merge: true })));
    await check('student resubmits', () => assertSucceeds(setDoc(doc(as('student'), 'lms_coursework', subId), { ...submission, text: 'Better answer' }, { merge: true })));
    await check('student cannot self-grade', () => assertFails(updateDoc(doc(as('student'), 'lms_coursework', subId), { grade: 'HD' })));
    const outsiderSub = { ...buildSubmissionPayload({ course, assessment, unit: null, user: PEOPLE.outsider, text: 'x', linkUrl: '' }), submittedAt: serverTimestamp() };
    await check('non-enrolled cannot submit', () => assertFails(setDoc(doc(as('outsider'), 'lms_coursework', submissionDocId('c1', 'a1', 'stu2')), outsiderSub)));
    await check('submission id must be the student\'s own', () => assertFails(setDoc(doc(as('student'), 'lms_coursework', 'c1__a1__someone'), submission)));
    await check('other student cannot read', () => assertFails(getDoc(doc(as('outsider'), 'lms_coursework', subId))));
    await check('student lists own submissions', () => assertSucceeds(getDocs(query(collection(as('student'), 'lms_coursework'), where('studentUid', '==', 'stu1'), where('courseId', '==', 'c1')))));
    await check('teacher lists course submissions', () => assertSucceeds(getDocs(query(collection(as('teacherA'), 'lms_coursework'), where('courseId', '==', 'c1')))));
    await check('teacher grades', () => assertSucceeds(updateDoc(doc(as('teacherA'), 'lms_coursework', subId), { status: 'graded', grade: '85%', feedback: 'Good', gradedAt: serverTimestamp() })));
    await check('no resubmission after grading', () => assertFails(setDoc(doc(as('student'), 'lms_coursework', subId), { ...submission, text: 'late' }, { merge: true })));
    console.log('✅ submissions: enrolled students submit/resubmit, teachers grade, privacy between students');

    // ---------- unit quizzes: answer keys (staff only) and attempts ----------
    const keyDoc = (courseId) => ({ ...buildQuizKeysDoc(courseId, { quiz1: { q1: { correctOptionIds: ['o2'] } } }), siteId: 'lms', updatedAt: serverTimestamp() });
    await check('owner saves quiz answer keys', () => assertSucceeds(setDoc(doc(as('teacherA'), 'lms_quiz_keys', 'c1'), keyDoc('c1'), { merge: true })));
    await check('course + keys in one batch (new course)', () => {
      const batch = writeBatch(as('teacherA'));
      batch.set(doc(as('teacherA'), 'lms_courses', 'cq'), { ...normalizeCourse({ title: 'Quiz course', authorId: 'teacherA' }), siteId: 'lms' });
      batch.set(doc(as('teacherA'), 'lms_quiz_keys', 'cq'), keyDoc('cq'));
      return assertSucceeds(batch.commit());
    });
    await check('keys must name their course', () => assertFails(setDoc(doc(as('teacherA'), 'lms_quiz_keys', 'c2'), keyDoc('c1'))));
    await check('other teacher cannot write keys', () => assertFails(setDoc(doc(as('teacherB'), 'lms_quiz_keys', 'c1'), keyDoc('c1'), { merge: true })));
    await check('students cannot read answer keys', () => assertFails(getDoc(doc(as('student'), 'lms_quiz_keys', 'c1'))));
    await check('students cannot write answer keys', () => assertFails(setDoc(doc(as('student'), 'lms_quiz_keys', 'c1'), keyDoc('c1'), { merge: true })));
    await check('teachers read answer keys (Global Search copies)', () => assertSucceeds(getDoc(doc(as('teacherB'), 'lms_quiz_keys', 'c1'))));
    await check('Super Admin writes keys', () => assertSucceeds(setDoc(doc(as('admin'), 'lms_quiz_keys', 'c1'), keyDoc('c1'), { merge: true })));
    await check('no key deletes', () => assertFails(deleteDoc(doc(as('teacherA'), 'lms_quiz_keys', 'c1'))));

    const quizCourse = { id: 'c1', title: 'Bio', authorId: 'teacherA' };
    const quizBlock = { id: 'quiz1', type: 'quiz', title: 'Check', quiz: { questions: [
      { id: 'q1', type: 'multiple_choice', prompt: 'Pick', points: 1, options: [{ id: 'o1', text: 'A' }, { id: 'o2', text: 'B' }] },
      { id: 'q2', type: 'open', prompt: 'Explain', points: 5 }
    ] } };
    const attemptId = quizAttemptDocId('c1', 'quiz1', 'stu1');
    const attempt = { ...buildQuizAttemptPayload({ course: quizCourse, unit: { id: 'u1', unitTitle: 'Cells' }, block: quizBlock, user: PEOPLE.student, answers: { q1: ['o2'], q2: 'Because' } }), submittedAt: serverTimestamp(), attempts: increment(1) };
    await check('student reads missing attempt', () => assertSucceeds(getDoc(doc(as('student'), 'lms_quiz_attempts', attemptId))));
    await check('enrolled student submits a quiz', () => assertSucceeds(setDoc(doc(as('student'), 'lms_quiz_attempts', attemptId), attempt, { merge: true })));
    await check('student resubmits before release', () => assertSucceeds(setDoc(doc(as('student'), 'lms_quiz_attempts', attemptId), { ...attempt, answers: { q1: ['o1'] } }, { merge: true })));
    await check('student cannot mark their own quiz', () => assertFails(updateDoc(doc(as('student'), 'lms_quiz_attempts', attemptId), { score: 6, percent: 100 })));
    await check('student cannot submit with marks', () => assertFails(setDoc(doc(as('student'), 'lms_quiz_attempts', quizAttemptDocId('c1', 'quiz2', 'stu1')), { ...attempt, quizId: 'quiz2', score: 6 })));
    await check('student cannot release their own results', () => assertFails(updateDoc(doc(as('student'), 'lms_quiz_attempts', attemptId), { status: 'graded' })));
    const outsiderAttempt = { ...buildQuizAttemptPayload({ course: quizCourse, block: quizBlock, user: PEOPLE.outsider, answers: { q1: ['o1'] } }), submittedAt: serverTimestamp() };
    await check('non-enrolled cannot take the quiz', () => assertFails(setDoc(doc(as('outsider'), 'lms_quiz_attempts', quizAttemptDocId('c1', 'quiz1', 'stu2')), outsiderAttempt)));
    await check('attempt id must be the student\'s own', () => assertFails(setDoc(doc(as('student'), 'lms_quiz_attempts', 'c1__quiz1__someone'), attempt)));
    await check('other student cannot read an attempt', () => assertFails(getDoc(doc(as('outsider'), 'lms_quiz_attempts', attemptId))));
    await check('student lists own attempts', () => assertSucceeds(getDocs(query(collection(as('student'), 'lms_quiz_attempts'), where('studentUid', '==', 'stu1'), where('courseId', '==', 'c1')))));
    await check('teacher lists course attempts', () => assertSucceeds(getDocs(query(collection(as('teacherA'), 'lms_quiz_attempts'), where('courseId', '==', 'c1')))));
    await check('teacher releases results in a batch', () => {
      const batch = writeBatch(as('teacherA'));
      batch.update(doc(as('teacherA'), 'lms_quiz_attempts', attemptId), { status: 'graded', score: 5, maxScore: 6, percent: 83, grade: '83%', results: [], gradedAt: serverTimestamp() });
      return assertSucceeds(batch.commit());
    });
    await check('no resubmission after release', () => assertFails(setDoc(doc(as('student'), 'lms_quiz_attempts', attemptId), { ...attempt, answers: { q1: ['o2'] } }, { merge: true })));
    await check('student reads released results', () => assertSucceeds(getDoc(doc(as('student'), 'lms_quiz_attempts', attemptId))));
    await check('no attempt deletes', () => assertFails(deleteDoc(doc(as('teacherA'), 'lms_quiz_attempts', attemptId))));
    console.log('✅ quizzes: answer keys hidden from students, enrolled students submit only answers, teachers release marks');

    // ---------- message board ----------
    const send = (key, args) => {
      const { id, data } = buildMessage({ sender: PEOPLE[key], senderProfile: PROFILES[key], ...args });
      return setDoc(doc(as(key), 'chat_interactions', id), { ...data, createdAt: serverTimestamp() }).then(() => id);
    };
    await check('anyone messages the Super Admin', () => assertSucceeds(send('outsider', { to: SUPERADMIN_INBOX, body: 'Hello admin' })));
    await check('student messages their teacher', () => assertSucceeds(send('student', { to: PEOPLE.teacherA.email, body: 'Question about Bio', courseId: 'c1', courseTitle: 'Bio' })));
    await check('student must name the course', () => assertFails(send('student', { to: PEOPLE.teacherA.email, body: 'Hi' })));
    await check('non-enrolled cannot message the teacher', () => assertFails(send('outsider', { to: PEOPLE.teacherA.email, body: 'Hi', courseId: 'c1' })));
    await check('students cannot message other students', () => assertFails(send('student', { to: PEOPLE.outsider.email, body: 'Hi', courseId: 'c1' })));
    await check('anyone may ask a Global Course teacher about that course', () => assertSucceeds(send('outsider', { to: PEOPLE.teacherB.email, body: 'Could you enrol me?', courseId: 'net1', courseTitle: 'Chemistry' })));
    await check('the named course must be the recipient\'s', () => assertFails(send('outsider', { to: PEOPLE.teacherA.email, body: 'Hi', courseId: 'net1' })));
    await check('a Global Course does not open messages to students', () => assertFails(send('outsider', { to: PEOPLE.student.email, body: 'Hi', courseId: 'net1' })));
    await check('the named course must exist', () => assertFails(send('outsider', { to: PEOPLE.teacherB.email, body: 'Hi', courseId: 'no-such-course' })));
    await check('no course named, no message to a teacher', () => assertFails(send('outsider', { to: PEOPLE.teacherB.email, body: 'Hi' })));
    let teacherMsgId;
    await check('teacher messages a student', async () => {
      teacherMsgId = await assertSucceeds(send('teacherA', { to: PEOPLE.student.email, body: 'Welcome to Bio', courseId: 'c1' }));
    });
    await check('token request', () => assertSucceeds(send('student', { to: SUPERADMIN_INBOX, category: 'token_request', body: 'Please add 50 tokens', meta: { tokensRequested: 50 } })));
    await check('application message', () => assertSucceeds(send('outsider', { to: SUPERADMIN_INBOX, category: 'application', body: 'Teacher Statement & Course Proposal' })));
    await check('Super Admin grant notice', () => assertSucceeds(send('admin', { to: PEOPLE.student.email, category: 'grant', body: '50 tokens added' })));
    await check('Super Admin replies to anyone', () => assertSucceeds(send('owner', { to: PEOPLE.outsider.email, body: 'Approved!' })));
    const forged = buildMessage({ sender: PEOPLE.student, senderProfile: PROFILES.student, to: SUPERADMIN_INBOX, body: 'x' });
    await check('only Super Admin can send grants', () => assertFails(setDoc(doc(as('student'), 'chat_interactions', forged.id), { ...forged.data, category: 'grant' })));
    await check('no sender spoofing', () => assertFails(setDoc(doc(as('student'), 'chat_interactions', forged.id), { ...forged.data, senderEmail: PEOPLE.teacherA.email })));
    await check('no extra participants', () => assertFails(setDoc(doc(as('student'), 'chat_interactions', forged.id), { ...forged.data, participants: [PEOPLE.student.email, SUPERADMIN_INBOX, PEOPLE.outsider.email] })));
    await check('message size limit', () => assertFails(setDoc(doc(as('student'), 'chat_interactions', forged.id), { ...forged.data, body: 'x'.repeat(4001) })));
    await check('participant reads inbox', async () => {
      const snap = await assertSucceeds(getDocs(query(collection(as('student'), 'chat_interactions'), where('participants', 'array-contains', PEOPLE.student.email), limit(300))));
      assert(snap.size >= 3);
    });
    await check('Super Admin reads shared inbox', async () => {
      const snap = await assertSucceeds(getDocs(query(collection(as('admin'), 'chat_interactions'), where('participants', 'array-contains', SUPERADMIN_INBOX))));
      assert(snap.size >= 4);
    });
    await check('others cannot read the Super Admin inbox', () => assertFails(getDocs(query(collection(as('student'), 'chat_interactions'), where('participants', 'array-contains', SUPERADMIN_INBOX)))));
    await check('non-participant cannot read', () => assertFails(getDoc(doc(as('outsider'), 'chat_interactions', teacherMsgId))));
    await check('recipient marks read', () => assertSucceeds(updateDoc(doc(as('student'), 'chat_interactions', teacherMsgId), { readBy: arrayUnion(PEOPLE.student.email) })));
    await check('messages cannot be edited', () => assertFails(updateDoc(doc(as('student'), 'chat_interactions', teacherMsgId), { body: 'edited' })));
    await check('messages cannot be deleted', () => assertFails(deleteDoc(doc(as('admin'), 'chat_interactions', teacherMsgId))));
    await check('signed-out users cannot post', () => assertFails(setDoc(doc(anon, 'chat_interactions', 'x'), forged.data)));
    console.log('✅ message board: permitted senders/recipients, colour categories, inbox privacy, read receipts');

    // ---------- applications, ledgers, payments, settings ----------
    const app = { applicant_uid: 'stu2', applicant_email: PEOPLE.outsider.email, status: 'pending', teaching_bio: 'Bio' };
    await check('applicant submits own application', () => assertSucceeds(setDoc(doc(as('outsider'), 'teacher_applications', 'app_stu2'), app, { merge: true })));
    await check('cannot apply for someone else', () => assertFails(setDoc(doc(as('student'), 'teacher_applications', 'app_stu2'), { ...app, applicant_uid: 'stu1' })));
    await check('cannot self-approve', () => assertFails(setDoc(doc(as('outsider'), 'teacher_applications', 'app_stu2'), { ...app, status: 'approved' }, { merge: true })));
    await check('Super Admin approves', () => assertSucceeds(updateDoc(doc(as('admin'), 'teacher_applications', 'app_stu2'), { status: 'approved' })));
    await check('applications are private', () => assertFails(getDoc(doc(as('student'), 'teacher_applications', 'app_stu2'))));
    await check('spend ledger entry', () => assertSucceeds(setDoc(doc(as('student'), 'token_transactions', 't1'), { student_uid: 'stu1', tokens_spent: 1, type: 'content_clone' })));
    await check('no self-made grant ledger', () => assertFails(setDoc(doc(as('student'), 'token_transactions', 't2'), { student_uid: 'stu1', type: 'superadmin_grant' })));
    await check('Super Admin grant ledger', () => assertSucceeds(setDoc(doc(as('admin'), 'token_transactions', 't3'), { type: 'superadmin_grant', recipient_uid: 'stu1', tokens_granted: 50 })));
    await check('recipient reads own grant', () => assertSucceeds(getDoc(doc(as('student'), 'token_transactions', 't3'))));
    await check('others cannot read ledgers', () => assertFails(getDoc(doc(as('outsider'), 'token_transactions', 't3'))));
    await check('Stripe credit marker by Super Admin', () => assertSucceeds(setDoc(doc(as('admin'), 'stripe_credits', 'cs_test_1'), { tokens: 50 })));
    await check('students cannot mark payments credited', () => assertFails(setDoc(doc(as('student'), 'stripe_credits', 'cs_test_2'), { tokens: 50 })));
    await check('signed-in users read prices', () => assertSucceeds(getDoc(doc(as('student'), 'system_settings', 'token_config'))));
    await check('only Super Admin changes prices', () => assertFails(updateDoc(doc(as('teacherA'), 'system_settings', 'token_config'), { token_price_aud: 0.01 })));
    await check('Super Admin changes prices', () => assertSucceeds(updateDoc(doc(as('admin'), 'system_settings', 'token_config'), { ai_course_assist_cost_tokens: 5 })));
    await check('only Super Admin adds to the fund ledger', () => assertFails(setDoc(doc(as('student'), 'token_donations', 'd1'), { tokens: 50 })));
    console.log('✅ applications, token ledger, Stripe credits, settings');

    console.log(`\n🎉 All Firestore security rules checks passed (${passed}).`);
  } finally {
    await env.cleanup();
  }
}

run().then(() => process.exit(0)).catch(err => {
  console.error('❌ Rules test failure:', err?.message || err);
  process.exit(1);
});
