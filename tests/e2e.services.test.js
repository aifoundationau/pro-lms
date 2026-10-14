/**
 * End-to-end service tests: the app's real service code, signed in as real (emulated) users,
 * against the Firestore + Auth emulators with this repo's firestore.rules enforced.
 *
 * Run:  npm run test:e2e
 *   (= firebase emulators:exec --only firestore,auth --project demo-ozedu-e2e "node tests/e2e.services.test.js")
 */

import assert from 'node:assert';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.log('⏭️  E2E service tests skipped: emulators not running (use `npm run test:e2e`).');
  process.exit(0);
}

// Point the app's Firebase client at the emulator project before any app module loads.
const PROJECT_ID = 'demo-ozedu-e2e';
process.env.VITE_FIREBASE_PROJECT_ID = PROJECT_ID;
process.env.VITE_FIREBASE_API_KEY = 'demo-api-key';
process.env.VITE_FIREBASE_AUTH_DOMAIN = 'localhost';

const { auth } = await import('../src/firebase.js');
const { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } = await import('firebase/auth');
const { doc, getDoc, setDoc, updateDoc, serverTimestamp, setLogLevel, getFirestore, connectFirestoreEmulator, terminate } = await import('firebase/firestore');
const { initializeApp, deleteApp } = await import('firebase/app');
const { getAuth, connectAuthEmulator } = await import('firebase/auth');
const authService = await import('../src/services/authService.js');
const lms = await import('../src/services/lmsRepository.js');
const enrol = await import('../src/services/courseEnrollmentService.js');
const messages = await import('../src/services/messageService.js');
const subs = await import('../src/services/submissionService.js');
const tokens = await import('../src/services/tokenService.js');
const aiTokens = await import('../src/services/aiAssistTokenService.js');
const apps = await import('../src/services/teacherApplicationService.js');
const market = await import('../src/services/courseMarketplaceService.js');
const quizzes = await import('../src/services/quizService.js');
const quizModel = await import('../src/services/quizModel.js');
const enrolledLive = await import('../src/services/enrolledCourses.js');
const { resolvePrivileges } = await import('../src/services/rolePrivileges.js');
const { db } = await import('../src/firebase.js');

setLogLevel('silent'); // expected permission denials are asserted, not logged

const PASSWORD = 'Passw0rd!e2e';
const ACCOUNTS = {
  owner: 'support@aifoundation.net.au',
  teacher: 'teacher.e2e@example.com',
  teacher2: 'teacher2.e2e@example.com',
  student: 'student.e2e@example.com',
  outsider: 'outsider.e2e@example.com'
};
const uids = {};
let steps = 0;

async function step(label, fn) {
  try {
    await fn();
    steps++;
    console.log(`✅ ${label}`);
  } catch (err) {
    console.error(`❌ ${label}`);
    throw err;
  }
}

async function markEmailVerified(uid) {
  const res = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ localId: uid, emailVerified: true })
  });
  if (!res.ok) throw new Error(`Could not verify ${uid}: ${res.status} ${await res.text()}`);
}

async function signInAs(key) {
  if (auth.currentUser) await signOut(auth);
  const cred = await signInWithEmailAndPassword(auth, ACCOUNTS[key], PASSWORD);
  await cred.user.getIdToken(true);
  assert.strictEqual(cred.user.emailVerified, true, 'emulated users are verified like Google accounts');
  return cred.user;
}

/**
 * A second, separately signed-in browser session (for the teacher), so live listeners in the
 * main session keep running as the student while the teacher works.
 */
async function openBrowserAs(key) {
  const app = initializeApp({ projectId: PROJECT_ID, apiKey: 'demo-api-key', authDomain: 'localhost' }, `browser-${key}-${Date.now()}`);
  const browserAuth = getAuth(app);
  connectAuthEmulator(browserAuth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const browserDb = getFirestore(app);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(browserDb, host, Number(port) || 8080);
  const cred = await signInWithEmailAndPassword(browserAuth, ACCOUNTS[key], PASSWORD);
  await cred.user.getIdToken(true);
  return {
    db: browserDb,
    uid: cred.user.uid,
    close: async () => {
      await terminate(browserDb).catch(() => {});
      await deleteApp(app).catch(() => {});
    }
  };
}

/** Waits until check() is true (live listeners deliver asynchronously). */
async function until(check, label, ms = 10000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > ms) throw new Error(`timed out waiting: ${label}`);
    await new Promise(r => setTimeout(r, 50));
  }
}

async function expectCode(promise, code) {
  try {
    await promise;
  } catch (err) {
    assert.strictEqual(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
    return err;
  }
  throw new Error(`expected failure ${code}, but it succeeded`);
}

async function run() {
  console.log('🧪 End-to-end service tests (Firestore + Auth emulators, production rules)\n');

  for (const [key, email] of Object.entries(ACCOUNTS)) {
    const cred = await createUserWithEmailAndPassword(auth, email, PASSWORD);
    uids[key] = cred.user.uid;
    await markEmailVerified(cred.user.uid);
    await signOut(auth);
  }

  // 1. First sign-in: everyone is a Supporter (the owner account is the Super Admin)
  await step('first sign-in creates Supporter profiles (owner = Super Admin)', async () => {
    for (const key of Object.keys(ACCOUNTS)) {
      const user = await signInAs(key);
      await authService.syncUserToFirestore(user);
      const snap = await getDoc(doc(db, 'users', user.uid));
      assert(snap.exists(), `${key} profile saved`);
      // Roles are compared case-insensitively everywhere (rules use .lower()), so either casing is valid.
      const expected = key === 'owner' ? 'superadmin' : 'supporter';
      assert.strictEqual(String(snap.data().role).toLowerCase(), expected);
      assert.strictEqual(String(snap.data().classification).toLowerCase(), expected);
      assert.strictEqual(snap.data().token_balance, 0);
    }
    assert.strictEqual(resolvePrivileges({ role: 'Superadmin', email: ACCOUNTS.owner }).hasUnlimitedTokens, true);
  });

  // 2. Teacher application -> message board -> Super Admin approval
  await step('Teacher Statement & Course Proposal (ID check + document link) arrives on the message board', async () => {
    const user = await signInAs('teacher');
    const documentUrl = 'https://drive.google.com/file/d/E2E_ORIGINAL_ID/view';
    const application = await apps.submitTeacherApplication({
      applicant_uid: user.uid,
      applicant_name: 'Tess Teacher',
      applicant_email: user.email,
      subject_specialty: 'Marine Biology',
      teaching_bio: 'Ten years teaching marine science.',
      proposed_course_title: 'Reef Ecology',
      proposed_token_rate: 0, // a FREE course
      // An old client's full-size photo (~2 MB) is no longer stored, so this cannot hit Firestore's 1 MiB limit.
      id_document_preview: 'data:image/jpeg;base64,' + 'A'.repeat(2 * 1024 * 1024),
      id_document_url: documentUrl,
      ai_id_verification: { verified: true, document_type: 'Passport', full_name: 'Tess Teacher', name_match: true, id_number_masked: 'PA1234567', authenticity_assessment: 'Likely Authentic', confidence_score: 93, verification_notes: 'Clear photo page.' }
    });
    const stored = (await getDoc(doc(db, 'teacher_applications', application.id))).data();
    assert.strictEqual(stored.id_document_url, documentUrl);
    assert.strictEqual(stored.id_document_preview, undefined, 'no photo stored');
    assert.strictEqual(stored.ai_id_verification.id_number_masked, '****567');
    assert.strictEqual(stored.proposed_token_rate, 0, 'a FREE course is stored as 0 tokens, not 10');
    const sent = await messages.postTeacherApplicationMessage({ sender: user, senderProfile: { role: 'Supporter', email: user.email }, application });
    assert.strictEqual(sent.category, 'application');

    const owner = await signInAs('owner');
    const inbox = await messages.fetchInboxOnce({ email: owner.email, isSuperadmin: true });
    const appMsg = inbox.find(m => m.category === 'application');
    assert(appMsg && appMsg.body.includes('Reef Ecology') && appMsg.body.includes('Ten years teaching'), 'application details in the message');
    assert(appMsg.body.includes('Proposed course: Reef Ecology (FREE to enrol)'), 'the price reads FREE on the message board');
    assert(appMsg.body.includes(`Original document link: ${documentUrl}`) && appMsg.body.includes('93% confidence'), 'ID check and link reach the Super Admin');
    assert.strictEqual(appMsg.meta.documentUrl, documentUrl);
    const list = await apps.listAllTeacherApplications(owner.uid);
    const pending = list.find(a => a.applicant_uid === uids.teacher);
    await apps.approveTeacherApplication(owner.uid, pending.id, uids.teacher);
    await authService.updateMemberRole(owner.uid, uids.teacher2, 'teacher');
    assert.strictEqual((await getDoc(doc(db, 'users', uids.teacher))).data().role, 'teacher');
  });

  // 3. Teacher builds and publishes a course, then enrols students (single + bulk)
  const courseId = 'course_e2e_1';
  const course = {
    id: courseId,
    title: 'Reef Ecology',
    category: 'Science',
    // An older-style course: the assessment sits in the unit and moves up to the course on save.
    units: [{
      id: 'u1', unitCode: 'REEF1', unitTitle: 'Coral basics',
      assessments: [{ id: 'a1', title: 'Reef report', type: 'summative', rubric: [] }],
      lessons: [{ id: 'l1', title: 'Polyps', blocks: [{ id: 'quiz1', type: 'quiz', title: 'Polyp quiz', quiz: { instructions: 'Answer all.', questions: [
        { id: 'q1', type: 'multiple_choice', prompt: 'Corals are…', points: 1, allowMultiple: false, options: [{ id: 'o1', text: 'Plants' }, { id: 'o2', text: 'Animals' }], correctOptionIds: ['o2'] },
        { id: 'q2', type: 'true_false', prompt: 'Corals host algae.', points: 1, correctAnswer: true },
        { id: 'q3', type: 'open', prompt: 'Why do corals bleach?', points: 5, modelAnswer: 'Heat stress expels the algae.' }
      ] } }] }]
    }]
  };
  await step('teacher saves & publishes a course; it appears in Global Search', async () => {
    const user = await signInAs('teacher');
    await lms.saveCourse(courseId, { ...course, authorId: user.uid, authorName: 'Tess Teacher', authorEmail: user.email, isPublished: true, status: 'published', visibility: 'network' }, { isNew: true });
    const stored = (await getDoc(doc(db, 'lms_courses', courseId))).data();
    assert(!JSON.stringify(stored).includes('correctOptionIds') && !JSON.stringify(stored).includes('modelAnswer'), 'answer keys never stored in the course document');
    assert.strictEqual(stored.units[0].blocks[0].quiz.questions.length, 3, 'a lesson-shaped course is saved with its blocks on the unit');
    assert(!('assessments' in stored.units[0]) && !('lessons' in stored.units[0]), 'units hold their content & blocks only');
    assert.strictEqual(stored.units[0].content, 'Polyps', 'the old lesson title is kept as Unit Content');
    assert.deepStrictEqual(stored.assessments.map(a => [a.id, a.unitId]), [['a1', 'u1']], 'the unit task moved up to the course (same id)');
    const keys = (await getDoc(doc(db, 'lms_quiz_keys', courseId))).data();
    assert.deepStrictEqual(keys.quizzes.quiz1.q1.correctOptionIds, ['o2'], 'keys saved in the same batch');
    const published = await lms.listNetworkCourses();
    assert(published.some(c => c.id === courseId && c.authorEmail === ACCOUNTS.teacher), 'published course is listed');
  });

  await step('teacher enrols students one at a time and in bulk (idempotent)', async () => {
    const user = await signInAs('teacher');
    const bulk = await enrol.bulkEnrolMembers({
      course,
      members: [{ email: ACCOUNTS.student, name: 'Stu Dent' }, { email: 'STUDENT.E2E@example.com' }, { email: 'class.mate@example.com' }],
      addedByUid: user.uid,
      addedByName: 'Tess'
    });
    assert.strictEqual(bulk.added, 2, 'duplicate emails (any case) are enrolled once');
    assert.strictEqual(bulk.persisted, true);
    // Every newly enrolled person gets a welcome message from the teacher.
    const welcomes = await messages.sendEnrolmentWelcomes({ sender: user, senderProfile: { role: 'teacher', email: user.email }, course, members: bulk.addedMembers });
    assert.deepStrictEqual([welcomes.sent.length, welcomes.failed.length], [2, 0], 'welcome messages sent to both new students');
    const single = await enrol.addMemberToCourseFree({ courseId, courseTitle: course.title, memberEmail: 'guest@example.com', memberRole: 'guest', addedByUid: user.uid });
    assert.strictEqual(single.persisted, true);
    const again = await enrol.addMemberToCourseFree({ courseId, courseTitle: course.title, memberEmail: 'guest@example.com', memberRole: 'guest', addedByUid: user.uid });
    assert.strictEqual(again.alreadyEnrolled, true);
    const roster = await enrol.listCourseMembers(courseId);
    assert.strictEqual(roster.length, 3);
    await enrol.removeMemberFromCourse({ courseId, memberEmail: 'guest@example.com' });
    assert.strictEqual((await enrol.listCourseMembers(courseId)).length, 2, 'removed member hidden (record kept)');
    const counter = (await getDoc(doc(db, 'lms_courses', courseId))).data().students;
    assert.strictEqual(counter, 2, 'enrolment counter matches active members');
    // The Super Admin can enrol people too; their welcome comes from the Super Admin team.
    const owner = await signInAs('owner');
    const byAdmin = await enrol.addMemberToCourseFree({ courseId, courseTitle: course.title, memberEmail: 'admin.added@example.com', memberName: 'Ada Added', addedByUid: owner.uid });
    const adminWelcome = await messages.sendEnrolmentWelcomes({ sender: owner, senderProfile: { role: 'superadmin', email: owner.email }, course, members: [{ email: byAdmin.member.memberEmail, name: byAdmin.member.memberName }] });
    assert.deepStrictEqual(adminWelcome.sent, ['admin.added@example.com']);
    await enrol.removeMemberFromCourse({ courseId, memberEmail: 'admin.added@example.com' });
  });

  // 4. Student panel: sees the course, submits, messages the teacher, asks for tokens
  await step('student sees enrolled course, submits work, messages teacher, requests tokens', async () => {
    const user = await signInAs('student');
    const enrolments = await enrol.listMyEnrolments(user.email);
    assert.deepStrictEqual(enrolments.map(e => e.courseId), [courseId]);
    const myInbox = await messages.fetchInboxOnce({ email: user.email, isSuperadmin: false });
    const welcome = myInbox.find(m => m.meta?.enrolmentWelcome && m.courseId === courseId);
    assert(welcome, 'the student received the enrolment welcome');
    assert(welcome.subject === 'Welcome to Reef Ecology' && welcome.body.includes('Student Panel') && welcome.category === 'teacher', welcome.body);
    const loaded = await lms.getLmsCourseById(courseId);
    assert.strictEqual(loaded.assessments[0].id, 'a1');
    await subs.submitAssessment({ course: loaded, unit: loaded.units[0], assessment: loaded.assessments[0], user, text: 'Coral polyps host zooxanthellae.', linkUrl: 'https://docs.google.com/document/d/abc' });
    const mine = await subs.listMySubmissions(courseId, user.uid);
    assert.strictEqual(mine.a1.status, 'submitted');
    const toTeacher = await messages.sendMessage({ sender: user, senderProfile: { role: 'Supporter', email: user.email }, to: ACCOUNTS.teacher, body: 'Is the report due Friday?', courseId, courseTitle: 'Reef Ecology' });
    assert.strictEqual(toTeacher.category, 'student');
    const request = await messages.requestTokensFromSuperadmin({ sender: user, senderProfile: { role: 'Supporter', email: user.email }, amount: 50, reason: 'Enrol in Reef Ecology' });
    assert.strictEqual(request.meta.tokensRequested, 50);
  });

  await step('outsiders cannot submit to a course they are not in, or message a teacher without naming the teacher\'s course', async () => {
    const user = await signInAs('outsider');
    const loaded = await lms.getLmsCourseById(courseId);
    await expectCode(subs.submitAssessment({ course: loaded, unit: loaded.units[0], assessment: loaded.assessments[0], user, text: 'sneaky' }), 'NOT_ENROLLED');
    await expectCode(messages.sendMessage({ sender: user, senderProfile: { role: 'Supporter', email: user.email }, to: ACCOUNTS.teacher, body: 'hi' }), 'NOT_ALLOWED');
    await expectCode(messages.sendMessage({ sender: user, senderProfile: { role: 'Supporter', email: user.email }, to: ACCOUNTS.teacher2, body: 'hi', courseId }), 'NOT_ALLOWED');
    await expectCode(messages.sendMessage({ sender: user, senderProfile: { role: 'Supporter', email: user.email }, to: ACCOUNTS.student, body: 'hi', courseId }), 'NOT_ALLOWED');
    await messages.sendMessage({ sender: user, senderProfile: { role: 'Supporter', email: user.email }, to: messages.SUPERADMIN_INBOX, body: 'Can I join a course?' });
  });

  // 5. Teacher: live inbox, grading, reply
  await step('teacher inbox is live; teacher grades and replies', async () => {
    const user = await signInAs('teacher');
    const live = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('inbox listener timed out')), 10000);
      const unsubscribe = messages.subscribeToInbox({ email: user.email, isSuperadmin: false }, list => {
        if (list.some(m => m.body === 'Is the report due Friday?')) {
          clearTimeout(timer);
          unsubscribe();
          resolve(list);
        }
      }, err => {
        clearTimeout(timer);
        reject(err);
      });
    });
    const threads = messages.groupThreads(live, { email: user.email, isSuperadmin: false });
    assert.strictEqual(threads[0].unread, 1);
    const submissions = await subs.listCourseSubmissions(courseId);
    assert.strictEqual(submissions.length, 1);
    await subs.gradeSubmission({ submissionId: submissions[0].id, grade: 'HD', feedback: 'Excellent analysis.', grader: user });
    await messages.sendMessage({ sender: user, senderProfile: { role: 'teacher', email: user.email }, to: ACCOUNTS.student, body: 'Yes — Friday 5pm.', courseId });
    await messages.markMessagesRead(live, { email: user.email, isSuperadmin: false });
    const after = messages.groupThreads(await messages.fetchInboxOnce({ email: user.email, isSuperadmin: false }), { email: user.email, isSuperadmin: false });
    assert.strictEqual(after[0].unread, 0, 'read receipts saved');
  });

  await step('student sees the grade and cannot resubmit after grading', async () => {
    const user = await signInAs('student');
    const mine = await subs.listMySubmissions(courseId, user.uid);
    assert.strictEqual(mine.a1.grade, 'HD');
    const loaded = await lms.getLmsCourseById(courseId);
    await expectCode(subs.submitAssessment({ course: loaded, unit: loaded.units[0], assessment: loaded.assessments[0], user, text: 'late edit' }), 'ALREADY_GRADED');
  });

  // 6. Super Admin token grants (1–999, by email, once per Stripe session)
  await step('student takes the unit quiz; answer keys stay hidden', async () => {
    const user = await signInAs('student');
    await assert.rejects(getDoc(doc(db, 'lms_quiz_keys', courseId)), err => err.code === 'permission-denied');
    const loaded = await lms.getLmsCourseById(courseId);
    const block = loaded.units[0].blocks[0];
    assert(!JSON.stringify(block).includes('correctOptionIds'), 'students receive questions without answers');
    const saved = await quizzes.submitQuizAttempt({ course: loaded, unit: loaded.units[0], block, user, answers: { q1: ['o2'], q2: false, q3: 'Warm water stresses them.' } });
    assert.strictEqual(saved.status, 'submitted');
    const mine = await quizzes.listMyQuizAttempts(courseId, user.uid);
    assert.deepStrictEqual(mine.quiz1.answers, { q1: ['o2'], q2: false, q3: 'Warm water stresses them.' });
  });

  await step('teacher bulk-marks the quiz (auto + open answer) and releases results', async () => {
    const user = await signInAs('teacher');
    const attempts = await quizzes.listCourseQuizAttempts(courseId);
    assert.strictEqual(attempts.length, 1);
    const { keys, ok } = await quizzes.loadQuizAnswerKeys(courseId);
    assert(ok);
    const teacherCourse = quizModel.mergeQuizAnswerKeys(await lms.getLmsCourseById(courseId), keys);
    const quiz = teacherCourse.units[0].blocks[0].quiz;
    assert.strictEqual(quizModel.scoreQuizAttempt(quiz, attempts[0].answers).pending, 1, 'open answer waits for the teacher');
    const result = await quizzes.releaseQuizResults({ quiz, attempts, manualScoresByAttempt: { [attempts[0].id]: { q3: 4 } }, feedbackByAttempt: { [attempts[0].id]: 'Good thinking' }, grader: user });
    assert.deepStrictEqual([result.released.length, result.skipped.length, result.failed.length], [1, 0, 0]);
    const student = await signInAs('student');
    const mine = await quizzes.listMyQuizAttempts(courseId, student.uid);
    assert.deepStrictEqual([mine.quiz1.status, mine.quiz1.score, mine.quiz1.maxScore, mine.quiz1.percent, mine.quiz1.feedback], ['graded', 5, 7, 71, 'Good thinking']);
    const loaded = await lms.getLmsCourseById(courseId);
    await expectCode(quizzes.submitQuizAttempt({ course: loaded, unit: loaded.units[0], block: loaded.units[0].blocks[0], user: student, answers: { q1: ['o1'] } }), 'ALREADY_GRADED');
  });

  await step('Super Admin gives tokens by email (limits, unknown email, double-credit guard)', async () => {
    const owner = await signInAs('owner');
    const inbox = await messages.fetchInboxOnce({ email: owner.email, isSuperadmin: true });
    assert(inbox.some(m => m.category === 'token_request' && m.meta?.tokensRequested === 50), 'token request visible');
    assert(inbox.some(m => m.category === 'support' && m.senderEmail === ACCOUNTS.outsider), 'support question visible');
    const grant = await tokens.grantTokensByEmail({ adminUid: owner.uid, email: ACCOUNTS.student, amount: 50, note: 'Welcome' });
    assert.strictEqual(grant.newBalance, 50);
    await messages.notifyTokenGrant({ sender: owner, senderProfile: { role: 'Superadmin', email: owner.email }, recipientEmail: grant.email, recipientName: grant.displayName, amount: 50, newBalance: grant.newBalance });
    await expectCode(tokens.grantTokensByEmail({ adminUid: owner.uid, email: ACCOUNTS.student, amount: 1000 }), 'INVALID_AMOUNT');
    await expectCode(tokens.grantTokensByEmail({ adminUid: owner.uid, email: 'nobody@example.com', amount: 5 }), 'USER_NOT_FOUND');
    await tokens.grantTokensByEmail({ adminUid: owner.uid, email: ACCOUNTS.student, amount: 100, stripeSessionId: 'cs_test_e2eSESSION123456' });
    await expectCode(tokens.grantTokensByEmail({ adminUid: owner.uid, email: ACCOUNTS.student, amount: 100, stripeSessionId: 'cs_test_e2eSESSION123456' }), 'ALREADY_CREDITED');
  });

  await step('student balance: grants arrive, self-credit is blocked, spending works', async () => {
    const user = await signInAs('student');
    assert.strictEqual(await tokens.getUserTokenBalance(user.uid), 150);
    assert.strictEqual(await tokens.creditUserTokens(user.uid, 500), false, 'cannot mint tokens from the browser');
    assert.strictEqual(await tokens.getUserTokenBalance(user.uid), 150);
    const spent = await aiTokens.deductUserTokens(user.uid, 10, { type: 'ai_assist_course' });
    assert.strictEqual(spent.newBalance, 140);
    const clone = await market.executeContentClone({ currentUser: user, userProfile: { role: 'Supporter' }, targetAuthorId: uids.teacher, entityId: 'u1', entityTitle: 'Coral basics' });
    assert.strictEqual(clone.cost, 1);
    assert.strictEqual(await tokens.getUserTokenBalance(user.uid), 139, 'content clone charges exactly 1 token');
    const inbox = await messages.fetchInboxOnce({ email: user.email, isSuperadmin: false });
    assert(inbox.some(m => m.category === 'grant'), 'green grant message received');
    assert(inbox.some(m => m.category === 'teacher' && m.body.startsWith('Yes')), 'teacher reply received');
  });

  // 7. Global Search copy with a record of teacher, copy and date
  await step('another teacher copies the course from Global Search (recorded), cannot edit the original', async () => {
    const user = await signInAs('teacher2');
    const published = (await lms.listNetworkCourses()).find(c => c.id === courseId);
    const { course: copy, record } = await lms.copyCourseForTeacher(published, user);
    const copiedKeys = (await getDoc(doc(db, 'lms_quiz_keys', copy.id))).data();
    assert.deepStrictEqual(copiedKeys.quizzes.quiz1.q3.modelAnswer, 'Heat stress expels the algae.', 'quiz answer keys copied with the course');
    assert.strictEqual(copy.authorId, user.uid);
    assert.strictEqual(copy.isDraft, true);
    assert.strictEqual(copy.sourceCourseId, courseId);
    const saved = await getDoc(doc(db, 'lms_courses', copy.id));
    assert.strictEqual(saved.data().authorEmail, ACCOUNTS.teacher2);
    const audit = await getDoc(doc(db, lms.COURSE_COPIES_COLLECTION, copy.id));
    assert(audit.exists(), 'copy record saved');
    assert.strictEqual(audit.data().teacherUid, user.uid);
    assert.strictEqual(audit.data().sourceCourseId, courseId);
    assert(audit.data().copiedAt, 'copy date recorded');
    assert.strictEqual(record.copyCourseId, copy.id);
    await assert.rejects(lms.saveCourse(courseId, { ...published, title: 'Hijacked' }), err => err.code === 'permission-denied');
  });

  // Live Student Panel: "Contact Teacher to Enrol" -> teacher enrols -> teacher edits the course.
  await step('outsider asks to enrol; the enrolment and the teacher\'s course edits reach their Student Panel live', async () => {
    const outsider = await signInAs('outsider');
    const ask = await messages.sendMessage({ sender: outsider, senderProfile: { role: 'Supporter', email: outsider.email }, to: ACCOUNTS.teacher, subject: 'Enrolment request: Reef Ecology', body: 'Could you enrol me?', courseId, courseTitle: 'Reef Ecology' });
    assert.strictEqual(ask.courseId, courseId, 'the request names the Global Course');

    const updates = [];
    const latest = () => [...updates].reverse().find(Array.isArray) || [];
    const stop = enrolledLive.subscribeToEnrolledCourses(outsider.email, list => updates.push(list), { onError: err => updates.push(err), waitMs: 5000 });
    const teacher = await openBrowserAs('teacher');
    try {
      await until(() => updates.some(Array.isArray), 'first list');
      assert.deepStrictEqual(latest(), [], 'not enrolled yet');
      assert.strictEqual(resolvePrivileges({ role: 'Supporter', email: outsider.email }, latest().length).isStudent, false);

      // The teacher enrols them from their own browser: the course appears without a reload.
      const record = enrol.buildMemberRecord({ courseId, courseTitle: 'Reef Ecology', memberName: 'Owen Outsider', memberEmail: outsider.email, memberRole: 'student', addedByUid: teacher.uid, addedByName: 'Tess', nowIso: new Date().toISOString() });
      await setDoc(doc(teacher.db, 'course_members', record.id), { ...record, updatedAt: serverTimestamp() });
      await until(() => latest().some(c => c.id === courseId && c.title === 'Reef Ecology'), 'enrolment arrives live');
      assert.strictEqual(resolvePrivileges({ role: 'Supporter', email: outsider.email }, latest().length).isStudent, true, 'supporter becomes a student');

      // The teacher edits and saves the course: the open Student Panel gets the new version.
      const current = (await getDoc(doc(teacher.db, 'lms_courses', courseId))).data();
      const units = current.units.map((u, i) => (i === 0 ? { ...u, content: 'Reef zones (updated)' } : u));
      await updateDoc(doc(teacher.db, 'lms_courses', courseId), { title: 'Reef Ecology (2027)', units, updatedAt: serverTimestamp() });
      await until(() => latest().find(c => c.id === courseId)?.title === 'Reef Ecology (2027)', 'course edit arrives live');
      assert.strictEqual(latest().find(c => c.id === courseId).units[0].content, 'Reef zones (updated)', 'Unit Content updated too');
      assert(!updates.some(u => u instanceof Error), 'no listener errors');
    } finally {
      stop();
      await teacher.close();
    }
  });

  console.log(`\n🎉 All end-to-end service checks passed (${steps} scenarios).`);
}

run().then(() => process.exit(0)).catch(err => {
  console.error('❌ E2E failure:', err?.message || err);
  process.exit(1);
});
