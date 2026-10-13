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
  normalizeEmail
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

/**
 * Message board dock shown at the bottom of every signed-in panel.
 * @param {object[]} teachingCourses courses the user teaches (for "message my students")
 * @param {object[]} enrolledCourses courses the user studies in (for "message my teacher")
 */
export default function MessageDock({ ref, currentUser, userProfile, teachingCourses = [], enrolledCourses = [], onBalanceChanged }) {
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
  const [requestAmount, setRequestAmount] = useState('50');
  const [requestReason, setRequestReason] = useState('');

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

  const threads = useMemo(() => groupThreads(messages, { email: myEmail, isSuperadmin }), [messages, myEmail, isSuperadmin]);
  const unreadTotal = useMemo(() => threads.reduce((n, t) => n + t.unread, 0), [threads]);
  const visibleThreads = filter === 'all' ? threads : threads.filter(t => t.categories.includes(filter));
  const selectedThread = threads.find(t => t.threadId === selectedThreadId) || null;

  // Opening a thread marks its incoming messages as read.
  useEffect(() => {
    if (!isOpen || view !== 'thread' || !selectedThread || selectedThread.unread === 0) return;
    markMessagesRead(selectedThread.messages, { email: myEmail, isSuperadmin });
  }, [isOpen, view, selectedThread, myEmail, isSuperadmin]);

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
        listMembers: listCourseMembers,
        selfEmail: myEmail
      });
      if (!mountedRef.current) return;
      // Keep any contact added directly (e.g. "Message teacher") that the list does not include.
      setContacts(prev => [...list, ...(prev || []).filter(c => !list.some(x => x.email === c.email))]);
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
    setComposeEmail('');
    setComposeSubject('');
    setComposeBody('');
    setView('compose');
    ensureContacts();
  };

  // Other panels start a message with dockRef.current.compose({ to, toName, courseId, courseTitle, subject }).
  useImperativeHandle(ref, () => ({
    compose(request) {
      const to = normalizeEmail(request?.to);
      if (!to) return;
      setIsOpen(true);
      setView('compose');
      setComposeSubject(request.subject || '');
      setComposeBody('');
      setComposeEmail(to);
      setContacts(prev => {
        const list = prev ? prev.slice() : [{ email: SUPERADMIN_INBOX, name: '🛡️ Super Admin', kind: 'superadmin', courses: [] }];
        if (!list.some(c => c.email === to)) {
          list.push({
            email: to,
            name: request.toName || to,
            kind: 'direct',
            courses: request.courseId ? [{ id: String(request.courseId), title: request.courseTitle || 'Course' }] : []
          });
        }
        return list;
      });
      setComposeTo(to);
      ensureContacts();
    }
  }));

  const sender = currentUser ? { uid: currentUser.uid, email: currentUser.email, displayName: currentUser.displayName } : null;

  const handleSendReply = async (e) => {
    e.preventDefault();
    if (!selectedThread || !reply.trim()) return;
    const partner = selectedThread.partnerEmail;
    const courseRef = selectedThread.messages.slice().reverse().find(m => m.courseId);
    setBusy(true);
    try {
      await sendMessage({
        sender,
        senderProfile: userProfile,
        to: partner,
        toName: selectedThread.partnerName,
        body: reply,
        courseId: courseRef?.courseId || '',
        courseTitle: courseRef?.courseTitle || ''
      });
      setReply('');
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSendNew = async (e) => {
    e.preventDefault();
    const typed = normalizeEmail(composeEmail);
    const to = composeTo === '__typed__' ? typed : composeTo;
    if (composeTo === '__typed__' && !isValidEmail(typed)) {
      flash('error', 'Enter a valid email address.');
      return;
    }
    const contact = (contacts || []).find(c => c.email === to);
    setBusy(true);
    try {
      const sent = await sendMessage({
        sender,
        senderProfile: userProfile,
        to,
        toName: contact?.name || '',
        subject: composeSubject,
        body: composeBody,
        courseId: contact?.courses?.[0]?.id || '',
        courseTitle: contact?.courses?.[0]?.title || ''
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

  const legend = ['teacher', 'student', 'application', 'token_request', 'grant', 'support', 'admin'];

  return (
    <>
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

        {isOpen && (
          <div className="md-panel glass">
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
                  {visibleThreads.length === 0 ? (
                    <p className="md-empty">{messages.length === 0 ? 'No messages yet. Start a conversation with ✏️ New message.' : 'No conversations in this category.'}</p>
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
                        {t.unread > 0 && <span className="md-unread small">{t.unread}</span>}
                      </div>
                      <div className="md-thread-tags">{t.categories.map(c => <CategoryTag key={c} category={c} small />)}</div>
                      <div className="md-thread-snippet">{t.latest.subject || t.latest.body}</div>
                      <div className="md-thread-time">{formatTime(t.latest.createdAtMs)}{t.courseTitle ? ` • ${t.courseTitle}` : ''}</div>
                    </button>
                  ))}
                </div>
              </aside>

              {/* Right side */}
              <section className="md-main">
                {view === 'thread' && selectedThread && (
                  <div className="md-thread-view">
                    <header className="md-thread-header">
                      <button type="button" className="md-back" onClick={() => setView('threads')} aria-label="Back to conversations">←</button>
                      <div>
                        <strong>{selectedThread.partnerName}</strong>
                        <div className="md-sub">{selectedThread.partnerEmail === SUPERADMIN_INBOX ? 'Super Admin team' : selectedThread.partnerEmail}</div>
                      </div>
                    </header>
                    <div className="md-messages">
                      {selectedThread.messages.map(m => {
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
                    <label className="md-label" htmlFor="md-to">To</label>
                    <select id="md-to" className="form-input" value={composeTo} onChange={e => setComposeTo(e.target.value)}>
                      {(contacts || [{ email: SUPERADMIN_INBOX, name: '🛡️ Super Admin', courses: [] }]).map(c => (
                        <option key={c.email} value={c.email}>
                          {c.name}{c.email !== SUPERADMIN_INBOX ? ` — ${c.email}` : ''}{c.courses?.length ? ` (${c.courses.map(x => x.title).join(', ').slice(0, 60)})` : ''}
                        </option>
                      ))}
                      {isSuperadmin && <option value="__typed__">✉️ Another registered email…</option>}
                    </select>
                    {contactsLoading && <small className="md-sub">Loading your students and teachers…</small>}
                    {!privileges.isStaff && <small className="md-sub">You can message the Super Admin and the teachers of your courses.</small>}
                    {privileges.isStaff && !isSuperadmin && <small className="md-sub">You can message the Super Admin and students enrolled in your courses.</small>}
                    {composeTo === '__typed__' && (
                      <input type="email" className="form-input" placeholder="person@example.com" value={composeEmail} onChange={e => setComposeEmail(e.target.value)} aria-label="Recipient email" required />
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
        )}
      </div>

      <style>{`
        .md-dock {
          position: fixed;
          left: 50%;
          bottom: 0;
          transform: translateX(-50%);
          width: min(1040px, 100vw);
          z-index: 900;
          display: flex;
          flex-direction: column;
          pointer-events: none;
        }
        .md-dock > * { pointer-events: auto; }
        .md-bar {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 10px 18px;
          border-radius: 16px 16px 0 0;
          background: linear-gradient(135deg, rgba(0, 132, 61, 0.95), rgba(0, 90, 43, 0.95));
          color: #fff;
          font-size: 0.95rem;
          box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.35);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-bottom: none;
        }
        .md-bar:hover { transform: none; }
        .md-bar-title { font-weight: 800; white-space: nowrap; }
        .md-bar-legend { display: flex; gap: 4px; overflow: hidden; flex: 1; min-width: 0; flex-wrap: nowrap; }
        .md-bar-chevron { font-size: 0.75rem; opacity: 0.85; }
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
