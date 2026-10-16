import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  MESSAGE_CATEGORIES,
  SUPERADMIN_INBOX,
  MAX_MESSAGE_CHARS,
  categoryMeta,
  subscribeToInbox,
  groupThreads,
  markMessagesRead,
  sendMessage,
  requestTokensFromSuperadmin,
  notifyTokenGrant,
  loadContacts,
  isValidEmail,
  normalizeEmail,
  isThreadPending,
  isThreadDeclined,
  sendCourseGroupMessage,
  loadUserArchive,
  archiveMessageRecord,
  archiveThreadRecord,
  restoreMessageRecord,
  restoreThreadRecord,
  searchUsersInDb,
  ARCHIVE_RETENTION_YEARS
} from '../../services/messageService';
import { listCourseMembers } from '../../services/courseEnrollmentService';
import { grantTokensByEmail, donateToTokenFund, MAX_GRANT_TOKENS } from '../../services/tokenService';
import { confirmCheckoutSession } from '../../services/stripeService';
import { resolvePrivileges } from '../../services/rolePrivileges';
import { splitTextLinks } from '../../services/mediaLinks';

/** Message text with its http(s) links clickable (opened in a new tab). */
function LinkedText({ text }) {
  return splitTextLinks(text).map((part, i) => (part.href
    ? <a key={i} href={part.href} target="_blank" rel="noopener noreferrer" className="md-link">{part.text}</a>
    : <React.Fragment key={i}>{part.text}</React.Fragment>));
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'teacher', label: 'Teachers' },
  { id: 'student', label: 'Students' },
  { id: 'application', label: 'Applications' },
  { id: 'token_request', label: 'Token Requests' },
  { id: 'support', label: 'Support' }
];

function formatTime(ms) {
  if (!ms) return '';
  try {
    const date = new Date(ms);
    const sameDay = new Date().toDateString() === date.toDateString();
    return new Intl.DateTimeFormat(undefined, sameDay ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  } catch {
    return '';
  }
}

export function CategoryTag({ category, small = false }) {
  const meta = categoryMeta(category);
  return (
    <span
      className="md-tag"
      style={{ color: meta.color, background: meta.background, borderColor: meta.border, fontSize: small ? '0.66rem' : '0.72rem' }}
      title={meta.label}
    >
      {meta.icon} {meta.label}
    </span>
  );
}

/** Unique {id, title} course choices, in order. */
function courseChoices(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const c of list || []) {
      const id = c && c.id !== undefined && c.id !== null ? String(c.id) : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, title: c.title || 'Course' });
    }
  }
  return out;
}

/** Loaded contacts plus any added directly (e.g. "Message teacher"), keeping every course of both. */
function mergeContacts(loaded, previous) {
  const merged = loaded.map(c => {
    const direct = (previous || []).find(x => x.email === c.email);
    return direct ? { ...c, courses: courseChoices(c.courses, direct.courses) } : c;
  });
  return [...merged, ...(previous || []).filter(c => !loaded.some(x => x.email === c.email))];
}

/**
 * Message board dock shown at the bottom of every signed-in panel.
 * @param {object[]} teachingCourses courses the user teaches (for "message my students")
 * @param {object[]} enrolledCourses courses the user studies in (for "message my teacher")
 */
export const MESSAGE_LEGEND = ['teacher', 'student', 'application', 'token_request', 'grant', 'support', 'admin'];

export default function MessageDock({
  ref,
  currentUser,
  userProfile,
  teachingCourses = [],
  enrolledCourses = [],
  networkCourses = [],
  registeredTeachers = [],
  onBalanceChanged,
  onUnreadChange,
  hideBar = false
}) {
  const privileges = resolvePrivileges(userProfile || { email: currentUser?.email });
  const myEmail = normalizeEmail(currentUser?.email);
  const isSuperadmin = privileges.isSuperadmin;

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [view, setView] = useState('threads'); // 'threads' | 'thread' | 'compose' | 'request'
  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [filter, setFilter] = useState('all');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  // Composer state
  const [reply, setReply] = useState('');
  const [contacts, setContacts] = useState(null);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsLoaded, setContactsLoaded] = useState(false);
  const [composeTo, setComposeTo] = useState(SUPERADMIN_INBOX);
  const [composeEmail, setComposeEmail] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeCourseId, setComposeCourseId] = useState('');
  const [requestAmount, setRequestAmount] = useState('50');
  const [requestReason, setRequestReason] = useState('');
  const [nameSearchTerm, setNameSearchTerm] = useState('');
  const [dbSearchResults, setDbSearchResults] = useState([]);
  const [isSearchingDb, setIsSearchingDb] = useState(false);
  const [selectedSearchedUser, setSelectedSearchedUser] = useState(null);
  const [recipientMode, setRecipientMode] = useState('individual'); // 'individual' | 'group'
  const [groupCourseId, setGroupCourseId] = useState('');

  // 7-year retention archive state
  const [archive, setArchive] = useState(() => loadUserArchive(myEmail));
  const [viewingArchive, setViewingArchive] = useState(false);

  const mountedRef = useRef(true);
  const threadEndRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Live inbox subscription (re-subscribes if the signed-in user changes).
  useEffect(() => {
    if (!myEmail) return undefined;
    const unsubscribe = subscribeToInbox(
      { email: myEmail, isSuperadmin },
      list => {
        if (!mountedRef.current) return;
        setMessages(list);
        setLoadError(null);
      },
      err => mountedRef.current && setLoadError(err.message)
    );
    return unsubscribe;
  }, [myEmail, isSuperadmin]);

  // Keep archive in sync with current user email
  useEffect(() => {
    if (myEmail) {
      setArchive(loadUserArchive(myEmail));
    }
  }, [myEmail]);

  const threads = useMemo(() => groupThreads(messages, { email: myEmail, isSuperadmin }), [messages, myEmail, isSuperadmin]);
  const unreadTotal = useMemo(() => threads.reduce((n, t) => n + t.unread, 0), [threads]);

  const archivedCount = useMemo(() => {
    return Object.keys(archive.threads || {}).length + Object.keys(archive.messages || {}).length;
  }, [archive]);

  // Separate active vs archived threads
  const activeThreads = useMemo(() => {
    return threads.filter(t => !archive.threads?.[t.threadId]);
  }, [threads, archive]);

  const archivedThreads = useMemo(() => {
    return threads.filter(t => archive.threads?.[t.threadId] || t.messages.some(m => archive.messages?.[m.id]));
  }, [threads, archive]);

  const poolThreads = viewingArchive ? archivedThreads : activeThreads;
  const visibleThreads = filter === 'all' ? poolThreads : poolThreads.filter(t => t.categories.includes(filter));
  const selectedThread = threads.find(t => t.threadId === selectedThreadId) || null;

  const visibleMessages = useMemo(() => {
    if (!selectedThread) return [];
    if (viewingArchive) return selectedThread.messages;
    return selectedThread.messages.filter(m => !archive.messages?.[m.id]);
  }, [selectedThread, archive, viewingArchive]);

  // Opening a thread marks its incoming messages as read.
  useEffect(() => {
    if (!isOpen || view !== 'thread' || !selectedThread || selectedThread.unread === 0) return;
    markMessagesRead(selectedThread.messages, { email: myEmail, isSuperadmin });
  }, [isOpen, view, selectedThread, myEmail, isSuperadmin]);

  // Sync unread count to parent navbar
  useEffect(() => {
    onUnreadChange?.(unreadTotal);
  }, [unreadTotal, onUnreadChange]);

  // Escape key closes modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (view === 'thread') threadEndRef.current?.scrollIntoView({ block: 'end' });
  }, [view, selectedThread?.messages.length]);

  const flash = (type, message) => {
    setNotice({ type, message });
    setTimeout(() => mountedRef.current && setNotice(null), 6000);
  };

  const ensureContacts = async () => {
    if (contactsLoaded || contactsLoading) return;
    setContactsLoading(true);
    try {
      const list = await loadContacts({
        teachingCourses: privileges.isStaff ? teachingCourses : [],
        enrolledCourses,
        networkCourses,
        registeredTeachers,
        listMembers: listCourseMembers,
        selfEmail: myEmail,
        senderIsStaff: privileges.isStaff
      });
      if (!mountedRef.current) return;
      // Keep any contact added directly (e.g. "Message teacher") and the course it was started from.
      setContacts(prev => mergeContacts(list, prev));
      setContactsLoaded(true);
    } catch (err) {
      console.warn('Contacts could not be loaded:', err);
      if (mountedRef.current) setContacts(prev => prev || [{ email: SUPERADMIN_INBOX, name: '🛡️ Super Admin', kind: 'superadmin', courses: [] }]);
    } finally {
      if (mountedRef.current) setContactsLoading(false);
    }
  };

  const openCompose = (to = SUPERADMIN_INBOX) => {
    setComposeTo(to);
    setComposeCourseId('');
    setComposeEmail('');
    setComposeSubject('');
    setComposeBody('');
    setNameSearchTerm('');
    setDbSearchResults([]);
    setSelectedSearchedUser(null);
    setRecipientMode('individual');
    setView('compose');
    ensureContacts();
  };

  // Other panels start a message with dockRef.current.compose({ to, toName, courseId, courseTitle, subject, body }).
  useImperativeHandle(ref, () => ({
    open() {
      setIsOpen(true);
    },
    close() {
      setIsOpen(false);
    },
    toggle() {
      setIsOpen(prev => !prev);
    },
    compose(request) {
      const to = normalizeEmail(request?.to);
      if (!to) return;
      setIsOpen(true);
      setView('compose');
      setComposeSubject(request.subject || '');
      setComposeBody(request.body || '');
      setComposeEmail(to);
      setComposeCourseId(request.courseId ? String(request.courseId) : '');
      setNameSearchTerm('');
      setDbSearchResults([]);
      setSelectedSearchedUser(null);
      const requestedCourses = request.courseId ? [{ id: String(request.courseId), title: request.courseTitle || 'Course' }] : [];
      setContacts(prev => {
        const list = prev ? prev.slice() : [{ email: SUPERADMIN_INBOX, name: '🛡️ Super Admin', kind: 'superadmin', courses: [] }];
        const index = list.findIndex(c => c.email === to);
        if (index < 0) {
          list.push({ email: to, name: request.toName || to, kind: 'direct', courses: requestedCourses });
        } else if (requestedCourses.length) {
          // The message names the course it was started from (e.g. "Contact Teacher to Enrol").
          list[index] = { ...list[index], courses: courseChoices(requestedCourses, list[index].courses) };
        }
        return list;
      });
      setComposeTo(to);
      ensureContacts();
    }
  }));

  const sender = currentUser ? { uid: currentUser.uid, email: currentUser.email, displayName: currentUser.displayName } : null;

  // Messages between students and teachers always name a course (the teacher's course). The app
  // fills it in: students pick a teacher (their courses come with them); teachers choose from the
  // courses they share with that person, or any course they teach.
  const isTeacherSender = privileges.isStaff && !isSuperadmin;
  const composeRecipient = composeTo === '__search_name__'
    ? normalizeEmail(selectedSearchedUser?.email)
    : (composeTo === '__typed__' ? normalizeEmail(composeEmail) : composeTo);
  const composeContact = (contacts || []).find(c => c.email === composeRecipient) || null;
  const contactCourses = courseChoices(composeContact?.courses);
  const courseOptions = !composeRecipient || composeRecipient === SUPERADMIN_INBOX
    ? []
    : (contactCourses.length || !isTeacherSender ? contactCourses : courseChoices(teachingCourses));
  const selectedCourse = courseOptions.find(c => c.id === composeCourseId)
    || (composeCourseId === '__none__' ? null : courseOptions[0])
    || null;

  /** A course this person shares with `email` (for replies in conversations that name none). */
  const courseSharedWith = (email) => {
    const enrolled = (enrolledCourses || []).find(c => c && c.id !== undefined && normalizeEmail(c.authorEmail) === email);
    if (enrolled) return { id: String(enrolled.id), title: enrolled.title || 'Course' };
    return courseChoices((contacts || []).find(c => c.email === email)?.courses)[0] || null;
  };

  const handleNameSearchChange = async (val) => {
    setNameSearchTerm(val);
    setSelectedSearchedUser(null);
    const trimmed = val.trim();
    if (trimmed.length < 1) {
      setDbSearchResults([]);
      setIsSearchingDb(false);
      return;
    }
    setIsSearchingDb(true);
    try {
      const results = await searchUsersInDb(trimmed, { currentEmail: myEmail, fallbackContacts: contacts });
      if (mountedRef.current) setDbSearchResults(results);
    } catch (err) {
      console.warn('searchUsersInDb failed:', err);
      if (mountedRef.current) setDbSearchResults([]);
    } finally {
      if (mountedRef.current) setIsSearchingDb(false);
    }
  };

  const handleSendReply = async (e) => {
    e.preventDefault();
    if (!selectedThread || !reply.trim()) return;
    const partner = selectedThread.partnerEmail;
    const lastCourse = selectedThread.messages.slice().reverse().find(m => m.courseId);
    const course = lastCourse
      ? { id: lastCourse.courseId, title: lastCourse.courseTitle }
      : (partner === SUPERADMIN_INBOX ? null : courseSharedWith(partner));
    setBusy(true);
    try {
      await sendMessage({
        sender,
        senderProfile: userProfile,
        to: partner,
        toName: selectedThread.partnerName,
        body: reply,
        courseId: course?.id || '',
        courseTitle: course?.title || '',
        meta: { requestStatus: 'accepted' }
      });
      setReply('');
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleAcceptMessage = async (thread) => {
    if (!thread) return;
    setBusy(true);
    try {
      const partner = thread.partnerEmail;
      const lastCourse = thread.messages.slice().reverse().find(m => m.courseId);
      const course = lastCourse
        ? { id: lastCourse.courseId, title: lastCourse.courseTitle }
        : (partner === SUPERADMIN_INBOX ? null : courseSharedWith(partner));
      await sendMessage({
        sender,
        senderProfile: userProfile,
        to: partner,
        toName: thread.partnerName,
        subject: 'Message request accepted',
        body: 'Accepted your message request.',
        courseId: course?.id || '',
        courseTitle: course?.title || '',
        meta: { requestStatus: 'accepted', systemAction: 'accepted' }
      });
      flash('success', `Accepted message request from ${thread.partnerName}.`);
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeclineMessage = async (thread) => {
    if (!thread) return;
    if (!window.confirm(`Decline message request from ${thread.partnerName}?`)) return;
    setBusy(true);
    try {
      const partner = thread.partnerEmail;
      const lastCourse = thread.messages.slice().reverse().find(m => m.courseId);
      const course = lastCourse
        ? { id: lastCourse.courseId, title: lastCourse.courseTitle }
        : (partner === SUPERADMIN_INBOX ? null : courseSharedWith(partner));
      const myDisplayName = currentUser?.displayName || myEmail || 'The recipient';
      await sendMessage({
        sender,
        senderProfile: userProfile,
        to: partner,
        toName: thread.partnerName,
        subject: 'Message request declined',
        body: `${myDisplayName} did not accept the message.`,
        courseId: course?.id || '',
        courseTitle: course?.title || '',
        meta: { requestStatus: 'declined', systemAction: 'declined' }
      });
      flash('success', 'Message request declined.');
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleArchiveMessage = (message) => {
    if (!message) return;
    const confirmed = window.confirm(
      `Archive this message?\n\nIt will be moved to the Archive at the bottom of the message panel, preserved for ${ARCHIVE_RETENTION_YEARS} years for compliance, and then permanently deleted from the server.`
    );
    if (!confirmed) return;
    const updated = archiveMessageRecord({ email: myEmail, messageId: message.id, threadId: message.threadId });
    setArchive(updated);
    flash('success', `Message moved to Archive (${ARCHIVE_RETENTION_YEARS}-year retention).`);
  };

  const handleRestoreMessage = (message) => {
    if (!message) return;
    const updated = restoreMessageRecord({ email: myEmail, messageId: message.id });
    setArchive(updated);
    flash('success', 'Message restored from Archive.');
  };

  const handleArchiveThread = (thread) => {
    if (!thread) return;
    const confirmed = window.confirm(
      `Archive conversation with ${thread.partnerName}?\n\nIt will be moved to the Archive at the bottom of the message panel, preserved for ${ARCHIVE_RETENTION_YEARS} years, and then permanently deleted from the server.`
    );
    if (!confirmed) return;
    const updated = archiveThreadRecord({ email: myEmail, threadId: thread.threadId });
    setArchive(updated);
    flash('success', `Conversation moved to Archive (${ARCHIVE_RETENTION_YEARS}-year retention).`);
    if (selectedThreadId === thread.threadId && !viewingArchive) {
      setView('threads');
    }
  };

  const handleRestoreThread = (thread) => {
    if (!thread) return;
    const updated = restoreThreadRecord({ email: myEmail, threadId: thread.threadId });
    setArchive(updated);
    flash('success', 'Conversation restored from Archive.');
  };

  const handleSendNew = async (e) => {
    e.preventDefault();
    if (recipientMode === 'group') {
      const course = teachingCourses.find(c => String(c.id) === String(groupCourseId)) || teachingCourses[0];
      if (!course) {
        flash('error', 'Select a course to broadcast to.');
        return;
      }
      setBusy(true);
      try {
        const result = await sendCourseGroupMessage({
          sender,
          senderProfile: userProfile,
          course,
          subject: composeSubject,
          body: composeBody,
          listMembers: listCourseMembers
        });
        if (result.total === 0) {
          flash('error', `No active students are currently enrolled in "${course.title}".`);
          return;
        }
        flash('success', `📢 Group message sent to ${result.sent.length} student${result.sent.length === 1 ? '' : 's'} in "${course.title}".`);
        setView('threads');
      } catch (err) {
        flash('error', err.message);
      } finally {
        setBusy(false);
      }
      return;
    }

    let to = composeTo;
    let toName = '';
    if (composeTo === '__search_name__') {
      if (!selectedSearchedUser || !selectedSearchedUser.email) {
        flash('error', 'Please search for and select a user by name from the database.');
        return;
      }
      to = normalizeEmail(selectedSearchedUser.email);
      toName = selectedSearchedUser.name || to;
    } else if (composeTo === '__typed__') {
      const typed = normalizeEmail(composeEmail);
      if (!isValidEmail(typed)) {
        flash('error', 'Enter a valid email address.');
        return;
      }
      to = typed;
      toName = typed;
    } else {
      to = composeTo;
      const contact = (contacts || []).find(c => c.email === to);
      toName = contact?.name || '';
    }

    const contact = (contacts || []).find(c => c.email === to);
    if (!privileges.isStaff && to !== SUPERADMIN_INBOX && !selectedCourse && contact?.kind === 'teacher') {
      flash('error', 'Choose a teacher from the list: messages to a teacher are about one of their courses. You can always message the Super Admin.');
      return;
    }
    setBusy(true);
    try {
      const sent = await sendMessage({
        sender,
        senderProfile: userProfile,
        to,
        toName: toName || contact?.name || '',
        subject: composeSubject,
        body: composeBody,
        courseId: selectedCourse?.id || '',
        courseTitle: selectedCourse?.title || '',
        meta: { requestStatus: 'pending' }
      });
      flash('success', 'Message sent.');
      setSelectedThreadId(sent.threadId);
      setView('thread');
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRequestTokens = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const sent = await requestTokensFromSuperadmin({ sender, senderProfile: userProfile, amount: requestAmount, reason: requestReason });
      flash('success', `Token request sent to the Super Admin (${sent.meta.tokensRequested} tokens).`);
      setRequestReason('');
      setSelectedThreadId(sent.threadId);
      setView('thread');
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  // Super Admin: grant a token request (purchases are re-verified with Stripe first).
  const handleGrant = async (message) => {
    const meta = message.meta || {};
    // Security rules guarantee the sender's identity; meta fields are written by the sender.
    const email = normalizeEmail(message.senderEmail);
    let amount = Number(meta.tokensRequested || meta.tokensPurchased) || 0;
    setBusy(true);
    try {
      if (meta.stripeSessionId) {
        const verified = await confirmCheckoutSession(meta.stripeSessionId);
        if (!verified.paid || verified.type !== 'token_purchase') throw new Error('Stripe does not show this purchase as paid.');
        if (verified.targetUid && verified.targetUid !== message.senderUid) {
          throw new Error('This Stripe payment was made for a different account, so it was not credited.');
        }
        amount = verified.tokens;
      }
      if (amount > MAX_GRANT_TOKENS) {
        throw new Error(`${amount} tokens is more than one grant allows (${MAX_GRANT_TOKENS}). Use 🛡️ Super Admin Control → Give Tokens to give it in parts.`);
      }
      const grant = Math.max(1, Math.floor(amount));
      if (!window.confirm(`Give ${grant} tokens to ${email}?`)) return;
      const result = await grantTokensByEmail({
        adminUid: currentUser.uid,
        email,
        amount: grant,
        note: meta.stripeSessionId ? `Stripe purchase ${meta.stripeSessionId}` : 'Token request',
        stripeSessionId: meta.stripeSessionId || ''
      });
      await notifyTokenGrant({
        sender,
        senderProfile: userProfile,
        recipientEmail: result.email,
        recipientName: result.displayName,
        amount: result.amount,
        newBalance: result.newBalance
      }).catch(err => console.warn('Grant notice not sent:', err));
      flash('success', `🎁 Gave ${result.amount} tokens to ${result.email} (new balance ${result.newBalance}).`);
      onBalanceChanged?.();
    } catch (err) {
      flash('error', err.message || 'The grant failed.');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const handleAddDonation = async (message) => {
    const tokens = Number(message.meta?.donationTokens) || 0;
    setBusy(true);
    try {
      if (message.meta?.stripeSessionId) {
        const verified = await confirmCheckoutSession(message.meta.stripeSessionId);
        if (!verified.paid) throw new Error('Stripe does not show this donation as paid.');
      }
      if (!window.confirm(`Add ${tokens} donated tokens to the Emergency Token Fund?`)) return;
      const ok = await donateToTokenFund(tokens, { donorEmail: message.senderEmail, donorName: message.senderName });
      if (!ok) throw new Error('The fund could not be updated.');
      flash('success', `Added ${tokens} tokens to the Emergency Token Fund.`);
    } catch (err) {
      flash('error', err.message);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  if (!currentUser) return null;

  const legend = MESSAGE_LEGEND;

  return (
    <>
      {!hideBar && (
        <div className={`md-dock ${isOpen ? 'open' : ''}`} role="region" aria-label="Messages">
          <button
            type="button"
            className="md-bar"
            onClick={() => setIsOpen(o => !o)}
            aria-expanded={isOpen}
          >
            <span className="md-bar-title">💬 Messages</span>
            {unreadTotal > 0 && <span className="md-unread" aria-label={`${unreadTotal} unread`}>{unreadTotal}</span>}
            <span className="md-bar-legend" aria-hidden="true">
              {legend.map(c => <CategoryTag key={c} category={c} small />)}
            </span>
            <span className="md-bar-chevron">{isOpen ? '▼' : '▲'}</span>
          </button>
        </div>
      )}

      {/* Centered Messages Modal in the middle of the screen */}
      {isOpen && (
        <div
          className="modal-overlay md-modal-overlay animate-fade-in"
          onClick={() => setIsOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="md-modal-title"
        >
          <div
            className="glass modal-content md-modal-content animate-fade-in-up"
            onClick={e => e.stopPropagation()}
          >
            <div className="md-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <span id="md-modal-title" style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fef08a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  💬 Messages
                  {unreadTotal > 0 && <span className="md-unread" style={{ fontSize: '0.72rem' }}>{unreadTotal}</span>}
                </span>
                <div className="md-modal-legend" aria-hidden="true">
                  {legend.map(c => <CategoryTag key={c} category={c} small />)}
                </div>
              </div>
              <button
                type="button"
                className="close-btn md-modal-close"
                onClick={() => setIsOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {notice && <div className={`md-notice ${notice.type}`} role="status">{notice.message}</div>}
            {loadError && <div className="md-notice error" role="alert">⚠️ {loadError}</div>}

            <div className={`md-layout view-${view}`}>
              {/* Conversation list */}
              <aside className="md-threads">
                <div className="md-actions">
                  <button type="button" className="nav-btn primary md-small" onClick={() => openCompose()}>✏️ New message</button>
                  {!isSuperadmin && (
                    <button type="button" className="nav-btn secondary md-small" onClick={() => setView('request')}>🪙 Request tokens</button>
                  )}
                </div>
                <div className="md-filters" role="tablist" aria-label="Filter conversations">
                  {FILTERS.map(f => (
                    <button
                      type="button"
                      key={f.id}
                      role="tab"
                      aria-selected={filter === f.id}
                      className={`md-filter ${filter === f.id ? 'active' : ''}`}
                      style={f.id !== 'all' ? { borderColor: MESSAGE_CATEGORIES[f.id]?.border } : undefined}
                      onClick={() => setFilter(f.id)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="md-thread-list">
                  {viewingArchive && (
                    <div style={{ padding: '8px 12px', background: 'rgba(234, 179, 8, 0.12)', borderBottom: '1px solid rgba(234, 179, 8, 0.25)', fontSize: '0.75rem', color: '#fef08a', lineHeight: 1.4 }}>
                      📁 <strong>7-Year Retention Archive:</strong> Preserved for compliance, then deleted from server.
                    </div>
                  )}
                  {visibleThreads.length === 0 ? (
                    <p className="md-empty">{viewingArchive ? 'No archived messages.' : (messages.length === 0 ? 'No messages yet. Start a conversation with ✏️ New message.' : 'No conversations in this category.')}</p>
                  ) : visibleThreads.map(t => (
                    <button
                      type="button"
                      key={t.threadId}
                      className={`md-thread ${t.threadId === selectedThreadId ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedThreadId(t.threadId);
                        setView('thread');
                      }}
                    >
                      <div className="md-thread-top">
                        <strong>{t.partnerName}</strong>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {t.unread > 0 && <span className="md-unread small">{t.unread}</span>}
                          {!viewingArchive ? (
                            <button
                              type="button"
                              className="md-del-btn"
                              title="Archive conversation (7-year retention)"
                              aria-label="Archive conversation"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleArchiveThread(t);
                              }}
                            >
                              ✕
                            </button>
                          ) : (
                            archive.threads?.[t.threadId] && (
                              <button
                                type="button"
                                className="nav-btn secondary md-small md-restore-btn"
                                style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                                title="Restore conversation"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRestoreThread(t);
                                }}
                              >
                                ↩ Restore
                              </button>
                            )
                          )}
                        </div>
                      </div>
                      <div className="md-thread-tags">{t.categories.map(c => <CategoryTag key={c} category={c} small />)}</div>
                      <div className="md-thread-snippet">{t.latest.subject || t.latest.body}</div>
                      <div className="md-thread-time">{formatTime(t.latest.createdAtMs)}{t.courseTitle ? ` • ${t.courseTitle}` : ''}</div>
                    </button>
                  ))}
                </div>
                <div className="md-archive-bar">
                  <button
                    type="button"
                    className={`md-archive-btn ${viewingArchive ? 'active' : ''}`}
                    onClick={() => {
                      setViewingArchive(prev => !prev);
                      setView('threads');
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>📁</span>
                      <strong>{viewingArchive ? 'Active Messages' : `Archive (${archivedCount})`}</strong>
                    </div>
                    <span className="md-archive-retention-tag">7-Year Retention</span>
                  </button>
                </div>
              </aside>

              {/* Right side */}
              <section className="md-main">
                {view === 'thread' && selectedThread && (
                  <div className="md-thread-view">
                    <header className="md-thread-header">
                      <button type="button" className="md-back" onClick={() => setView('threads')} aria-label="Back to conversations">←</button>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <strong>{selectedThread.partnerName}</strong>
                        <div className="md-sub">{selectedThread.partnerEmail === SUPERADMIN_INBOX ? 'Super Admin team' : selectedThread.partnerEmail}</div>
                      </div>
                      {!viewingArchive ? (
                        <button
                          type="button"
                          className="md-del-btn"
                          style={{ width: '22px', height: '22px', fontSize: '0.8rem' }}
                          title="Archive conversation (7-year retention)"
                          aria-label="Archive conversation"
                          onClick={() => handleArchiveThread(selectedThread)}
                        >
                          ✕
                        </button>
                      ) : (
                        archive.threads?.[selectedThread.threadId] && (
                          <button
                            type="button"
                            className="nav-btn secondary md-small"
                            style={{ padding: '3px 10px', fontSize: '0.78rem' }}
                            onClick={() => handleRestoreThread(selectedThread)}
                          >
                            ↩ Restore Thread
                          </button>
                        )
                      )}
                    </header>
                    {isThreadPending(selectedThread, myEmail) && (
                      <div className="md-request-banner animate-fade-in" style={{ padding: '12px 18px', background: 'rgba(234, 179, 8, 0.15)', borderBottom: '1px solid rgba(234, 179, 8, 0.35)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontSize: '1.4rem' }}>📩</span>
                          <div>
                            <strong style={{ color: '#fef08a' }}>Initial Message Request</strong>
                            <div style={{ fontSize: '0.82rem', color: '#cbd5e1' }}>
                              {selectedThread.partnerName} ({selectedThread.partnerEmail}) sent you an initial message.
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <button
                            type="button"
                            className="nav-btn primary md-small"
                            disabled={busy}
                            onClick={() => handleAcceptMessage(selectedThread)}
                            style={{ padding: '5px 14px', fontSize: '0.82rem' }}
                          >
                            ✓ Accept
                          </button>
                          <button
                            type="button"
                            className="nav-btn secondary md-small md-decline-btn"
                            disabled={busy}
                            onClick={() => handleDeclineMessage(selectedThread)}
                            style={{ padding: '5px 14px', fontSize: '0.82rem', borderColor: 'rgba(239, 68, 68, 0.4)', color: '#f87171' }}
                          >
                            ✕ Decline
                          </button>
                        </div>
                      </div>
                    )}
                    {isThreadDeclined(selectedThread) && (
                      <div className="md-declined-banner" style={{ padding: '10px 16px', background: 'rgba(239, 68, 68, 0.12)', borderBottom: '1px solid rgba(239, 68, 68, 0.3)', color: '#fca5a5', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>🚫</span>
                        <span>This message request was declined.</span>
                      </div>
                    )}
                    <div className="md-messages">
                      {visibleMessages.map(m => {
                        const mine = m.senderEmail === myEmail;
                        const requested = Number(m.meta?.tokensRequested || m.meta?.tokensPurchased) || 0;
                        const canGrant = isSuperadmin && m.category === 'token_request' && !mine && requested > 0;
                        const canAddDonation = isSuperadmin && !mine && Number(m.meta?.donationTokens) > 0;
                        return (
                          <div key={m.id} className={`md-bubble ${mine ? 'mine' : ''}`}>
                            <div className="md-bubble-meta">
                              <CategoryTag category={m.category} small />
                              <span>{mine ? 'You' : m.senderName}</span>
                              <span>• {formatTime(m.createdAtMs)}</span>
                              {!viewingArchive && (
                                <button
                                  type="button"
                                  className="md-del-btn"
                                  title="Archive message (7-year retention)"
                                  aria-label="Archive message"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleArchiveMessage(m);
                                  }}
                                >
                                  ✕
                                </button>
                              )}
                              {viewingArchive && archive.messages?.[m.id] && (
                                <button
                                  type="button"
                                  className="nav-btn secondary md-small md-restore-btn"
                                  style={{ padding: '2px 8px', fontSize: '0.72rem', marginLeft: 'auto' }}
                                  title="Restore message"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRestoreMessage(m);
                                  }}
                                >
                                  ↩ Restore
                                </button>
                              )}
                            </div>
                            {m.subject && <div className="md-bubble-subject">{m.subject}</div>}
                            <div className="md-bubble-body"><LinkedText text={m.body} /></div>
                            {m.courseTitle && <div className="md-sub">Course: {m.courseTitle}</div>}
                            {canGrant && (
                              <button type="button" className="nav-btn primary md-small md-grant" disabled={busy} onClick={() => handleGrant(m)}>
                                {requested > MAX_GRANT_TOKENS
                                  ? `🎁 ${requested} tokens: give in parts (max ${MAX_GRANT_TOKENS} each)`
                                  : `🎁 Grant ${requested} tokens${m.meta.stripeSessionId ? ' (verify payment)' : ''}`}
                              </button>
                            )}
                            {canAddDonation && (
                              <button type="button" className="nav-btn secondary md-small md-grant" disabled={busy} onClick={() => handleAddDonation(m)}>
                                ➕ Add {m.meta.donationTokens} tokens to the fund
                              </button>
                            )}
                          </div>
                        );
                      })}
                      <div ref={threadEndRef} />
                    </div>
                    <form className="md-composer" onSubmit={handleSendReply}>
                      <textarea
                        className="form-input"
                        rows={2}
                        maxLength={MAX_MESSAGE_CHARS}
                        placeholder="Write a reply…"
                        value={reply}
                        onChange={e => setReply(e.target.value)}
                        aria-label="Reply"
                      />
                      <button type="submit" className="nav-btn primary" disabled={busy || !reply.trim()}>{busy ? 'Sending…' : 'Send'}</button>
                    </form>
                  </div>
                )}

                {view === 'compose' && (
                  <form className="md-form" onSubmit={handleSendNew}>
                    <header className="md-thread-header">
                      <button type="button" className="md-back" onClick={() => setView('threads')} aria-label="Back">←</button>
                      <strong>New message</strong>
                    </header>
                    {privileges.isStaff && teachingCourses.length > 0 && (
                      <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', background: 'rgba(0,0,0,0.25)', padding: '4px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <button
                          type="button"
                          className={`nav-btn md-small ${recipientMode === 'individual' ? 'primary' : 'secondary'}`}
                          style={{ flex: 1, padding: '6px 12px', fontSize: '0.85rem' }}
                          onClick={() => setRecipientMode('individual')}
                        >
                          👤 Individual Message
                        </button>
                        <button
                          type="button"
                          className={`nav-btn md-small ${recipientMode === 'group' ? 'primary' : 'secondary'}`}
                          style={{ flex: 1, padding: '6px 12px', fontSize: '0.85rem' }}
                          onClick={() => {
                            setRecipientMode('group');
                            if (!groupCourseId && teachingCourses[0]?.id) setGroupCourseId(String(teachingCourses[0].id));
                          }}
                        >
                          👥 Course Group Message
                        </button>
                      </div>
                    )}

                    {recipientMode === 'group' ? (
                      <>
                        <label className="md-label" htmlFor="md-group-course">Course Group</label>
                        <select
                          id="md-group-course"
                          className="form-input"
                          value={groupCourseId || teachingCourses[0]?.id || ''}
                          onChange={e => setGroupCourseId(e.target.value)}
                        >
                          {teachingCourses.map(c => (
                            <option key={c.id} value={c.id}>
                              {c.title}{c.students !== undefined ? ` (${c.students} students)` : ''}
                            </option>
                          ))}
                        </select>
                        <p className="md-sub" style={{ margin: '6px 0 14px 0', color: '#94a3b8' }}>
                          📢 Broadcast will be sent to all enrolled students in this course.
                        </p>
                      </>
                    ) : (
                      <>
                        <label className="md-label" htmlFor="md-to">To</label>
                        <select
                          id="md-to"
                          className="form-input"
                          value={composeTo}
                          onChange={e => {
                            const val = e.target.value;
                            setComposeTo(val);
                            setComposeCourseId('');
                            if (val !== '__search_name__') {
                              setNameSearchTerm('');
                              setDbSearchResults([]);
                              setSelectedSearchedUser(null);
                            }
                          }}
                        >
                          {(contacts || [{ email: SUPERADMIN_INBOX, name: '🛡️ Super Admin', courses: [] }]).map(c => (
                            <option key={c.email} value={c.email}>
                              {c.name}{c.email !== SUPERADMIN_INBOX ? ` — ${c.email}` : ''}{c.courses?.length ? ` (${c.courses.map(x => x.title).join(', ').slice(0, 60)})` : ''}
                            </option>
                          ))}
                          {privileges.isStaff && (
                            <>
                              <option value="__search_name__">🔍 Search by Name</option>
                              <option value="__typed__">✉️ Search by Email</option>
                            </>
                          )}
                        </select>
                        {contactsLoading && <small className="md-sub">Loading registered teachers and contacts…</small>}
                        {!privileges.isStaff && <small className="md-sub">You can message the Super Admin, or a teacher about one of their courses (yours, or a Global Course).</small>}
                        {privileges.isStaff && !isSuperadmin && <small className="md-sub">You can message the Super Admin, teachers, and students enrolled in your courses. Each message names the course.</small>}

                        {composeTo === '__search_name__' && (
                          <div className="md-name-search-box animate-fade-in" style={{ marginTop: '12px', marginBottom: '14px', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
                            <label className="md-label" htmlFor="md-name-search" style={{ marginTop: 0 }}>🔍 Search by Name (in database)</label>
                            <div style={{ position: 'relative' }}>
                              <input
                                id="md-name-search"
                                type="text"
                                className="form-input"
                                placeholder="Type name to search registered users in database..."
                                value={nameSearchTerm}
                                onChange={e => handleNameSearchChange(e.target.value)}
                                autoComplete="off"
                                autoFocus
                              />
                              {nameSearchTerm && (
                                <button
                                  type="button"
                                  style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1rem' }}
                                  onClick={() => { setNameSearchTerm(''); setDbSearchResults([]); setSelectedSearchedUser(null); }}
                                  aria-label="Clear search"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                            {isSearchingDb && <small className="md-sub" style={{ display: 'block', marginTop: '4px' }}>Searching database…</small>}
                            {selectedSearchedUser ? (
                              <div style={{ marginTop: '8px', padding: '10px 14px', background: 'rgba(52, 211, 153, 0.15)', border: '1px solid rgba(52, 211, 153, 0.4)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div>
                                  <span style={{ fontWeight: 600, color: '#34d399' }}>✓ Selected: </span>
                                  <span style={{ color: '#fff', fontWeight: 600 }}>{selectedSearchedUser.name}</span>
                                  <span style={{ color: '#94a3b8', fontSize: '0.82rem', marginLeft: '6px' }}>({selectedSearchedUser.email})</span>
                                </div>
                                <button
                                  type="button"
                                  className="nav-btn secondary md-small"
                                  style={{ padding: '2px 8px', fontSize: '0.75rem', borderColor: 'rgba(239, 68, 68, 0.4)', color: '#f87171' }}
                                  onClick={() => setSelectedSearchedUser(null)}
                                >
                                  ✕ Change
                                </button>
                              </div>
                            ) : (
                              dbSearchResults.length > 0 && (
                                <div className="md-search-dropdown animate-fade-in" style={{
                                  background: 'rgba(15, 38, 28, 0.98)',
                                  border: '1px solid rgba(52, 211, 153, 0.35)',
                                  borderRadius: '10px',
                                  maxHeight: '180px',
                                  overflowY: 'auto',
                                  marginTop: '6px',
                                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)'
                                }}>
                                  {dbSearchResults.map(u => (
                                    <div
                                      key={u.email || u.uid}
                                      style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer' }}
                                      className="md-search-option"
                                      onClick={() => {
                                        setSelectedSearchedUser(u);
                                        setContacts(prev => {
                                          const list = prev ? prev.slice() : [];
                                          if (!list.some(x => x.email === u.email)) {
                                            list.push({ email: u.email, name: u.name, kind: u.role || 'user', courses: [] });
                                          }
                                          return list;
                                        });
                                      }}
                                    >
                                      <div style={{ fontWeight: 600, color: '#fef08a' }}>{u.name}</div>
                                      <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{u.email}{u.role ? ` • ${u.role}` : ''}</div>
                                    </div>
                                  ))}
                                </div>
                              )
                            )}
                            {!selectedSearchedUser && nameSearchTerm.trim().length >= 2 && !isSearchingDb && dbSearchResults.length === 0 && (
                              <small className="md-sub" style={{ display: 'block', marginTop: '6px', color: '#fca5a5' }}>
                                No users found matching &ldquo;{nameSearchTerm}&rdquo; in database.
                              </small>
                            )}
                          </div>
                        )}

                        {composeTo === '__typed__' && (
                          <div className="md-search-email-box animate-fade-in" style={{ marginTop: '12px', marginBottom: '14px', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
                            <label className="md-label" htmlFor="md-typed-email" style={{ marginTop: 0 }}>✉️ Search by Email</label>
                            <input
                              id="md-typed-email"
                              type="email"
                              className="form-input"
                              placeholder="Type or enter recipient email..."
                              value={composeEmail}
                              onChange={e => setComposeEmail(e.target.value)}
                              aria-label="Recipient email"
                              autoFocus
                              required
                            />
                          </div>
                        )}
                        {courseOptions.length > 0 && (
                          <>
                            <label className="md-label" htmlFor="md-course">Course</label>
                            <select id="md-course" className="form-input" value={selectedCourse?.id || '__none__'} onChange={e => setComposeCourseId(e.target.value)}>
                              {isSuperadmin && <option value="__none__">— No course —</option>}
                              {courseOptions.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                            </select>
                          </>
                        )}
                      </>
                    )}
                    <label className="md-label" htmlFor="md-subject">Subject (optional)</label>
                    <input id="md-subject" className="form-input" maxLength={150} value={composeSubject} onChange={e => setComposeSubject(e.target.value)} />
                    <label className="md-label" htmlFor="md-body">Message</label>
                    <textarea id="md-body" className="form-input" rows={5} maxLength={MAX_MESSAGE_CHARS} value={composeBody} onChange={e => setComposeBody(e.target.value)} required />
                    <div className="md-form-actions">
                      <span className="md-sub">{composeBody.length}/{MAX_MESSAGE_CHARS}</span>
                      <button type="submit" className="nav-btn primary" disabled={busy || !composeBody.trim()}>{busy ? 'Sending…' : 'Send message'}</button>
                    </div>
                  </form>
                )}

                {view === 'request' && (
                  <form className="md-form" onSubmit={handleRequestTokens}>
                    <header className="md-thread-header">
                      <button type="button" className="md-back" onClick={() => setView('threads')} aria-label="Back">←</button>
                      <strong>🪙 Ask the Super Admin for tokens</strong>
                    </header>
                    <label className="md-label" htmlFor="md-amount">Tokens needed (1–{MAX_GRANT_TOKENS})</label>
                    <input id="md-amount" type="number" min="1" max={MAX_GRANT_TOKENS} step="1" className="form-input" value={requestAmount} onChange={e => setRequestAmount(e.target.value)} required />
                    <label className="md-label" htmlFor="md-reason">Why do you need them? (optional)</label>
                    <textarea id="md-reason" className="form-input" rows={4} maxLength={1000} value={requestReason} onChange={e => setRequestReason(e.target.value)} placeholder="e.g. To enrol in Certificate IV in Cyber Security" />
                    <div className="md-form-actions">
                      <span className="md-sub">Sent as an amber “Token Request” message.</span>
                      <button type="submit" className="nav-btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
                    </div>
                  </form>
                )}

                {view === 'threads' && (
                  <div className="md-placeholder">
                    <p>Select a conversation, or start a new one.</p>
                    <div className="md-legend-grid">
                      {legend.map(c => (
                        <div key={c}><CategoryTag category={c} /> <span className="md-sub">{
                          { teacher: 'from teachers', student: 'from students', application: 'teacher applications', token_request: 'token requests & purchases', grant: 'tokens given', support: 'questions for the Super Admin', admin: 'from the Super Admin' }[c]
                        }</span></div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .md-dock {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 900;
          display: flex;
          flex-direction: column;
        }
        .md-bar {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 16px;
          border-radius: 20px;
          background: linear-gradient(135deg, rgba(0, 132, 61, 0.95), rgba(0, 90, 43, 0.95));
          color: #fff;
          font-size: 0.9rem;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
          border: 1px solid rgba(255, 255, 255, 0.15);
          cursor: pointer;
        }
        .md-bar:hover { transform: translateY(-1px); }
        .md-bar-title { font-weight: 800; white-space: nowrap; }
        .md-bar-legend { display: flex; gap: 4px; overflow: hidden; flex: 1; min-width: 0; flex-wrap: nowrap; }
        .md-bar-chevron { font-size: 0.75rem; opacity: 0.85; }
        .md-modal-overlay {
          position: fixed;
          inset: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(0, 0, 0, 0.78);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 9999;
          padding: 16px;
          box-sizing: border-box;
        }
        .md-modal-content {
          width: 100%;
          max-width: 980px;
          height: min(680px, 88vh);
          display: flex;
          flex-direction: column;
          border-radius: 22px;
          background: rgba(10, 31, 22, 0.98);
          border: 1px solid rgba(52, 211, 153, 0.35);
          box-shadow: 0 25px 60px rgba(0, 0, 0, 0.75), 0 0 35px rgba(52, 211, 153, 0.1);
          padding: 0 !important;
          margin: auto !important;
          overflow: hidden;
          position: relative;
        }
        .md-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 20px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(0, 0, 0, 0.3);
          gap: 12px;
        }
        .md-modal-legend {
          display: flex;
          gap: 4px;
          overflow: hidden;
          flex: 1;
          min-width: 0;
          flex-wrap: wrap;
        }
        .md-modal-close {
          position: static !important;
          background: rgba(255, 255, 255, 0.08) !important;
          border: none !important;
          color: #94a3b8 !important;
          font-size: 1.25rem !important;
          width: 32px !important;
          height: 32px !important;
          border-radius: 50% !important;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 !important;
          flex-shrink: 0;
          transition: all 0.2s ease;
        }
        .md-modal-close:hover {
          background: rgba(255, 255, 255, 0.2) !important;
          color: #fff !important;
        }
        .md-unread {
          background: #ef4444; color: #fff; border-radius: 999px; padding: 1px 8px;
          font-size: 0.75rem; font-weight: 800; min-width: 22px; text-align: center;
        }
        .md-unread.small { font-size: 0.68rem; padding: 0 6px; }
        .md-tag {
          display: inline-flex; align-items: center; gap: 3px; padding: 1px 7px; border-radius: 999px;
          border: 1px solid; font-weight: 700; white-space: nowrap; line-height: 1.5;
        }
        .md-panel {
          height: min(560px, 72vh);
          display: flex;
          flex-direction: column;
          background: rgba(10, 31, 22, 0.97);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-bottom: none;
          overflow: hidden;
        }
        .md-notice { margin: 8px 12px 0; padding: 8px 12px; border-radius: 10px; font-size: 0.85rem; }
        .md-notice.success { background: rgba(34, 197, 94, 0.18); color: #bbf7d0; border: 1px solid rgba(74, 222, 128, 0.4); }
        .md-notice.error { background: rgba(239, 68, 68, 0.18); color: #fecaca; border: 1px solid rgba(248, 113, 113, 0.45); }
        .md-layout { display: grid; grid-template-columns: 320px 1fr; flex: 1; min-height: 0; }
        .md-threads { border-right: 1px solid rgba(255, 255, 255, 0.1); display: flex; flex-direction: column; min-height: 0; }
        .md-actions { display: flex; gap: 6px; padding: 10px; flex-wrap: wrap; }
        .md-small { padding: 6px 12px !important; font-size: 0.8rem !important; }
        .md-filters { display: flex; gap: 4px; padding: 0 10px 8px; flex-wrap: wrap; }
        .md-filter {
          padding: 3px 9px; font-size: 0.72rem; border-radius: 999px; background: transparent;
          color: var(--text-secondary); border: 1px solid rgba(255, 255, 255, 0.18);
        }
        .md-filter.active { background: rgba(255, 255, 255, 0.14); color: #fff; }
        .md-thread-list { overflow-y: auto; flex: 1; padding: 0 6px 10px; }
        .md-thread {
          display: block; width: 100%; text-align: left; border-radius: 10px; padding: 9px 10px; margin-bottom: 4px;
          background: rgba(255, 255, 255, 0.03); color: var(--text-primary); border: 1px solid transparent; font-family: 'Inter', sans-serif;
        }
        .md-thread:hover { background: rgba(255, 255, 255, 0.08); transform: none; }
        .md-thread.active { border-color: rgba(52, 211, 153, 0.6); background: rgba(16, 185, 129, 0.12); }
        .md-thread-top { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 0.88rem; }
        .md-thread-tags { display: flex; gap: 3px; flex-wrap: wrap; margin: 4px 0; }
        .md-thread-snippet { font-size: 0.8rem; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .md-thread-time { font-size: 0.7rem; color: #94a3b8; margin-top: 2px; }
        .md-empty { color: #94a3b8; font-size: 0.85rem; padding: 12px; text-align: center; }
        .md-main { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
        .md-thread-view { display: flex; flex-direction: column; height: 100%; min-height: 0; }
        .md-thread-header { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
        .md-back { display: none; padding: 4px 10px; font-size: 1rem; background: rgba(255,255,255,0.08); color: #fff; }
        .md-sub { font-size: 0.75rem; color: #94a3b8; }
        .md-messages { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
        .md-bubble {
          max-width: 82%; align-self: flex-start; background: rgba(255, 255, 255, 0.07);
          border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 8px 12px;
        }
        .md-bubble.mine { align-self: flex-end; background: rgba(16, 185, 129, 0.16); border-color: rgba(52, 211, 153, 0.35); }
        .md-bubble-meta { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 0.72rem; color: #94a3b8; margin-bottom: 4px; }
        .md-bubble-subject { font-weight: 700; font-size: 0.86rem; margin-bottom: 2px; }
        .md-bubble-body { white-space: pre-wrap; word-break: break-word; font-size: 0.88rem; line-height: 1.45; }
        .md-link { color: inherit; text-decoration: underline; word-break: break-all; }
        .md-grant { margin-top: 8px; }
        .md-composer { display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid rgba(255, 255, 255, 0.1); align-items: flex-end; }
        .md-composer textarea { flex: 1; resize: none; }
        .md-form { display: flex; flex-direction: column; gap: 6px; padding: 0 14px 14px; overflow-y: auto; }
        .md-form .md-thread-header { margin: 0 -14px 6px; }
        .md-label { font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-top: 6px; }
        .md-form-actions { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; gap: 8px; }
        .md-placeholder { padding: 20px; color: var(--text-secondary); overflow-y: auto; }
        .md-legend-grid { display: grid; gap: 8px; margin-top: 10px; }
        .md-del-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          padding: 0;
          margin-left: auto;
          background: rgba(239, 68, 68, 0.16);
          border: 1px solid rgba(239, 68, 68, 0.45);
          border-radius: 4px;
          color: #f87171;
          font-size: 0.7rem;
          font-weight: 700;
          line-height: 1;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .md-del-btn:hover {
          background: rgba(239, 68, 68, 0.45);
          border-color: #ef4444;
          color: #ffffff;
          transform: scale(1.1);
        }
        .md-archive-bar {
          margin-top: auto;
          padding: 10px 14px;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(0, 0, 0, 0.25);
        }
        .md-archive-btn {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 8px;
          color: #cbd5e1;
          font-size: 0.82rem;
          cursor: pointer;
          transition: background 0.2s ease, border-color 0.2s ease;
        }
        .md-archive-btn:hover {
          background: rgba(52, 211, 153, 0.1);
          border-color: rgba(52, 211, 153, 0.35);
          color: #fef08a;
        }
        .md-archive-btn.active {
          background: rgba(52, 211, 153, 0.18);
          border-color: rgba(52, 211, 153, 0.5);
          color: #34d399;
          font-weight: 600;
        }
        .md-archive-retention-tag {
          font-size: 0.68rem;
          padding: 2px 6px;
          border-radius: 6px;
          background: rgba(234, 179, 8, 0.15);
          border: 1px solid rgba(234, 179, 8, 0.35);
          color: #fef08a;
        }
        @media (max-width: 760px) {
          .md-layout { grid-template-columns: 1fr; }
          .md-layout.view-thread .md-threads,
          .md-layout.view-compose .md-threads,
          .md-layout.view-request .md-threads { display: none; }
          .md-layout.view-threads .md-main { display: none; }
          .md-back { display: inline-block; }
          .md-bar-legend { display: none; }
          .md-panel { height: 78vh; }
        }
      `}</style>
    </>
  );
}
