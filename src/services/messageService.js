/**
 * OzEdu Message Board (Firestore collection: chat_interactions)
 *
 * Who can message whom:
 * - Anyone signed in -> the Super Admin team (support questions, token requests, teacher applications)
 * - Teachers / staff -> students enrolled in their courses (by email)
 * - Students -> the teachers of courses they are enrolled in
 * - The Super Admin -> anyone (by registered email)
 *
 * Each document is one message. LMS messages carry `kind: 'lms_message'` and `tag: 'lms'` so they
 * coexist with any other documents in chat_interactions. Document ids sort newest-first, so the
 * inbox query needs no composite index. Every category has its own colour tag.
 */

import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  limit,
  arrayUnion
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { resolvePrivileges } from './rolePrivileges.js';
import { hasVerifiedScore } from './idVerificationService.js';

export const CHAT_COLLECTION = 'chat_interactions';
/** Participant marker for the shared Super Admin inbox. */
export const SUPERADMIN_INBOX = 'superadmin';
export const MAX_MESSAGE_CHARS = 4000;
export const MAX_SUBJECT_CHARS = 150;
const INBOX_LIMIT = 300;

export const MESSAGE_CATEGORIES = Object.freeze({
  application: { label: 'Application', icon: '📮', color: '#c084fc', background: 'rgba(168, 85, 247, 0.18)', border: 'rgba(192, 132, 252, 0.55)' },
  token_request: { label: 'Token Request', icon: '🪙', color: '#fbbf24', background: 'rgba(245, 158, 11, 0.18)', border: 'rgba(251, 191, 36, 0.55)' },
  grant: { label: 'Token Grant', icon: '🎁', color: '#4ade80', background: 'rgba(34, 197, 94, 0.16)', border: 'rgba(74, 222, 128, 0.5)' },
  teacher: { label: 'Teacher', icon: '🧑‍🏫', color: '#60a5fa', background: 'rgba(59, 130, 246, 0.18)', border: 'rgba(96, 165, 250, 0.55)' },
  student: { label: 'Student', icon: '🎓', color: '#2dd4bf', background: 'rgba(20, 184, 166, 0.18)', border: 'rgba(45, 212, 191, 0.55)' },
  support: { label: 'Support', icon: '💬', color: '#fb7185', background: 'rgba(244, 63, 94, 0.16)', border: 'rgba(251, 113, 133, 0.5)' },
  admin: { label: 'Super Admin', icon: '🛡️', color: '#facc15', background: 'rgba(234, 179, 8, 0.16)', border: 'rgba(250, 204, 21, 0.5)' }
});

export function categoryMeta(category) {
  return MESSAGE_CATEGORIES[category] || MESSAGE_CATEGORIES.support;
}

const EMAIL_PATTERN = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i;

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function isValidEmail(value) {
  return EMAIL_PATTERN.test(normalizeEmail(value));
}

/** Conversation key: one thread per pair of people, or per person with the Super Admin team. */
export function threadIdFor(emailA, emailB) {
  const a = normalizeEmail(emailA);
  const b = normalizeEmail(emailB);
  if (a === SUPERADMIN_INBOX || b === SUPERADMIN_INBOX) return `admin__${a === SUPERADMIN_INBOX ? b : a}`;
  return `dm__${[a, b].sort().join('__')}`;
}

/** Newest-first sortable document id (Firestore orders by id when a query has no orderBy). */
export function newMessageId(now = Date.now()) {
  const reverse = String(9999999999999 - now).padStart(13, '0');
  return `${reverse}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Category of a message from the sender's role and purpose. */
export function defaultCategory({ senderProfile, toSuperadmin }) {
  const p = resolvePrivileges(senderProfile);
  if (p.isSuperadmin) return 'admin';
  if (toSuperadmin) return 'support';
  return p.isStaff ? 'teacher' : 'student';
}

function messageError(message, code = 'MESSAGE_FAILED') {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Validates and builds a message document (pure; exported for tests).
 * @param {object} args
 * @param {{ uid: string, email: string, displayName?: string }} args.sender
 * @param {object} args.senderProfile Firestore profile (for role)
 * @param {string} args.to recipient email or SUPERADMIN_INBOX
 */
export function buildMessage({ sender, senderProfile, to, toName = '', body, subject = '', category, courseId = '', courseTitle = '', meta = {}, now = Date.now() }) {
  const senderEmail = normalizeEmail(sender?.email);
  if (!sender?.uid || !senderEmail) throw messageError('Please sign in to send messages.', 'NOT_SIGNED_IN');
  const recipient = normalizeEmail(to);
  if (recipient !== SUPERADMIN_INBOX && !isValidEmail(recipient)) throw messageError('Enter a valid recipient email address.', 'INVALID_RECIPIENT');
  if (recipient === senderEmail) throw messageError('You cannot send a message to yourself.', 'INVALID_RECIPIENT');
  const text = String(body ?? '').trim();
  if (!text) throw messageError('Write a message first.', 'EMPTY_MESSAGE');
  if (text.length > MAX_MESSAGE_CHARS) throw messageError(`Messages can be up to ${MAX_MESSAGE_CHARS.toLocaleString()} characters.`, 'MESSAGE_TOO_LONG');

  const privileges = resolvePrivileges(senderProfile);
  const toSuperadmin = recipient === SUPERADMIN_INBOX;
  const finalCategory = MESSAGE_CATEGORIES[category] ? category : defaultCategory({ senderProfile, toSuperadmin });
  if (finalCategory === 'grant' && !privileges.isSuperadmin) throw messageError('Only the Super Admin can send token grants.', 'NOT_ALLOWED');

  // The Super Admin team's replies stay in the shared inbox so every Super Admin sees them.
  const participants = privileges.isSuperadmin && !toSuperadmin
    ? [senderEmail, SUPERADMIN_INBOX, recipient]
    : [senderEmail, recipient];

  return {
    id: newMessageId(now),
    data: {
      kind: 'lms_message',
      tag: 'lms',
      schema: 1,
      threadId: privileges.isSuperadmin && !toSuperadmin ? threadIdFor(recipient, SUPERADMIN_INBOX) : threadIdFor(senderEmail, recipient),
      category: finalCategory,
      senderUid: sender.uid,
      senderEmail,
      senderName: String(sender.displayName || senderEmail.split('@')[0]).slice(0, 120),
      senderRole: privileges.role,
      recipientEmail: recipient,
      recipientName: String(toName || (toSuperadmin ? 'Super Admin' : recipient.split('@')[0])).slice(0, 120),
      participants: Array.from(new Set(participants)),
      courseId: String(courseId || ''),
      courseTitle: String(courseTitle || '').slice(0, 300),
      subject: String(subject || '').trim().slice(0, MAX_SUBJECT_CHARS),
      body: text,
      meta: meta && typeof meta === 'object' ? meta : {},
      readBy: [senderEmail],
      createdAtMs: now
    }
  };
}

/** Sends one message. Returns the stored message (with id). */
export async function sendMessage(args) {
  if (!db) throw messageError('Messaging is unavailable right now (database offline).', 'DB_UNAVAILABLE');
  const { id, data } = buildMessage(args);
  try {
    await setDoc(doc(db, CHAT_COLLECTION, id), { ...data, createdAt: serverTimestamp() });
  } catch (err) {
    if (err?.code === 'permission-denied') {
      throw messageError('You cannot message this person. Teachers can message students in their courses; students can message their teachers; anyone can message the Super Admin.', 'NOT_ALLOWED');
    }
    throw messageError('The message could not be sent. Check your connection and try again.');
  }
  return { id, ...data };
}

function toMessage(snapshot) {
  const data = snapshot.data() || {};
  if (data.kind !== 'lms_message' || typeof data.body !== 'string') return null;
  return {
    id: snapshot.id,
    ...data,
    participants: Array.isArray(data.participants) ? data.participants : [],
    readBy: Array.isArray(data.readBy) ? data.readBy : [],
    createdAtMs: Number(data.createdAtMs) || data.createdAt?.toMillis?.() || 0
  };
}

/**
 * Live inbox for the signed-in user (the Super Admin also gets the shared Super Admin inbox).
 * @returns {() => void} unsubscribe
 */
export function subscribeToInbox({ email, isSuperadmin }, onMessages, onError) {
  const me = normalizeEmail(email);
  if (!db || !me) {
    onMessages([]);
    return () => {};
  }
  const keys = isSuperadmin ? [me, SUPERADMIN_INBOX] : [me];
  const buckets = new Map();
  const emit = () => {
    const merged = new Map();
    for (const list of buckets.values()) for (const m of list) merged.set(m.id, m);
    onMessages(Array.from(merged.values()).sort((a, b) => b.createdAtMs - a.createdAtMs));
  };
  const unsubscribers = keys.map(key => onSnapshot(
    query(collection(db, CHAT_COLLECTION), where('participants', 'array-contains', key), limit(INBOX_LIMIT)),
    snap => {
      buckets.set(key, snap.docs.map(toMessage).filter(Boolean));
      emit();
    },
    err => {
      console.warn('Message board listener error:', err?.code || err);
      onError?.(err?.code === 'permission-denied'
        ? messageError('Messages are not enabled yet: the Super Admin needs to publish the latest Firestore security rules.', 'RULES_NOT_DEPLOYED')
        : messageError('Messages could not be loaded. Check your connection.'));
    }
  ));
  return () => unsubscribers.forEach(unsubscribe => {
    try {
      unsubscribe();
    } catch {
      // already detached
    }
  });
}

/** True when the message is addressed to this user (or to the Super Admin inbox for a Super Admin). */
export function isAddressedTo(message, email, isSuperadmin) {
  const me = normalizeEmail(email);
  return message.recipientEmail === me || (isSuperadmin && message.recipientEmail === SUPERADMIN_INBOX && message.senderEmail !== me);
}

export function isUnreadFor(message, email, isSuperadmin) {
  const me = normalizeEmail(email);
  return isAddressedTo(message, me, isSuperadmin) && !message.readBy.includes(me);
}

/** Groups messages (newest first) into conversations. */
export function groupThreads(messages, { email, isSuperadmin }) {
  const me = normalizeEmail(email);
  const threads = new Map();
  for (const m of messages) {
    if (!threads.has(m.threadId)) {
      const toAdminInbox = m.threadId.startsWith('admin__');
      const partnerEmail = toAdminInbox
        ? (isSuperadmin ? m.threadId.slice('admin__'.length) : SUPERADMIN_INBOX)
        : (m.senderEmail === me ? m.recipientEmail : m.senderEmail);
      const partnerName = partnerEmail === SUPERADMIN_INBOX
        ? 'Super Admin'
        : (m.senderEmail === partnerEmail ? m.senderName : m.recipientName) || partnerEmail;
      threads.set(m.threadId, { threadId: m.threadId, partnerEmail, partnerName, messages: [], categories: new Set(), unread: 0, latest: m, courseTitle: '' });
    }
    const thread = threads.get(m.threadId);
    thread.messages.push(m);
    thread.categories.add(m.category);
    if (!thread.courseTitle && m.courseTitle) thread.courseTitle = m.courseTitle;
    if (isUnreadFor(m, me, isSuperadmin)) thread.unread++;
    // Keep the most descriptive partner name seen in the thread.
    if (thread.partnerEmail !== SUPERADMIN_INBOX && m.senderEmail === thread.partnerEmail && m.senderName) thread.partnerName = m.senderName;
  }
  return Array.from(threads.values())
    .map(t => ({ ...t, categories: Array.from(t.categories), messages: t.messages.slice().sort((a, b) => a.createdAtMs - b.createdAtMs) }))
    .sort((a, b) => b.latest.createdAtMs - a.latest.createdAtMs);
}

/** Marks messages addressed to me as read (best effort). */
export async function markMessagesRead(messages, { email, isSuperadmin }) {
  if (!db) return 0;
  const me = normalizeEmail(email);
  const unread = (messages || []).filter(m => isUnreadFor(m, me, isSuperadmin)).slice(0, 50);
  await Promise.all(unread.map(m => updateDoc(doc(db, CHAT_COLLECTION, m.id), { readBy: arrayUnion(me) })
    .catch(err => console.warn('Mark-read skipped:', err?.code || err))));
  return unread.length;
}

// ---------- purpose-built messages ----------

export function requestTokensFromSuperadmin({ sender, senderProfile, amount, reason = '', meta = {} }) {
  const tokens = Math.floor(Number(amount));
  if (!Number.isInteger(tokens) || tokens < 1 || tokens > 999) {
    return Promise.reject(messageError('Request between 1 and 999 tokens.', 'INVALID_AMOUNT'));
  }
  const note = String(reason || '').trim();
  return sendMessage({
    sender,
    senderProfile,
    to: SUPERADMIN_INBOX,
    category: 'token_request',
    subject: `Token request: ${tokens} tokens`,
    body: `Please add ${tokens} tokens to my account (${normalizeEmail(sender?.email)}).${note ? `\n\nReason: ${note}` : ''}`,
    meta: { ...meta, tokensRequested: tokens, requesterEmail: normalizeEmail(sender?.email), requesterUid: sender?.uid || '' }
  });
}

/** The ID check lines of an application message (AI result, then the link to the original document). */
function idCheckLines(app) {
  const check = app.ai_id_verification;
  const lines = [];
  if (!check) {
    lines.push('ID check (AI): no document was uploaded for checking.');
  } else if (!hasVerifiedScore(check)) {
    lines.push(`ID check (AI): not verified — manual review needed. ${check.verification_notes || ''}`.trim());
  } else {
    const facts = [
      check.document_type,
      check.authenticity_assessment,
      `${check.confidence_score}% confidence`
    ].filter(Boolean).join(' • ');
    lines.push(`ID check (AI): ${facts}`);
    if (check.full_name) {
      const match = check.name_match === true ? 'matches the applicant' : check.name_match === false ? 'does NOT match the applicant' : 'match unknown';
      lines.push(`Name on document: ${check.full_name} (${match})`);
    }
    if (check.id_number_masked) lines.push(`Document number: ${check.id_number_masked}`);
    if (check.verification_notes) lines.push(`AI notes: ${check.verification_notes}`);
  }
  lines.push(`Original document link: ${app.id_document_url || 'not provided'}`);
  return lines;
}

/** Subject, body and meta of the application message (the body always fits the 4,000-character limit). */
export function buildTeacherApplicationMessage(application, sender = null) {
  const app = application || {};
  const head = [
    `New teacher application from ${app.applicant_name || sender?.displayName || ''} (${normalizeEmail(app.applicant_email || sender?.email)}).`,
    '',
    `Subject specialty: ${app.subject_specialty || '—'}`,
    `Proposed course: ${app.proposed_course_title || '—'} (🪙 ${Number(app.proposed_token_rate) || 0} tokens to enrol)`,
    '',
    ...idCheckLines(app),
    '',
    'Teacher Statement & Course Proposal:'
  ].join('\n');
  const tail = '\n\nReview and approve it in 🛡️ Super Admin Control → Teacher Postcards.';
  // The statement is shortened if needed so the ID check, link and review note always fit.
  const room = Math.max(0, MAX_MESSAGE_CHARS - head.length - tail.length - 1);
  let statement = String(app.teaching_bio || '—');
  if (statement.length > room) statement = `${statement.slice(0, Math.max(0, room - 40)).trimEnd()}… (full statement in Teacher Postcards)`;
  return {
    subject: `Teacher application: ${app.proposed_course_title || app.subject_specialty || 'New teacher'}`.slice(0, MAX_SUBJECT_CHARS),
    body: `${head}\n${statement}${tail}`.slice(0, MAX_MESSAGE_CHARS),
    meta: {
      applicationId: app.id || '',
      applicantUid: app.applicant_uid || sender?.uid || '',
      documentUrl: app.id_document_url || '',
      idConfidence: Number.isFinite(app.ai_id_verification?.confidence_score) ? app.ai_id_verification.confidence_score : null
    }
  };
}

/** Applicant -> Super Admin: the Teacher Statement & Course Proposal with the ID check and document link. */
export function postTeacherApplicationMessage({ sender, senderProfile, application }) {
  const { subject, body, meta } = buildTeacherApplicationMessage(application, sender);
  return sendMessage({ sender, senderProfile, to: SUPERADMIN_INBOX, category: 'application', subject, body, meta });
}

/** Subject and body of the welcome a newly enrolled person receives (pure; exported for tests). */
export function buildEnrolmentWelcome({ course, memberName = '', memberEmail = '', memberRole = 'student', senderName = '' }) {
  const title = String(course?.title || 'your new course').slice(0, 200);
  const greetingName = String(memberName || '').trim().split(/\s+/)[0] || 'there';
  const who = String(senderName || '').trim() || 'Your teacher';
  const roleLine = memberRole === 'teacher'
    ? `You have been added as a co-teacher.`
    : memberRole === 'guest' ? 'You have been added as a guest.' : '';
  const lines = [
    `Hi ${greetingName}, welcome to "${title}"! 🎓`,
    '',
    `${who} has enrolled you in this course.${roleLine ? ` ${roleLine}` : ''}`,
    course?.startDate ? `The course starts on ${course.startDate}.` : '',
    '',
    'How to start:',
    `1. Sign in to OzEdu with Google using ${normalizeEmail(memberEmail) || 'this email address'}.`,
    '2. Open 🎓 Student Panel to see the course content, assessments and submission boxes.',
    '3. Questions? Reply to this message in 💬 Messages.',
    '',
    'You can also email support@aifoundation.net.au.'
  ];
  return {
    subject: `Welcome to ${title}`.slice(0, MAX_SUBJECT_CHARS),
    body: lines.join('\n').replace(/\n{3,}/g, '\n\n').slice(0, MAX_MESSAGE_CHARS)
  };
}

/**
 * Teacher / Super Admin -> each newly enrolled person: a welcome message (a few at a time).
 * Never throws: enrolment has already succeeded, so failures are reported, not raised.
 * @returns {Promise<{ sent: string[], failed: string[] }>}
 */
export async function sendEnrolmentWelcomes({ sender, senderProfile, course, members, concurrency = 4 }) {
  const senderEmail = normalizeEmail(sender?.email);
  const seen = new Set();
  const queue = [];
  for (const m of Array.isArray(members) ? members : []) {
    const email = normalizeEmail(m?.email);
    if (!isValidEmail(email) || email === senderEmail || seen.has(email)) continue;
    seen.add(email);
    queue.push({ email, name: m?.name || '', role: m?.role || 'student' });
  }
  const sent = [];
  const failed = [];
  const worker = async () => {
    while (queue.length) {
      const member = queue.shift();
      try {
        const { subject, body } = buildEnrolmentWelcome({
          course,
          memberName: member.name,
          memberEmail: member.email,
          memberRole: member.role,
          senderName: sender?.displayName || senderEmail
        });
        await sendMessage({
          sender,
          senderProfile,
          to: member.email,
          toName: member.name,
          subject,
          body,
          courseId: course?.id || '',
          courseTitle: course?.title || '',
          meta: { enrolmentWelcome: true }
        });
        sent.push(member.email);
      } catch (err) {
        console.warn('Enrolment welcome not sent:', member.email, err?.code || err);
        failed.push(member.email);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), queue.length) }, worker));
  return { sent, failed };
}

/** Super Admin -> recipient: token grant notice. */
export function notifyTokenGrant({ sender, senderProfile, recipientEmail, recipientName, amount, newBalance, note = '' }) {
  return sendMessage({
    sender,
    senderProfile,
    to: recipientEmail,
    toName: recipientName,
    category: 'grant',
    subject: `${amount} tokens added`,
    body: `🎁 The Super Admin added ${amount} tokens to your account.${Number.isFinite(newBalance) ? ` Your balance is now ${newBalance} tokens.` : ''}${note ? `\n\n${note}` : ''}`,
    meta: { tokensGranted: amount }
  });
}

// ---------- contacts ----------

/**
 * Message recipients a user may pick: always the Super Admin, plus
 * teachers -> students in their courses, students -> their teachers.
 * @param {object} args
 * @param {Array} args.teachingCourses courses the user teaches (with id/title)
 * @param {Array} args.enrolledCourses courses the user is enrolled in (with authorEmail/authorName)
 * @param {(courseId: string) => Promise<Array>} args.listMembers roster loader
 */
export async function loadContacts({
  teachingCourses = [],
  enrolledCourses = [],
  networkCourses = [],
  registeredTeachers = [],
  listMembers,
  selfEmail = ''
}) {
  const me = normalizeEmail(selfEmail);
  const contacts = new Map();
  contacts.set(SUPERADMIN_INBOX, { email: SUPERADMIN_INBOX, name: '🛡️ Super Admin', kind: 'superadmin', courses: [] });

  // Any explicit registered teachers passed in
  for (const teacher of registeredTeachers || []) {
    const email = normalizeEmail(teacher.email);
    if (!email || email === me || !isValidEmail(email)) continue;
    const entry = contacts.get(email) || { email, name: teacher.name || teacher.displayName || email, kind: 'teacher', courses: [] };
    if (Array.isArray(teacher.courses)) {
      for (const c of teacher.courses) {
        if (c && !entry.courses.some(x => x.id === String(c.id))) entry.courses.push({ id: String(c.id), title: c.title || 'Course' });
      }
    }
    contacts.set(email, entry);
  }

  // Registered teachers who have published global network courses
  for (const course of networkCourses || []) {
    const email = normalizeEmail(course.authorEmail);
    if (!email || email === me || !isValidEmail(email)) continue;
    const entry = contacts.get(email) || { email, name: course.authorName || email, kind: 'teacher', courses: [] };
    if (course.id && !entry.courses.some(x => x.id === String(course.id))) {
      entry.courses.push({ id: String(course.id), title: course.title || 'Course' });
    }
    contacts.set(email, entry);
  }

  // Teachers of courses this student is enrolled in
  for (const course of enrolledCourses || []) {
    const email = normalizeEmail(course.authorEmail);
    if (!email || email === me || !isValidEmail(email)) continue;
    const entry = contacts.get(email) || { email, name: course.authorName || email, kind: 'teacher', courses: [] };
    if (course.id && !entry.courses.some(x => x.id === String(course.id))) {
      entry.courses.push({ id: String(course.id), title: course.title || 'Course' });
    }
    contacts.set(email, entry);
  }

  // Query registered teachers directly from Firestore if online and accessible
  if (db) {
    try {
      const q = query(collection(db, 'users'), where('role', 'in', ['teacher', 'Teacher', 'TEACHER']), limit(50));
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        const u = d.data();
        const email = normalizeEmail(u.email);
        if (!email || email === me || !isValidEmail(email)) continue;
        const entry = contacts.get(email) || {
          email,
          name: u.displayName || u.name || email,
          kind: 'teacher',
          courses: []
        };
        contacts.set(email, entry);
      }
    } catch {
      // Offline fallback: rely on networkCourses and enrolledCourses
    }
  }

  // For teaching staff: students enrolled in their courses
  if (typeof listMembers === 'function') {
    const courses = teachingCourses.filter(c => c && c.id).slice(0, 40);
    const rosters = await Promise.all(courses.map(c => listMembers(c.id).then(list => ({ c, list })).catch(() => ({ c, list: [] }))));
    for (const { c, list } of rosters) {
      for (const member of list || []) {
        const email = normalizeEmail(member.memberEmail);
        if (!email || email === me || !isValidEmail(email)) continue;
        const entry = contacts.get(email) || { email, name: member.memberName || email, kind: member.memberRole === 'teacher' ? 'teacher' : 'student', courses: [] };
        if (!entry.courses.some(x => x.id === String(c.id))) entry.courses.push({ id: String(c.id), title: c.title || 'Course' });
        contacts.set(email, entry);
      }
    }
  }
  return Array.from(contacts.values());
}

/** One-off fetch (used by tests / fallbacks). */
export async function fetchInboxOnce({ email, isSuperadmin }) {
  if (!db) return [];
  const me = normalizeEmail(email);
  const keys = isSuperadmin ? [me, SUPERADMIN_INBOX] : [me];
  const results = await Promise.all(keys.map(key => getDocs(query(collection(db, CHAT_COLLECTION), where('participants', 'array-contains', key), limit(INBOX_LIMIT)))));
  const merged = new Map();
  for (const snap of results) for (const d of snap.docs) {
    const m = toMessage(d);
    if (m) merged.set(m.id, m);
  }
  return Array.from(merged.values()).sort((a, b) => b.createdAtMs - a.createdAtMs);
}
