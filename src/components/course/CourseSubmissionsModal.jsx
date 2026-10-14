import React, { useCallback, useEffect, useState } from 'react';
import { listCourseSubmissions, gradeSubmission, MAX_FEEDBACK_CHARS } from '../../services/submissionService';
import { isHttpUrl } from '../../services/courseSpreadsheetSchema';
import { moveUnitAssessmentsToCourse } from '../../types/courseBuilderTypes';
import { listCourseQuizzes } from '../../services/quizModel';
import QuizMarkingPanel from './QuizMarkingPanel.jsx';

function SubmissionCard({ submission, currentUser, onGraded, onMessageStudent }) {
  const [grade, setGrade] = useState(submission.grade || '');
  const [feedback, setFeedback] = useState(submission.feedback || '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const handleSave = async (e) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const update = await gradeSubmission({ submissionId: submission.id, grade, feedback, grader: currentUser });
      setNotice({ type: 'success', message: 'Grade saved — the student can see it now.' });
      onGraded({ ...submission, ...update });
    } catch (err) {
      setNotice({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cs-card">
      <div className="cs-row">
        <div>
          <strong>{submission.studentName || submission.studentEmail}</strong>
          <div className="cs-muted">{submission.studentEmail}</div>
        </div>
        <div className="cs-right">
          <span className={`cs-status ${submission.status}`}>{submission.status === 'graded' ? `Graded: ${submission.grade}` : submission.status === 'draft' ? '✏️ Draft (not submitted)' : 'Awaiting grade'}</span>
          <div className="cs-muted">
            {submission.submittedAtMs ? new Date(submission.submittedAtMs).toLocaleString() : submission.draftSavedAtMs ? `Draft saved ${new Date(submission.draftSavedAtMs).toLocaleString()}` : ''}
            {Number(submission.attempts) > 1 ? ` • attempt ${submission.attempts}` : ''}
          </div>
        </div>
      </div>
      {submission.text && <div className="cs-answer">{submission.text}</div>}
      {isHttpUrl(submission.linkUrl) && (
        <a className="cs-link" href={submission.linkUrl} target="_blank" rel="noopener noreferrer">🔗 Open submitted link ↗</a>
      )}
      <form className="cs-grade" onSubmit={handleSave}>
        <input className="form-input" value={grade} onChange={e => setGrade(e.target.value)} maxLength={60} placeholder="Grade (e.g. 85%, Competent, HD)" aria-label="Grade" required />
        <textarea className="form-input" rows={2} value={feedback} maxLength={MAX_FEEDBACK_CHARS} onChange={e => setFeedback(e.target.value)} placeholder="Feedback for the student (optional)" aria-label="Feedback" />
        <div className="cs-row">
          <button type="button" className="nav-btn secondary cs-small" onClick={() => onMessageStudent?.(submission)}>💬 Message student</button>
          <button type="submit" className="nav-btn primary cs-small" disabled={busy || !grade.trim()}>{busy ? 'Saving…' : 'Save grade'}</button>
        </div>
        {notice && <div className={`cs-notice ${notice.type}`} role="status">{notice.message}</div>}
      </form>
    </div>
  );
}

/** Teacher view: course assessment submissions (grouped by assessment) and bulk unit-quiz marking. */
export default function CourseSubmissionsModal({ course, currentUser, onClose, onMessageStudent }) {
  const [view, setView] = useState('assessments'); // 'assessments' | 'quizzes'
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Resolves to the next state; never rejects.
  const fetchSubmissions = useCallback(() => listCourseSubmissions(course.id)
    .then(list => ({ list, error: '' }))
    .catch(err => ({
      list: [],
      error: err?.code === 'permission-denied'
        ? 'You do not have permission to view these submissions (the latest Firestore rules may not be published yet).'
        : 'Submissions could not be loaded. Check your connection and try again.'
    })), [course.id]);

  const applyResult = (result) => {
    setSubmissions(result.list);
    setError(result.error);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    fetchSubmissions().then(result => {
      if (cancelled) return;
      setSubmissions(result.list);
      setError(result.error);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchSubmissions]);

  const load = async () => {
    setLoading(true);
    setError('');
    applyResult(await fetchSubmissions());
  };

  // One Assessments & Rubrics list per course (older courses: tasks moved up from their units).
  const structured = moveUnitAssessmentsToCourse(course);
  const assessments = (structured.assessments || []).filter(a => a && typeof a === 'object').map(a => {
    const unit = (structured.units || []).find(u => u?.id && u.id === a.unitId);
    return { ...a, unitTitle: unit?.unitTitle || '', unitCode: unit?.unitCode || '' };
  });
  const quizCount = listCourseQuizzes(structured).length;
  const known = new Set(assessments.map(a => String(a.id)));
  const orphaned = submissions.filter(s => !known.has(String(s.assessmentId)));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="glass modal-content cs-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="cs-title">
        <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>
        <h2 id="cs-title" style={{ marginBottom: 4 }}>📥 Submissions</h2>
        <p className="cs-muted" style={{ textAlign: 'center', marginTop: 0 }}>{course.title} • {submissions.length} submission{submissions.length === 1 ? '' : 's'}</p>
        <div className="cs-tabs" role="tablist" aria-label="Marking">
          <button type="button" role="tab" aria-selected={view === 'assessments'} className={view === 'assessments' ? 'active' : ''} onClick={() => setView('assessments')}>
            📥 Assessments ({assessments.length})
          </button>
          <button type="button" role="tab" aria-selected={view === 'quizzes'} className={view === 'quizzes' ? 'active' : ''} onClick={() => setView('quizzes')}>
            ❓ Unit quizzes ({quizCount})
          </button>
        </div>
        {view === 'quizzes' ? <QuizMarkingPanel course={course} currentUser={currentUser} /> : (
        <>
        <div className="cs-row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="nav-btn secondary cs-small" onClick={load} disabled={loading}>↻ Refresh</button>
        </div>
        {loading && <p className="cs-muted">Loading submissions…</p>}
        {error && <div className="cs-notice error" role="alert">{error}</div>}
        {!loading && !error && assessments.length === 0 && <p className="cs-muted">This course has no assessments yet.</p>}

        {!loading && !error && assessments.map(a => {
          const list = submissions.filter(s => String(s.assessmentId) === String(a.id));
          return (
            <section key={a.id} className="cs-section">
              <h3>{a.title} <span className="cs-muted">({a.unitCode ? `${a.unitCode} • ` : ''}{list.length} submitted)</span></h3>
              {list.length === 0 ? <p className="cs-muted">No submissions yet.</p> : list.map(s => (
                <SubmissionCard
                  key={s.id}
                  submission={s}
                  currentUser={currentUser}
                  onMessageStudent={onMessageStudent}
                  onGraded={updated => setSubmissions(prev => prev.map(x => (x.id === updated.id ? updated : x)))}
                />
              ))}
            </section>
          );
        })}
        {!loading && orphaned.length > 0 && (
          <section className="cs-section">
            <h3>Other submissions <span className="cs-muted">(assessment no longer in the course)</span></h3>
            {orphaned.map(s => (
              <SubmissionCard key={s.id} submission={s} currentUser={currentUser} onMessageStudent={onMessageStudent}
                onGraded={updated => setSubmissions(prev => prev.map(x => (x.id === updated.id ? updated : x)))} />
            ))}
          </section>
        )}
        </>
        )}

        <style>{`
          .cs-tabs { display: flex; gap: 6px; margin: 8px 0 4px; border-bottom: 1px solid rgba(255,255,255,0.12); }
          .cs-tabs button { background: none; border: none; color: #94a3b8; font-weight: 700; padding: 8px 12px; cursor: pointer; border-bottom: 3px solid transparent; }
          .cs-tabs button.active { color: #f1f5f9; border-bottom-color: #a78bfa; }
          .cs-modal { max-width: 900px; max-height: 90vh; overflow-y: auto; padding: 28px; }
          .cs-muted { color: #94a3b8; font-size: 0.82rem; font-weight: 400; }
          .cs-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
          .cs-right { text-align: right; }
          .cs-section { margin-top: 16px; }
          .cs-section h3 { font-size: 1.05rem; margin: 0 0 8px; }
          .cs-card { border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; background: rgba(0,0,0,0.2); }
          .cs-answer { white-space: pre-wrap; background: rgba(255,255,255,0.05); border-radius: 8px; padding: 8px 10px; margin: 8px 0; font-size: 0.88rem; max-height: 240px; overflow-y: auto; overflow-wrap: anywhere; }
          .cs-link { color: #fcd34d; font-weight: 600; text-decoration: none; display: inline-block; margin: 4px 0; }
          .cs-grade { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
          .cs-status { font-size: 0.75rem; font-weight: 800; padding: 2px 8px; border-radius: 6px; background: rgba(59,130,246,0.25); color: #bfdbfe; }
          .cs-status.graded { background: rgba(34,197,94,0.25); color: #bbf7d0; }
          .cs-small { padding: 6px 12px !important; font-size: 0.8rem !important; }
          .cs-notice { padding: 8px 12px; border-radius: 10px; font-size: 0.85rem; margin: 6px 0; }
          .cs-notice.success { background: rgba(34,197,94,0.18); color: #bbf7d0; }
          .cs-notice.error { background: rgba(239,68,68,0.18); color: #fecaca; }
        `}</style>
      </div>
    </div>
  );
}
