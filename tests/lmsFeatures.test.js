/**
 * Unit tests for messaging, enrolment, submissions, tokens, roles, Global Search copies and
 * Stripe verification (no network, no emulator).
 * Run: node tests/lmsFeatures.test.js
 */

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
  buildTeacherApplicationMessage
} from '../src/services/messageService.js';
import { parseMemberText, parseRosterSheets, memberDocId, buildMemberRecord, isValidMemberEmail } from '../src/services/courseEnrollmentService.js';
import { validateSubmission, submissionDocId, buildSubmissionPayload } from '../src/services/submissionService.js';
import { validateGrantAmount, MAX_GRANT_TOKENS } from '../src/services/tokenService.js';
import { resolvePrivileges, formatTokenBalance, hasUnlimitedTokens, MAX_SUPERADMIN_GRANT } from '../src/services/rolePrivileges.js';
import { buildCourseCopy, normalizeCourse } from '../src/services/lmsRepository.js';
import { executeContentClone } from '../src/services/courseMarketplaceService.js';
import { checkAiAssistBalance } from '../src/services/aiCourseShared.js';
import { youtubeVideoId } from '../src/services/mediaLinks.js';
import { dataUrlBytes } from '../src/services/imageUtils.js';
import { splitTextLinks } from '../src/services/mediaLinks.js';
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
  assert.strictEqual(record.tokenCost, 0);
  assert(isValidMemberEmail('a.b+c@d.co') && !isValidMemberEmail('a@b'));
  console.log('✅ Test 3 Passed: bulk & spreadsheet enrolment parsing (names, duplicates, invalid emails).');

  // 4. Submissions
  assert.throws(() => validateSubmission({}), e => e.code === 'EMPTY_SUBMISSION');
  assert.throws(() => validateSubmission({ linkUrl: 'javascript:alert(1)' }), e => e.code === 'INVALID_LINK');
  assert.throws(() => validateSubmission({ text: 'x'.repeat(20001) }), e => e.code === 'TOO_LONG');
  assert.deepStrictEqual(validateSubmission({ text: ' answer ', linkUrl: ' https://docs.google.com/x ' }), { text: 'answer', linkUrl: 'https://docs.google.com/x' });
  assert.strictEqual(submissionDocId('c1', 'a1', 's1'), 'c1__a1__s1');
  const payload = buildSubmissionPayload({ course: { id: 'c1', title: 'Bio', authorId: 't1' }, assessment: { id: 'a1', title: 'Essay' }, unit: null, user: { uid: 's1', email: 'S@x.org' }, text: 'Hi', linkUrl: '' });
  assert.strictEqual(payload.studentEmail, 's@x.org');
  assert.strictEqual(payload.status, 'submitted');
  assert(!('grade' in payload), 'students never send grades');
  console.log('✅ Test 4 Passed: submission validation and payloads.');

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

  console.log('\n🎉 All LMS feature tests passed (10/10).');
}

run().then(() => process.exit(0)).catch(err => {
  console.error('❌ Test failure:', err);
  process.exit(1);
});
