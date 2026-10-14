/**
 * Unit tests for messaging, enrolment, submissions, tokens, roles, Global Search copies and
 * Stripe verification (no network, no emulator: Firebase is switched off, so nothing reaches the
 * live project; the emulator suites check the database).
 * Run: node tests/lmsFeatures.test.js
 */

import './fixtures/noLiveFirebase.js'; // first: unit tests never reach the live Firebase project
import assert from 'node:assert';
import {
  buildMessage,
  threadIdFor,
  newMessageId,
  groupThreads,
  isUnreadFor,
  defaultCategory,
  MESSAGE_CATEGORIES,
  SUPERADMIN_INBOX,
  MAX_MESSAGE_CHARS,
  loadContacts,
  buildTeacherApplicationMessage,
  buildEnrolmentWelcome,
  sendEnrolmentWelcomes
} from '../src/services/messageService.js';
import {
  parseMemberText,
  parseRosterSheets,
  memberDocId,
  buildMemberRecord,
  isValidMemberEmail
} from '../src/services/courseEnrollmentService.js';
import { subscribeToEnrolledCourses } from '../src/services/enrolledCourses.js';
import { validateSubmission, validateDraftSubmission, submissionDocId, buildSubmissionPayload } from '../src/services/submissionService.js';
import { validateGrantAmount, MAX_GRANT_TOKENS } from '../src/services/tokenService.js';
import { resolvePrivileges, formatTokenBalance, hasUnlimitedTokens, MAX_SUPERADMIN_GRANT, canEnrolInCourses } from '../src/services/rolePrivileges.js';
import { buildCourseCopy, normalizeCourse } from '../src/services/lmsRepository.js';
import { executeContentClone } from '../src/services/courseMarketplaceService.js';
import { checkAiAssistBalance } from '../src/services/aiCourseShared.js';
import { youtubeVideoId } from '../src/services/mediaLinks.js';
import { dataUrlBytes } from '../src/services/imageUtils.js';
import { splitTextLinks } from '../src/services/mediaLinks.js';
import { summarizeStudentProgress } from '../src/services/studentDashboard.js';
import { moveUnitAssessmentsToCourse, upgradeCourseStructure, flattenUnitLessons, createQuizQuestion, createBlankCourse, createBlankUnit, createBlankAssessment, createDefaultRubric, isSampleRubric } from '../src/types/courseBuilderTypes.js';
import {
  extractQuizAnswerKeys,
  stripQuizAnswerKeys,
  mergeQuizAnswerKeys,
  remapQuizAnswerKeys,
  normalizeQuiz,
  cleanQuizAnswers,
  scoreQuizAttempt,
  buildQuizAttemptPayload,
  buildQuizResultUpdate,
  quizAttemptDocId,
  quizResultsTable,
  listCourseQuizzes
} from '../src/services/quizModel.js';
import {
  buildTeacherApplicationPayload,
  validateDocumentUrl,
  isFirestoreSizeError,
  APPLICATION_TEXT_LIMITS
} from '../src/services/teacherApplicationService.js';
import { analyzeIdentificationDocument, sanitizeIdVerification, maskIdNumber, hasVerifiedScore } from '../src/services/idVerificationService.js';
import confirmHandler from '../api/stripe/confirm.js';

const teacher = { uid: 't1', email: 'Teacher@School.edu', displayName: 'Ms T' };
const student = { uid: 's1', email: 'stu@school.edu', displayName: 'Stu' };
const admin = { uid: 'a1', email: 'support@aifoundation.net.au', displayName: 'Admin' };

async function run() {
  console.log('🧪 LMS Features Test Suite\n');

  // 1. Messages: validation, participants, categories
  const toAdmin = buildMessage({ sender: student, senderProfile: { role: 'Supporter' }, to: SUPERADMIN_INBOX, body: '  Hello  ' });
  assert.deepStrictEqual(toAdmin.data.participants, ['stu@school.edu', SUPERADMIN_INBOX]);
  assert.strictEqual(toAdmin.data.category, 'support');
  assert.strictEqual(toAdmin.data.body, 'Hello');
  assert.deepStrictEqual(toAdmin.data.readBy, ['stu@school.edu']);
  const teacherMsg = buildMessage({ sender: teacher, senderProfile: { role: 'teacher' }, to: 'STU@school.edu', body: 'Hi' });
  assert.strictEqual(teacherMsg.data.senderEmail, 'teacher@school.edu', 'emails are lower-cased');
  assert.strictEqual(teacherMsg.data.category, 'teacher');
  assert.strictEqual(buildMessage({ sender: student, senderProfile: { role: 'student' }, to: 'teacher@school.edu', body: 'Hi' }).data.category, 'student');
  const adminReply = buildMessage({ sender: admin, senderProfile: { role: 'Superadmin', email: admin.email }, to: 'stu@school.edu', body: 'Done' });
  assert.deepStrictEqual(adminReply.data.participants, [admin.email, SUPERADMIN_INBOX, 'stu@school.edu'], 'Super Admin replies stay in the shared inbox');
  assert.strictEqual(adminReply.data.threadId, threadIdFor('stu@school.edu', SUPERADMIN_INBOX));
  assert.strictEqual(adminReply.data.category, 'admin');
  assert.throws(() => buildMessage({ sender: student, senderProfile: {}, to: 'stu@school.edu', body: 'me' }), e => e.code === 'INVALID_RECIPIENT');
  assert.throws(() => buildMessage({ sender: student, senderProfile: {}, to: 'not-an-email', body: 'x' }), e => e.code === 'INVALID_RECIPIENT');
  assert.throws(() => buildMessage({ sender: student, senderProfile: {}, to: SUPERADMIN_INBOX, body: '   ' }), e => e.code === 'EMPTY_MESSAGE');
  assert.throws(() => buildMessage({ sender: student, senderProfile: {}, to: SUPERADMIN_INBOX, body: 'x'.repeat(MAX_MESSAGE_CHARS + 1) }), e => e.code === 'MESSAGE_TOO_LONG');
  assert.throws(() => buildMessage({ sender: student, senderProfile: {}, to: SUPERADMIN_INBOX, body: 'x', category: 'grant' }), e => e.code === 'NOT_ALLOWED');
  assert.throws(() => buildMessage({ sender: { email: 'x@y.z' }, senderProfile: {}, to: SUPERADMIN_INBOX, body: 'x' }), e => e.code === 'NOT_SIGNED_IN');
  assert.strictEqual(defaultCategory({ senderProfile: { role: 'teacher' }, toSuperadmin: true }), 'support');
  const colors = new Set(Object.values(MESSAGE_CATEGORIES).map(c => c.color));
  assert.strictEqual(colors.size, Object.keys(MESSAGE_CATEGORIES).length, 'every category has its own colour tag');
  for (const key of ['teacher', 'student', 'application', 'token_request']) assert(MESSAGE_CATEGORIES[key], `${key} category exists`);
  console.log('✅ Test 1 Passed: messages validate senders/recipients and get colour-tagged categories.');

  // 2. Threads: newest-first ids, grouping, unread counts
  assert(newMessageId(2000) < newMessageId(1000), 'newer messages sort first by id');
  assert.strictEqual(threadIdFor('B@x.com', 'a@x.com'), threadIdFor('a@x.com', 'b@x.com'));
  const now = Date.now();
  const inbox = [
    { ...buildMessage({ sender: student, senderProfile: {}, to: 'teacher@school.edu', body: 'Q1', now: now - 3000 }).data, id: 'm1' },
    { ...buildMessage({ sender: teacher, senderProfile: { role: 'teacher' }, to: 'stu@school.edu', body: 'A1', now: now - 2000 }).data, id: 'm2' },
    { ...buildMessage({ sender: student, senderProfile: {}, to: SUPERADMIN_INBOX, body: 'Tokens?', category: 'token_request', now: now - 1000 }).data, id: 'm3' }
  ];
  const studentThreads = groupThreads(inbox, { email: 'stu@school.edu', isSuperadmin: false });
  assert.strictEqual(studentThreads.length, 2);
  assert.strictEqual(studentThreads[0].partnerEmail, SUPERADMIN_INBOX, 'latest conversation first');
  assert.strictEqual(studentThreads[1].partnerName, 'Ms T');
  assert.strictEqual(studentThreads[1].unread, 1, 'teacher reply is unread for the student');
  assert.deepStrictEqual(studentThreads[1].messages.map(m => m.id), ['m1', 'm2'], 'oldest first inside a thread');
  const adminThreads = groupThreads(inbox.filter(m => m.participants.includes(SUPERADMIN_INBOX)), { email: admin.email, isSuperadmin: true });
  assert.strictEqual(adminThreads[0].partnerEmail, 'stu@school.edu');
  assert.strictEqual(adminThreads[0].unread, 1);
  assert(isUnreadFor(inbox[2], admin.email, true));
  assert(!isUnreadFor(inbox[2], 'stu@school.edu', false), 'own message is never unread');
  const contacts = await loadContacts({
    selfEmail: 'teacher@school.edu',
    teachingCourses: [{ id: 'c1', title: 'Bio' }],
    enrolledCourses: [{ id: 'c9', title: 'PD', authorEmail: 'boss@school.edu', authorName: 'Boss' }],
    listMembers: async () => [{ memberEmail: 'Stu@School.edu', memberName: 'Stu', memberRole: 'student' }, { memberEmail: 'teacher@school.edu' }]
  });
  assert.deepStrictEqual(contacts.map(c => c.email), [SUPERADMIN_INBOX, 'boss@school.edu', 'stu@school.edu']);
  assert.deepStrictEqual(contacts[2].courses, [{ id: 'c1', title: 'Bio' }]);

  // Students message a teacher about one of the teacher's courses: one they are in, or a Global Course
  const studentContacts = await loadContacts({
    selfEmail: 'stu@school.edu',
    enrolledCourses: [{ id: 'c1', title: 'Bio', authorEmail: 'teacher@school.edu', authorName: 'Ms T' }],
    networkCourses: [{ id: 'net_c2', title: 'Chemistry', authorEmail: 'chem_teacher@school.edu', authorName: 'Dr C' }, { id: 'net_c3', title: 'Bio 2', authorEmail: 'teacher@school.edu' }],
    registeredTeachers: [{ email: 'math_prof@school.edu', name: 'Prof M' }]
  });
  assert.deepStrictEqual(studentContacts.map(c => c.email), [SUPERADMIN_INBOX, 'teacher@school.edu', 'chem_teacher@school.edu'], 'course teachers first; teachers without a course are not offered');
  assert.deepStrictEqual(studentContacts[1].courses.map(c => c.id), ['c1', 'net_c3'], 'the enrolled course is named first');
  assert.deepStrictEqual(studentContacts[2].courses, [{ id: 'net_c2', title: 'Chemistry' }], 'Global Course teacher comes with that course');
  const staffContacts = await loadContacts({ selfEmail: 'teacher@school.edu', registeredTeachers: [{ email: 'math_prof@school.edu', name: 'Prof M' }], senderIsStaff: true });
  assert(staffContacts.some(c => c.email === 'math_prof@school.edu'), 'staff can message any registered teacher');
  console.log('✅ Test 2 Passed: conversations group correctly with unread counts and permitted contacts.');

  // 3. Bulk enrolment parsing (paste and spreadsheet)
  const pasted = parseMemberText('Jane Doe <Jane@School.edu>\nliam@school.edu, Liam Smith\nmia@x.org; noah@x.org\nbad@\njane@school.edu');
  assert.deepStrictEqual(pasted.members.map(m => m.email), ['jane@school.edu', 'liam@school.edu', 'mia@x.org', 'noah@x.org']);
  assert.strictEqual(pasted.members[0].name, 'Jane Doe');
  assert.strictEqual(pasted.members[1].name, 'Liam Smith');
  assert.deepStrictEqual(pasted.duplicates, ['jane@school.edu']);
  assert.deepStrictEqual(pasted.invalid, ['bad@']);
  const roster = parseRosterSheets([{ name: 'Students', rows: [['Class list'], ['First Name', 'Surname', 'Email Address'], ['Ada', 'Lovelace', 'ADA@x.org'], ['', '', ''], ['Bad', 'Row', 'nope']] }]);
  assert.deepStrictEqual(roster.members, [{ email: 'ada@x.org', name: 'Ada Lovelace' }]);
  assert.deepStrictEqual(roster.invalid, ['nope']);
  const headerless = parseRosterSheets([{ name: 'S', rows: [['a@x.org', 'b@x.org'], ['note: c@x.org']] }]);
  assert.deepStrictEqual(headerless.members.map(m => m.email), ['a@x.org', 'b@x.org', 'c@x.org']);
  assert.strictEqual(memberDocId('c1', 'Jane@School.edu'), 'c1__jane@school.edu');
  const record = buildMemberRecord({ courseId: 'c1', courseTitle: 'Bio', memberEmail: 'Jane@School.edu', memberRole: 'hacker', addedByUid: 't1', nowIso: 'x' });
  assert.strictEqual(record.id, 'c1__jane@school.edu');
  assert.strictEqual(record.memberRole, 'student', 'unknown roles fall back to student');
  assert(!('tokenCost' in record) && !('isFreeTeacherGrant' in record), 'enrolments carry no cost');
  assert(isValidMemberEmail('a.b+c@d.co') && !isValidMemberEmail('a@b'));
  console.log('✅ Test 3 Passed: bulk & spreadsheet enrolment parsing (names, duplicates, invalid emails).');

  // 4. Submissions
  assert.throws(() => validateSubmission({}), e => e.code === 'EMPTY_SUBMISSION');
  assert.throws(() => validateSubmission({ linkUrl: 'javascript:alert(1)' }), e => e.code === 'INVALID_LINK');
  assert.throws(() => validateSubmission({ text: 'x'.repeat(20001) }), e => e.code === 'TOO_LONG');
  assert.deepStrictEqual(validateSubmission({ text: ' answer ', linkUrl: ' https://docs.google.com/x ' }), { text: 'answer', linkUrl: 'https://docs.google.com/x' });
  assert.strictEqual(submissionDocId('c1', 'a1', 's1'), 'c1__a1__s1');

  // Draft submissions validation & payload
  assert.throws(() => validateDraftSubmission({}), e => e.code === 'EMPTY_DRAFT');
  assert.deepStrictEqual(validateDraftSubmission({ text: ' draft notes ' }), { text: 'draft notes', linkUrl: '' });
  const draftPayload = buildSubmissionPayload({ course: { id: 'c1', title: 'Bio', authorId: 't1' }, assessment: { id: 'a1', title: 'Essay' }, unit: null, user: { uid: 's1', email: 'S@x.org' }, text: 'Work in progress', linkUrl: '', isDraft: true });
  assert.strictEqual(draftPayload.status, 'draft');
  assert.strictEqual(draftPayload.isDraft, true);
  assert(Boolean(draftPayload.draftSavedAtIso));

  const payload = buildSubmissionPayload({ course: { id: 'c1', title: 'Bio', authorId: 't1' }, assessment: { id: 'a1', title: 'Essay' }, unit: null, user: { uid: 's1', email: 'S@x.org' }, text: 'Hi', linkUrl: '' });
  assert.strictEqual(payload.studentEmail, 's@x.org');
  assert.strictEqual(payload.status, 'submitted');
  assert.strictEqual(payload.isDraft, false);
  assert(!('grade' in payload), 'students never send grades');
  console.log('✅ Test 4 Passed: submission and draft validation and payloads.');

  // 5. Tokens: Super Admin grants 1–999, UNL display, Super Admin passes
  assert.strictEqual(MAX_GRANT_TOKENS, 999);
  assert.strictEqual(MAX_SUPERADMIN_GRANT, 999);
  assert.strictEqual(validateGrantAmount(999), 999);
  assert.strictEqual(validateGrantAmount('25'), 25);
  for (const bad of [0, 1000, 1.5, -3, 'abc', null]) assert.throws(() => validateGrantAmount(bad), e => e.code === 'INVALID_AMOUNT');
  assert.strictEqual(formatTokenBalance(123, { role: 'superadmin' }), 'UNL');
  assert.strictEqual(formatTokenBalance(123, { role: 'Superadmin' }), 'UNL');
  assert.strictEqual(formatTokenBalance(123, { email: 'support@aifoundation.net.au' }), 'UNL');
  assert.strictEqual(formatTokenBalance(123, { role: 'teacher' }), '123');
  assert.strictEqual(formatTokenBalance(undefined, null), '0');
  assert.strictEqual(hasUnlimitedTokens({ role: 'student' }), false);
  assert.strictEqual(resolvePrivileges(null).role, 'supporter', 'new people are supporters');
  assert.strictEqual(resolvePrivileges({ role: 'teacher' }).isStaff, true);
  assert.strictEqual(resolvePrivileges({ role: 'student' }).isStaff, false);
  assert.strictEqual(resolvePrivileges({ role: 'student' }).canViewDraftCourses, true, 'students can view draft courses');

  // Enrolment authority:
  // "When someone logs in for the first time, they are a supporter. they can only be added to courses by teachers, admin, superadmin, coo, cfo."
  assert.strictEqual(canEnrolInCourses('teacher'), true, 'teachers can add people to courses');
  assert.strictEqual(canEnrolInCourses('admin staff'), true, 'admin staff can add people to courses');
  assert.strictEqual(canEnrolInCourses('admin'), true, 'admin can add people to courses');
  assert.strictEqual(canEnrolInCourses('superadmin'), true, 'superadmin can add people to courses');
  assert.strictEqual(canEnrolInCourses('coo'), true, 'coo can add people to courses');
  assert.strictEqual(canEnrolInCourses('cfo'), true, 'cfo can add people to courses');
  assert.strictEqual(canEnrolInCourses('ceo'), true, 'ceo can add people to courses');

  // Denied enrolment authority:
  assert.strictEqual(canEnrolInCourses('supporter'), false, 'supporters cannot add people to courses');
  assert.strictEqual(canEnrolInCourses('student'), false, 'students cannot add people to courses');
  assert.strictEqual(canEnrolInCourses('financial team'), false, 'general financial team cannot add people to courses');
  assert.strictEqual(canEnrolInCourses(null), false, 'unauthenticated/new users cannot add people to courses');

  const clone = await executeContentClone({ currentUser: { uid: 'a1' }, userProfile: { role: 'superadmin' }, targetAuthorId: 't1', entityId: 'u1', entityTitle: 'Unit' });
  assert.strictEqual(clone.cost, 0);
  assert.strictEqual(clone.superadminPass, true);
  assert.strictEqual((await checkAiAssistBalance({ currentUser: { uid: 'a1' }, userProfile: { role: 'Superadmin' }, costTokens: 10 })).cost, 0);
  assert.strictEqual((await checkAiAssistBalance({ currentUser: { uid: 't1' }, userProfile: { isCharityTeacher: true }, costTokens: 10 })).cost, 0);
  console.log('✅ Test 5 Passed: grants limited to 1–999; Super Admin shows UNL and never pays tokens.');

  // 6. Global Search copies & course ownership persistence
  const source = { id: 'net1', title: 'Reef', authorId: 'other', authorName: 'Other', authorEmail: 'other@x.org', students: 40, siteId: 'siteB', createdAt: 1, publishedAt: 2, isPublished: true, visibility: 'network', tags: ['lms', 'Science'], units: [{ id: 'u1' }] };
  const copy = buildCourseCopy(source, teacher, '2026-10-13T00:00:00.000Z');
  assert.strictEqual(copy.authorId, 't1');
  assert.strictEqual(copy.authorEmail, 'teacher@school.edu');
  assert.strictEqual(copy.isDraft, true);
  assert.strictEqual(copy.visibility, 'site');
  assert.strictEqual(copy.students, 0);
  assert.strictEqual(copy.sourceCourseId, 'net1');
  assert.strictEqual(copy.sourceSiteId, 'siteB');
  assert.strictEqual(copy.copiedAt, '2026-10-13T00:00:00.000Z');
  assert(!('id' in copy) && !('createdAt' in copy) && !('publishedAt' in copy));
  assert(copy.tags.includes('Draft') && copy.tags.includes('Copied'));
  assert.deepStrictEqual(copy.units, [{ id: 'u1' }], 'teaching content is copied');
  const normalized = normalizeCourse({ title: 'X', authorId: 't1', authorEmail: 'T@X.org', aqfEquivalenceNotes: 'UK L5', learningOutcomes: ['A', '', '  ', 'B', 42] });
  assert.strictEqual(normalized.authorId, 't1');
  assert.strictEqual(normalized.authorEmail, 't@x.org');
  assert.strictEqual(normalized.aqfEquivalenceNotes, 'UK L5', 'AQF equivalence notes are now saved');
  assert.deepStrictEqual(normalized.learningOutcomes, ['A', 'B']);
  assert.strictEqual(normalizeCourse({ authorId: 'anonymous' }).authorId, '');
  console.log('✅ Test 6 Passed: Global Search copy keeps lineage & date; ownership and new fields persist.');

  // 7. Stripe verification endpoint (Stripe API mocked)
  const realFetch = globalThis.fetch;
  const realKey = process.env.STRIPE_SECRET_KEY;
  try {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
    let calledUrl = '';
    globalThis.fetch = async (url) => {
      calledUrl = url;
      return { ok: true, status: 200, json: async () => ({ id: 'cs_test_abcdefghijk', payment_status: 'paid', status: 'complete', amount_total: 5000, currency: 'aud', metadata: { donation_type: 'token_purchase', tokens: '50', target_uid: 'u9' } }) };
    };
    const ok = await confirmHandler(new Request('https://ozedu.test/api/stripe/confirm?session_id=cs_test_abcdefghijk'));
    const body = await ok.json();
    assert.strictEqual(ok.status, 200);
    assert(calledUrl.endsWith('/v1/checkout/sessions/cs_test_abcdefghijk'));
    assert.deepStrictEqual([body.paid, body.type, body.tokens, body.targetUid, body.amountTotal, body.currency], [true, 'token_purchase', 50, 'u9', 50, 'AUD']);
    assert.strictEqual((await confirmHandler(new Request('https://ozedu.test/api/stripe/confirm?session_id=evil'))).status, 400, 'session id format checked');
    assert.strictEqual((await confirmHandler(new Request('https://ozedu.test/api/stripe/confirm?session_id=cs_test_abcdefghijk', { method: 'POST' }))).status, 405);
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({ error: { message: 'No such checkout session' } }) });
    assert.strictEqual((await confirmHandler(new Request('https://ozedu.test/api/stripe/confirm?session_id=cs_test_abcdefghijk'))).status, 404);
    delete process.env.STRIPE_SECRET_KEY;
    assert.strictEqual((await confirmHandler(new Request('https://ozedu.test/api/stripe/confirm?session_id=cs_test_abcdefghijk'))).status, 500);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = realKey;
  }
  console.log('✅ Test 7 Passed: Stripe payments are verified server-side before anyone is credited.');

  // 8. Media helpers
  assert.strictEqual(youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), 'dQw4w9WgXcQ');
  assert.strictEqual(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(youtubeVideoId('https://www.youtube.com/shorts/abcDEF12345'), 'abcDEF12345');
  assert.strictEqual(youtubeVideoId('https://evil.example.com/watch?v=dQw4w9WgXcQ'), '');
  assert.strictEqual(youtubeVideoId('javascript:alert(1)'), '');
  assert.strictEqual(dataUrlBytes('data:image/jpeg;base64,' + 'A'.repeat(400)), 300);
  console.log('✅ Test 8 Passed: safe YouTube embeds and image size checks.');

  // 9. Teacher application: optional ID check, a link to the original document, no stored photo
  const docLink = 'https://drive.google.com/file/d/ORIGINAL_ID/view?usp=sharing';
  const appPayload = buildTeacherApplicationPayload({
    applicant_uid: 'u1', applicant_name: '  Tess  ', teaching_bio: 'x'.repeat(9000),
    id_document_preview: 'data:image/jpeg;base64,' + 'A'.repeat(4 * 1024 * 1024), // an old client's full-size photo
    id_document_url: `  ${docLink}  `,
    ai_id_verification: { verified: true, document_type: 'Passport', full_name: 'Tess T', name_match: true, id_number_masked: 'PA1234567', authenticity_assessment: 'Likely Authentic', confidence_score: 140, verification_notes: 'Clear photo.', extra: 'x'.repeat(5000) }
  }, '2026-10-13T00:00:00.000Z');
  assert.strictEqual(appPayload.id, 'app_u1');
  assert.strictEqual(appPayload.applicant_name, 'Tess');
  assert.strictEqual(appPayload.teaching_bio.length, APPLICATION_TEXT_LIMITS.teaching_bio, 'very long text is capped');
  assert(!('id_document_preview' in appPayload), 'the ID photo is never stored (no Firestore size error)');
  assert(JSON.stringify(appPayload).length < 20000, 'an application is small');
  assert.strictEqual(appPayload.id_document_url, docLink);
  assert.strictEqual(appPayload.ai_id_verification.confidence_score, 100, 'confidence is clamped to 0-100');
  assert.strictEqual(appPayload.ai_id_verification.id_number_masked, '****567', 'document numbers are always masked');
  assert(!('extra' in appPayload.ai_id_verification), 'only known AI fields are kept');
  const optional = buildTeacherApplicationPayload({ applicant_uid: 'u2' });
  assert.strictEqual(optional.id_document_url, '');
  assert.strictEqual(optional.ai_id_verification, null, 'the ID section is optional');
  for (const bad of ['http://drive.google.com/x', 'javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'drive.google.com/file', 'https://bad host/x', 'https://localhost/x']) {
    assert.throws(() => validateDocumentUrl(bad), e => e.code === 'ID_DOCUMENT_URL_INVALID', bad);
  }
  assert.strictEqual(validateDocumentUrl(''), '');
  assert(isFirestoreSizeError(new Error('The value of property "id_document_preview" is longer than 1048487 bytes.')));
  assert(isFirestoreSizeError(new Error('Document cannot be written because its size (1,100,000 bytes) exceeds the maximum allowed size of 1,048,576 bytes.')));
  assert(!isFirestoreSizeError(new Error('Missing or insufficient permissions.')));
  // The Super Admin's message carries the details, the AI result and the link — and always fits
  const msg = buildTeacherApplicationMessage({ ...appPayload, teaching_bio: 'Long statement. '.repeat(600) }, { uid: 'u1', email: 'tess@school.edu' });
  assert(msg.body.length <= MAX_MESSAGE_CHARS, 'body fits the 4,000-character limit');
  assert(msg.body.includes(`Original document link: ${docLink}`), 'the document link is in the message');
  assert(msg.body.includes('ID check (AI): Passport • Likely Authentic • 100% confidence'), msg.body.slice(0, 600));
  assert(msg.body.includes('Name on document: Tess T (matches the applicant)'));
  assert(msg.body.includes('(full statement in Teacher Postcards)') && msg.body.endsWith('Teacher Postcards.'), 'long statements are shortened, the review note is kept');
  assert.deepStrictEqual([msg.meta.documentUrl, msg.meta.idConfidence], [docLink, 100]);
  const noCheck = buildTeacherApplicationMessage(optional).body;
  assert(noCheck.includes('ID check (AI): no document was uploaded') && noCheck.includes('Original document link: not provided'));
  const unverified = buildTeacherApplicationMessage({ ...optional, ai_id_verification: { verified: false, confidence_score: null, verification_notes: 'AI unavailable.' } }).body;
  assert(unverified.includes('not verified — manual review needed') && !/\d+% confidence/.test(unverified), 'no score when not verified');
  // Message links are clickable only for http(s)
  assert.deepStrictEqual(splitTextLinks(`See ${docLink}. Thanks`), [{ text: 'See ' }, { text: docLink, href: docLink }, { text: '. Thanks' }]);
  assert.deepStrictEqual(splitTextLinks('(https://en.wikipedia.org/wiki/Coral_(film))').map(p => p.href).filter(Boolean), ['https://en.wikipedia.org/wiki/Coral_(film)']);
  assert(splitTextLinks('javascript:alert(1) data:text/html,hi').every(p => !p.href), 'no unsafe links');
  console.log('✅ Test 9 Passed: optional ID check, document link (no stored photo), and a complete Super Admin message.');

  // 10. AI ID check: real confidence from Gemini, masked numbers, honest "Not verified" otherwise
  const photo = 'data:image/jpeg;base64,' + 'A'.repeat(400);
  const noKey = await analyzeIdentificationDocument(photo, { name: 'Tess' }, { apiKey: '' });
  assert.deepStrictEqual([noKey.verified, noKey.confidence_score, noKey.authenticity_assessment], [false, null, 'Not verified — manual review needed'], 'no made-up score without AI');
  let sentBody = null;
  const geminiOk = async (_url, init) => {
    sentBody = JSON.parse(init.body);
    const result = { document_type: 'Driver Licence', full_name: 'Tess Teacher', name_match: true, id_number_masked: '12345678', issuing_authority: 'NSW', expiry_status: 'Valid', authenticity_assessment: 'Likely Authentic', confidence_score: 91, verification_notes: 'Photo and hologram visible.' };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] }, finishReason: 'STOP' }] }) };
  };
  const checked = await analyzeIdentificationDocument(photo, { name: 'Tess Teacher', email: 'tess@school.edu' }, { apiKey: 'k', models: [{ id: 'm', thinking: null }], fetchImpl: geminiOk });
  assert.deepStrictEqual([checked.verified, checked.confidence_score, checked.id_number_masked, checked.ai_engine], [true, 91, '****678', 'Gemini (m)']);
  assert.deepStrictEqual(sentBody.contents[0].parts[0], { inlineData: { mimeType: 'image/jpeg', data: 'A'.repeat(400) } }, 'the photo is sent to Gemini');
  assert(sentBody.contents[0].parts[1].text.includes('confidence_score: integer 0-100'));
  const geminiDown = async () => ({ ok: false, status: 503, json: async () => ({ error: { code: 503, message: 'overloaded' } }) });
  const down = await analyzeIdentificationDocument(photo, {}, { apiKey: 'k', models: [{ id: 'm', thinking: null }], fetchImpl: geminiDown });
  assert.deepStrictEqual([down.verified, down.confidence_score], [false, null], 'outage -> Not verified, never a fake score');
  assert.strictEqual((await analyzeIdentificationDocument('not an image', {}, { apiKey: 'k' })).verified, false);
  assert.strictEqual(maskIdNumber('AB-12 34'), '****234');
  assert.strictEqual(sanitizeIdVerification({ verified: true, confidence_score: 'abc' }).verified, false, 'no number -> not verified');
  const legacySimulated = { document_type: 'Government Photo Identification', authenticity_assessment: 'Likely Authentic - Valid Digital Copy', confidence_score: 88, ai_engine: 'OzEdu Neural Document Processor (Heuristic Fallback)' };
  assert.strictEqual(hasVerifiedScore(legacySimulated), false, 'old simulated results are not shown as verified');
  assert(buildTeacherApplicationMessage({ ai_id_verification: legacySimulated }).body.includes('not verified — manual review needed'));
  assert.strictEqual(sanitizeIdVerification(legacySimulated).confidence_score, null);
  console.log('✅ Test 10 Passed: AI ID check gives real 0-100 confidence; outages and missing keys say "Not verified".');

  // 11. Student Admin Panel overview + enrolment welcome message
  const dashNow = new Date(2026, 9, 14, 10).getTime(); // 14 Oct 2026
  const dashCourses = [
    { id: 'c1', title: 'Reef', units: [{ unitTitle: 'U1', assessments: [
      { id: 'a1', title: 'Quiz', dueDate: '2026-10-01' },            // overdue
      { id: 'a2', title: 'Essay', dueDate: '2026-10-20', type: 'summative' }, // due soon
      { id: 'a3', title: 'Report', dueDate: '2026-12-01' },          // later
      { id: 'a4', title: 'Done', dueDate: '2026-09-01' }             // submitted
    ] }] },
    { id: 'c2', title: 'Algae', units: [{ assessments: [{ id: 'b1', title: 'Lab' }, { id: 'b2', title: 'Exam', dueDate: 'soon' }] }] },
    null
  ];
  const dash = summarizeStudentProgress(dashCourses, { c1: { a4: { status: 'submitted' } }, c2: { b1: { status: 'graded', grade: 'A' } } }, dashNow);
  assert.deepStrictEqual(dash.stats, { courses: 2, assessments: 6, submitted: 2, graded: 1, overdue: 1, dueSoon: 1, quizzes: 0, quizzesDone: 0 });
  assert.deepStrictEqual(dash.perCourse.c1, { total: 4, submitted: 1, graded: 0, quizzes: 0, quizzesDone: 0 });
  assert.deepStrictEqual(dash.upcoming.map(u => [u.title, u.status]), [['Quiz', 'overdue'], ['Essay', 'due'], ['Report', 'due'], ['Exam', 'due']], 'overdue first, then by date, undated last');
  assert.strictEqual(dash.upcoming[3].dueDate, '', 'invalid dates are treated as no due date');
  assert.deepStrictEqual(summarizeStudentProgress([], {}, dashNow).stats.courses, 0);

  const welcomeMsg = buildEnrolmentWelcome({ course: { title: 'Reef Ecology', startDate: '2026-11-02' }, memberName: 'Stu Dent', memberEmail: 'Stu@School.edu', senderName: 'Ms T' });
  assert.strictEqual(welcomeMsg.subject, 'Welcome to Reef Ecology');
  for (const part of ['Hi Stu, welcome to "Reef Ecology"', 'Ms T has enrolled you', 'starts on 2026-11-02', 'stu@school.edu', 'Student Panel', 'support@aifoundation.net.au']) {
    assert(welcomeMsg.body.includes(part), part);
  }
  assert(!/\n{3,}/.test(welcomeMsg.body));
  const coTeacher = buildEnrolmentWelcome({ course: { title: 'Reef' }, memberEmail: 'x@y.edu', memberRole: 'teacher' }).body;
  assert(coTeacher.includes('Hi there') && coTeacher.includes('co-teacher') && !coTeacher.includes('starts on'));
  // Welcome messages pass message validation for a teacher and for the Super Admin (gold "admin" tag).
  const asTeacher = buildMessage({ sender: teacher, senderProfile: { role: 'teacher' }, to: 'stu@school.edu', ...welcomeMsg });
  assert.strictEqual(asTeacher.data.category, 'teacher');
  const asAdmin = buildMessage({ sender: admin, senderProfile: { role: 'superadmin', email: admin.email }, to: 'stu@school.edu', ...welcomeMsg });
  assert.strictEqual(asAdmin.data.category, 'admin');
  const noRecipients = await sendEnrolmentWelcomes({ sender: teacher, senderProfile: { role: 'teacher' }, course: { id: 'c1' }, members: [{ email: 'not-an-email' }, { email: teacher.email }] });
  assert.deepStrictEqual(noRecipients, { sent: [], failed: [] }, 'invalid emails and the sender are skipped');
  console.log('✅ Test 11 Passed: Student Admin Panel progress, due/overdue list, and enrolment welcome messages.');

  // 12. Supporter-to-student role transition and real-time enrolment subscription
  // When a supporter is not enrolled in courses:
  const supporterPrivileges = resolvePrivileges({ role: 'supporter', email: 'supporter@school.edu' }, 0);
  assert.strictEqual(supporterPrivileges.isStudent, false);
  assert.strictEqual(supporterPrivileges.isSupporter, true);
  assert.strictEqual(supporterPrivileges.role, 'supporter');
  assert.strictEqual(supporterPrivileges.canViewGlobalCourses, true, 'supporters can view global courses');

  // As soon as a teacher adds them to a course, the supporter becomes a student:
  const upgradedPrivileges = resolvePrivileges({ role: 'supporter', email: 'supporter@school.edu' }, 1);
  assert.strictEqual(upgradedPrivileges.isStudent, true, 'supporter becomes student when enrolled');
  assert.strictEqual(upgradedPrivileges.isSupporter, false);
  assert.strictEqual(upgradedPrivileges.role, 'student');
  assert.strictEqual(upgradedPrivileges.classification, 'student');
  assert.strictEqual(upgradedPrivileges.canViewGlobalCourses, true, 'students can view global courses');

  // Teachers keep their staff privileges even when enrolled:
  const teacherEnrolledPrivileges = resolvePrivileges({ role: 'teacher', email: 'teacher@school.edu' }, 1);
  assert.strictEqual(teacherEnrolledPrivileges.isTeacher, true);
  assert.strictEqual(teacherEnrolledPrivileges.isStaff, true);
  assert.strictEqual(teacherEnrolledPrivileges.role, 'teacher');

  // Live Student Panel: the enrolment list and each enrolled course document are followed, so an
  // enrolment or a teacher's saved edit shows without a reload. Fake listeners here; the emulator
  // suite (npm run test:e2e) runs the same flow against the real database.
  {
    const enrolmentFeeds = [];
    const courseFeeds = new Map();
    const listeners = {
      enrolments: (email, onList) => {
        enrolmentFeeds.push(onList);
        return () => {};
      },
      course: (id, onCourse, onError) => {
        const feed = { onCourse, onError, stopped: false };
        courseFeeds.set(id, feed);
        return () => {
          feed.stopped = true;
        };
      }
    };
    const pushEnrolments = list => enrolmentFeeds[0](list);
    const seen = [];
    const stop = subscribeToEnrolledCourses('sam@school.edu', list => seen.push(list), {
      listeners,
      waitMs: 0,
      localCourse: id => (id === 'local1' ? { id: 'local1', title: 'Draft in this browser' } : null)
    });
    pushEnrolments([]);
    assert.deepStrictEqual(seen.at(-1), [], 'not enrolled yet');
    pushEnrolments([{ courseId: 'c1', courseTitle: 'Reef Ecology' }, { courseId: 'c1' }]);
    assert.strictEqual(seen.length, 1, 'waits for the course document');
    courseFeeds.get('c1').onCourse({ id: 'c1', title: 'Reef Ecology', units: [] });
    assert.deepStrictEqual(seen.at(-1).map(c => c.title), ['Reef Ecology'], 'one card per course');
    assert.strictEqual(resolvePrivileges({ role: 'supporter', email: 'sam@school.edu' }, seen.at(-1).length).isStudent, true, 'supporter becomes a student once enrolled');
    // The teacher saves an edit: the new version replaces the old one straight away.
    courseFeeds.get('c1').onCourse({ id: 'c1', title: 'Reef Ecology (2027)', units: [{ id: 'u1' }] });
    assert.deepStrictEqual(seen.at(-1).map(c => [c.title, c.units.length]), [['Reef Ecology (2027)', 1]]);
    // Connection lost later: the last version stays on screen.
    courseFeeds.get('c1').onError(Object.assign(new Error('offline'), { code: 'unavailable' }));
    assert.strictEqual(seen.at(-1)[0].title, 'Reef Ecology (2027)', 'last version kept');
    // Courses that cannot be read fall back to a copy in this browser or a placeholder; archived ones are hidden.
    pushEnrolments([{ courseId: 'c1' }, { courseId: 'local1' }, { courseId: 'gone', courseTitle: 'Old Course', addedByName: 'Ms T' }, { courseId: 'arch' }]);
    courseFeeds.get('local1').onError(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    courseFeeds.get('gone').onCourse(null);
    courseFeeds.get('arch').onCourse({ id: 'arch', title: 'Archived', archived: true });
    assert.deepStrictEqual(seen.at(-1).map(c => c.title), ['Reef Ecology (2027)', 'Draft in this browser', 'Old Course']);
    assert.strictEqual(seen.at(-1)[2].authorName, 'Ms T', 'placeholder keeps the enrolment details');
    // Unenrolled: that course's listener stops; unsubscribing stops the rest.
    pushEnrolments([{ courseId: 'local1' }]);
    assert(courseFeeds.get('c1').stopped, 'listener for a removed enrolment stops');
    assert.deepStrictEqual(seen.at(-1).map(c => c.id), ['local1']);
    stop();
    assert(courseFeeds.get('local1').stopped, 'unsubscribe stops every course listener');
    const before = seen.length;
    courseFeeds.get('local1').onCourse({ id: 'local1', title: 'Late' });
    assert.strictEqual(seen.length, before, 'nothing arrives after unsubscribing');
  }

  // Welcome message generation for the newly enrolled supporter:
  const welcome = buildEnrolmentWelcome({
    course: { title: 'Reef Ecology' },
    memberName: 'Supporter Sam',
    memberEmail: 'sam@school.edu',
    senderName: teacher.displayName
  });
  assert(welcome.subject.includes('Reef Ecology'));
  assert(welcome.body.includes('Ms T has enrolled you in this course'));
  assert(welcome.body.includes('Student Panel'));
  console.log('✅ Test 12 Passed: Supporter becomes student upon enrolment; enrolments and course edits reach the Student Panel live; welcome message.');

  {
    // 13. Course structure & unit quizzes: one course-level assessment list, answer keys kept from students, bulk marking
    const legacyCourse = {
      id: 'c9', title: 'Legacy',
      assessments: [{ id: 'a0', title: 'Course exam' }],
      units: [
        { id: 'u1', unitTitle: 'One', lessons: [], assessments: [{ id: 'a1', title: 'Unit 1 task', nominalWeight: 50 }, { id: 'a0', title: 'Duplicate of course exam' }] },
        { id: 'u2', unitTitle: 'Two', lessons: [], assessments: [{ id: 'a2', title: 'Unit 2 task' }] }
      ]
    };
    const migrated = moveUnitAssessmentsToCourse(legacyCourse);
    assert.deepStrictEqual(migrated.assessments.map(a => [a.id, a.unitId || '']), [['a0', ''], ['a1', 'u1'], ['a2', 'u2']], 'ids kept (submissions stay linked), duplicates skipped');
    assert(migrated.units.every(u => !('assessments' in u)) && legacyCourse.units[0].assessments.length === 2, 'units cleaned; input untouched');
    assert.strictEqual(moveUnitAssessmentsToCourse(migrated), migrated, 'idempotent');
    const blankUnit = createBlankUnit('CRS-100-1', '');
    assert(!('assessments' in blankUnit) && !('lessons' in blankUnit) && blankUnit.content === '' && Array.isArray(blankUnit.blocks),
      'new courses: units hold Unit Content and blocks (no lessons)');
    assert.deepStrictEqual(createBlankCourse('t1').units, [], 'no default units: the teacher clicks + Add Unit to start');
    assert.deepStrictEqual(createBlankCourse('t1').assessments, [], 'no default assessment: the teacher adds every task');
    // Each new task starts with the sample rubric for its type.
    const formativeTask = createBlankAssessment('formative', 'Practice');
    const summativeTask = createBlankAssessment('summative', 'Exam');
    assert.deepStrictEqual(formativeTask.rubric.map(c => c.criterionTitle), ['Understanding of Key Concepts', 'Application in Practice Activities', 'Reflection & Next Steps']);
    assert.deepStrictEqual(summativeTask.rubric.map(c => c.criterionTitle), ['Knowledge Application & Conceptual Understanding', 'Practical Execution & Evidence of Skills', 'Communication & Documentation']);
    for (const task of [formativeTask, summativeTask]) {
      assert.strictEqual(task.rubric.reduce((sum, c) => sum + c.weightPercentage, 0), 100, 'sample weights add up to 100');
      assert(task.rubric.every(c => c.levels.length === 4 && c.levels.every(l => l.descriptor)), 'every level described');
    }
    assert.notStrictEqual(createDefaultRubric('formative')[0].id, formativeTask.rubric[0].id, 'fresh ids for every task');
    assert(isSampleRubric(formativeTask.rubric, 'formative') && !isSampleRubric(formativeTask.rubric, 'summative'));
    assert(!isSampleRubric([{ ...formativeTask.rubric[0], weightPercentage: 41 }, ...formativeTask.rubric.slice(1)], 'formative'), 'an edited rubric is not the sample');

    // Older units (unit -> lessons -> blocks) become unit -> blocks: every block kept in order with its id
    // (quiz keys and attempts stay linked); lesson titles the teacher wrote fill a blank Unit Content.
    const lessonCourse = {
      id: 'c8',
      units: [{
        id: 'u1', unitTitle: 'Coral basics', content: '',
        lessons: [
          { id: 'l1', title: 'Polyps', blocks: [{ id: 'b1', type: 'text_description', order: 0 }, { id: 'qz', type: 'quiz', order: 1 }] },
          { id: 'l2', title: 'Lesson 2', blocks: [{ id: 'b2', type: 'youtube_video', order: 0 }] },
          { id: 'l3', title: 'Bleaching', blocks: [] }
        ],
        assessments: [{ id: 'a7', title: 'Reef task' }]
      }]
    };
    const upgraded = upgradeCourseStructure(lessonCourse);
    assert.deepStrictEqual(upgraded.units[0].blocks.map(b => [b.id, b.order]), [['b1', 0], ['qz', 1], ['b2', 2]], 'blocks flattened in order, ids kept');
    assert.strictEqual(upgraded.units[0].content, 'Polyps\nBleaching', 'teacher lesson titles kept (placeholder titles dropped)');
    assert(!('lessons' in upgraded.units[0]) && 'lessons' in lessonCourse.units[0], 'lessons removed; input untouched');
    assert.deepStrictEqual(upgraded.assessments.map(a => [a.id, a.unitId]), [['a7', 'u1']]);
    assert.strictEqual(upgradeCourseStructure(upgraded), upgraded, 'idempotent');
    assert.strictEqual(flattenUnitLessons({ ...lessonCourse.units[0], content: 'Mine' }).content, 'Mine', 'existing Unit Content is never replaced');

    const mc = { ...createQuizQuestion('multiple_choice'), prompt: 'Primes?' };
    mc.options = [{ id: 'o1', text: '2' }, { id: 'o2', text: '4' }, { id: 'o3', text: '3' }];
    mc.correctOptionIds = ['o1', 'o3'];
    mc.allowMultiple = true;
    mc.points = 2;
    const quizBlock = {
      id: 'quiz1', type: 'quiz', title: 'Check',
      quiz: {
        instructions: 'Go',
        questions: [
          { ...mc, id: 'q1' },
          { id: 'q2', type: 'true_false', prompt: 'Sky green?', points: 1, correctAnswer: false },
          { id: 'q3', type: 'short_answer', prompt: 'Capital of France?', points: 1, acceptedAnswers: ['Paris'] },
          { id: 'q4', type: 'open', prompt: 'Explain.', points: 5, modelAnswer: 'Model' }
        ]
      }
    };
    const quizCourse = { id: 'cq', title: 'Quiz course', authorId: 't1', units: [{ id: 'u1', unitTitle: 'U', content: '', blocks: [quizBlock] }], assessments: [] };
    const keys = extractQuizAnswerKeys(quizCourse);
    assert.deepStrictEqual(keys.quiz1.q1, { correctOptionIds: ['o1', 'o3'] });
    assert.deepStrictEqual(Object.keys(keys.quiz1), ['q1', 'q2', 'q3', 'q4']);
    const stored = normalizeCourse(quizCourse);
    const storedJson = JSON.stringify(stored);
    for (const field of ['correctOptionIds', 'correctAnswer', 'acceptedAnswers', 'modelAnswer']) {
      assert(!storedJson.includes(field), `${field} never stored in the course document students can read`);
    }
    assert.strictEqual(stored.units[0].blocks[0].quiz.questions.length, 4, 'questions themselves are kept');
    const teacherView = mergeQuizAnswerKeys(stripQuizAnswerKeys(quizCourse), keys);
    assert.deepStrictEqual(teacherView.units[0].blocks[0].quiz, quizBlock.quiz, 'teachers get the keys back');
    // An older course that still nests the quiz in a lesson: keys are stripped there too, and saving flattens it.
    const nestedCourse = { ...quizCourse, units: [{ id: 'u1', unitTitle: 'U', lessons: [{ id: 'l1', title: 'L', blocks: [quizBlock] }] }] };
    for (const field of ['correctOptionIds', 'correctAnswer', 'acceptedAnswers', 'modelAnswer']) {
      assert(!JSON.stringify(stripQuizAnswerKeys(nestedCourse)).includes(field), `${field} stripped from lesson blocks too`);
    }
    assert.deepStrictEqual(normalizeCourse(nestedCourse).units[0].blocks.map(b => b.id), ['quiz1'], 'saved with the quiz on the unit');
    assert.deepStrictEqual(Object.keys(remapQuizAnswerKeys(keys, { quiz1: 'quizNew' })), ['quizNew']);

    const studentQuiz = normalizeQuiz(stored.units[0].blocks[0].quiz);
    const answers = { q1: ['o3', 'o1', 'bogus'], q2: false, q3: '  paris. ', q4: 'Because…', extra: 'ignored' };
    assert.deepStrictEqual(cleanQuizAnswers(studentQuiz, answers), { q1: ['o3', 'o1'], q2: false, q3: 'paris.', q4: 'Because…' });
    const payload = buildQuizAttemptPayload({ course: quizCourse, unit: quizCourse.units[0], block: stored.units[0].blocks[0], user: student, answers, nowIso: '2026-10-14T00:00:00.000Z' });
    assert.deepStrictEqual([payload.quizId, payload.unitId, payload.status, payload.questionCount, quizAttemptDocId('cq', 'quiz1', 's1')], ['quiz1', 'u1', 'submitted', 4, 'cq__quiz1__s1']);
    assert(!('lessonId' in payload), 'attempts name the unit (no lessons)');
    assert(!('score' in payload) && !('results' in payload), 'students never write marks');
    assert.throws(() => buildQuizAttemptPayload({ course: quizCourse, block: quizBlock, user: student, answers: {} }), e => e.code === 'EMPTY_ATTEMPT');

    const fullQuiz = quizBlock.quiz; // the teacher's quiz, with keys
    const auto = scoreQuizAttempt(fullQuiz, answers);
    assert.deepStrictEqual([auto.score, auto.maxScore, auto.pending, auto.autoMarked], [4, 9, 1, 3], 'closed questions marked automatically; the open one waits');
    assert.throws(() => buildQuizResultUpdate({ quiz: fullQuiz, attempt: { answers }, grader: teacher }), e => e.code === 'NEEDS_MARKING');
    const marked = scoreQuizAttempt(fullQuiz, answers, { q4: 4, q3: 0 });
    assert.deepStrictEqual([marked.score, marked.percent, marked.pending], [7, 78, 0], 'teacher marks the open answer and can override any mark');
    const update = buildQuizResultUpdate({ quiz: fullQuiz, attempt: { answers }, manualScores: { q4: 4 }, feedback: 'Well done', grader: teacher, nowIso: '2026-10-14T01:00:00.000Z' });
    assert.deepStrictEqual([update.status, update.score, update.maxScore, update.percent, update.grade, update.feedback], ['graded', 8, 9, 89, '89%', 'Well done']);
    assert.deepStrictEqual(update.results.map(r => [r.questionId, r.correct]), [['q1', true], ['q2', true], ['q3', true], ['q4', false]]);
    const wrong = scoreQuizAttempt(fullQuiz, { q1: ['o1'], q2: true });
    assert.deepStrictEqual(wrong.results.map(r => r.earned), [0, 0, 0, 0], 'partly right multiple choice, wrong and unanswered questions score 0');
    assert.strictEqual(scoreQuizAttempt(studentQuiz, answers).pending, 4, 'without answer keys nothing is marked automatically');
    const table = quizResultsTable(fullQuiz, [{ id: 'x', studentName: 'Stu', studentEmail: 'stu@school.edu', answers, status: 'submitted' }], { x: { q4: 5 } });
    assert.deepStrictEqual(table.header, ['Student', 'Email', 'Status', 'Q1 (2)', 'Q2 (1)', 'Q3 (1)', 'Q4 (5)', 'Score', 'Out of', '%']);
    assert.deepStrictEqual(table.rows[0], ['Stu', 'stu@school.edu', 'Ready to release', 2, 1, 1, 5, 9, 9, 100]);
    assert.deepStrictEqual(listCourseQuizzes(quizCourse).map(q => q.block.id), ['quiz1']);
    const withQuizzes = summarizeStudentProgress([quizCourse], {}, Date.now(), { cq: { quiz1: { status: 'submitted' } } });
    assert.deepStrictEqual([withQuizzes.stats.quizzes, withQuizzes.stats.quizzesDone], [1, 1], 'quiz progress shows in the Student Panel');
    console.log('✅ Test 13 Passed: one course assessment list (migrated), quiz keys hidden from students, auto + bulk marking.');
  }

  console.log('\n🎉 All LMS feature tests passed (13/13).');
}

run().then(() => process.exit(0)).catch(err => {
  console.error('❌ Test failure:', err);
  process.exit(1);
});
