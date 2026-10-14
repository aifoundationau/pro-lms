import React, { useEffect, useState } from 'react';
import { moveUnitAssessmentsToCourse } from '../../types/courseBuilderTypes';
import {
  listCourseQuizzes,
  mergeQuizAnswerKeys,
  normalizeQuiz,
  scoreQuizAttempt,
  quizResultsTable,
  questionTypeLabel,
  MAX_QUIZ_FEEDBACK_CHARS
} from '../../services/quizModel';
import { loadQuizAnswerKeys, listCourseQuizAttempts, releaseQuizResults } from '../../services/quizService';
import { listCourseMembers, normalizeMemberEmail } from '../../services/courseEnrollmentService';
import { buildXlsxWorkbook, downloadFile, safeFileStem, XLSX_STYLE } from '../../services/xlsxWriter';

function answerText(question, value) {
  if (value === undefined) return '';
  if (question.type === 'multiple_choice') {
    const chosen = new Set(Array.isArray(value) ? value : []);
    return (question.options || []).filter(o => chosen.has(o.id)).map(o => o.text).join(', ');
  }
  if (question.type === 'true_false') return value ? 'True' : 'False';
  return String(value);
}

/** Loads everything the marking view needs; resolves to a state object and never rejects. */
async function loadMarkingData(courseId) {
  const [keysResult, attempts, roster] = await Promise.all([
    loadQuizAnswerKeys(courseId),
    listCourseQuizAttempts(courseId).then(list => ({ list, error: '' })).catch(err => ({
      list: [],
      error: err?.code === 'permission-denied'
        ? 'You do not have permission to view these quiz attempts (the latest Firestore rules may not be published yet).'
        : 'Quiz attempts could not be loaded. Check your connection and try again.'
    })),
    listCourseMembers(courseId).catch(() => [])
  ]);
  return {
    courseId,
    keys: keysResult.keys,
    keysOk: keysResult.ok,
    attempts: attempts.list,
    error: attempts.error,
    roster
  };
}

/**
 * Bulk marking for unit quizzes: closed questions are marked automatically, open answers are marked
 * question by question across the class, then results are released to every student at once.
 */
export default function QuizMarkingPanel({ course, currentUser }) {
  const [data, setData] = useState({ courseId: null, keys: {}, keysOk: false, attempts: [], error: '', roster: [] });
  const [selectedQuizId, setSelectedQuizId] = useState('');
  const [manualScores, setManualScores] = useState({}); // attemptId -> questionId -> points
  const [feedback, setFeedback] = useState({}); // attemptId -> text
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const loading = data.courseId !== course.id || data.reloadKey !== reloadKey;

  const courseId = course.id;
  useEffect(() => {
    let cancelled = false;
    loadMarkingData(courseId).then(next => {
      if (!cancelled) setData({ ...next, reloadKey });
    });
    return () => {
      cancelled = true;
    };
  }, [courseId, reloadKey]);

  const teacherCourse = mergeQuizAnswerKeys(moveUnitAssessmentsToCourse(course), data.keys);
  const quizzes = listCourseQuizzes(teacherCourse);
  const selected = quizzes.find(q => q.block.id === selectedQuizId) || quizzes[0] || null;
  const quiz = selected ? normalizeQuiz(selected.block.quiz) : null;
  const quizAttempts = selected ? data.attempts.filter(a => a.quizId === selected.block.id) : [];
  const open = quizAttempts.filter(a => a.status !== 'graded');
  const marked = new Map(quizAttempts.map(a => [a.id, a.status === 'graded'
    ? { score: a.score, maxScore: a.maxScore, percent: a.percent, pending: 0, results: a.results || [] }
    : scoreQuizAttempt(quiz, a.answers, manualScores[a.id] || {})]));
  const ready = open.filter(a => marked.get(a.id)?.pending === 0);
  const toMark = open.filter(a => marked.get(a.id)?.pending > 0);
  const released = quizAttempts.filter(a => a.status === 'graded');
  const average = quizAttempts.length
    ? Math.round(quizAttempts.reduce((sum, a) => sum + (marked.get(a.id)?.percent || 0), 0) / quizAttempts.length)
    : 0;
  const attemptedEmails = new Set(quizAttempts.map(a => normalizeMemberEmail(a.studentEmail)));
  const notAttempted = data.roster.filter(m => (m.memberRole || 'student') === 'student' && m.memberEmail && !attemptedEmails.has(normalizeMemberEmail(m.memberEmail)));
  // Questions marked by hand: open questions, short answers (always reviewable), and any without a key.
  const handMarked = (quiz?.questions || []).filter(q => q.type === 'open' || q.type === 'short_answer' ||
    (q.type === 'multiple_choice' && !(q.correctOptionIds || []).length) || (q.type === 'true_false' && typeof q.correctAnswer !== 'boolean'));

  const setScore = (attemptId, questionId, value) => {
    setManualScores(prev => {
      const forAttempt = { ...(prev[attemptId] || {}) };
      if (value === '' || value === null || value === undefined) delete forAttempt[questionId];
      else forAttempt[questionId] = Number(value);
      return { ...prev, [attemptId]: forAttempt };
    });
  };

  const handleRelease = async () => {
    if (!ready.length || !quiz) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await releaseQuizResults({ quiz, attempts: ready, manualScoresByAttempt: manualScores, feedbackByAttempt: feedback, grader: currentUser });
      const byId = new Map(result.released.map(item => [item.id, item.update]));
      setData(prev => ({ ...prev, attempts: prev.attempts.map(a => (byId.has(a.id) ? { ...a, ...byId.get(a.id), gradedAtMs: Date.now() } : a)) }));
      const parts = [`✓ Released results to ${result.released.length} student${result.released.length === 1 ? '' : 's'}.`];
      if (result.skipped.length) parts.push(`${result.skipped.length} still need marking.`);
      if (result.failed.length) parts.push(`${result.failed.length} could not be saved — try again.`);
      setNotice({ type: result.failed.length ? 'error' : 'success', message: parts.join(' ') });
    } catch (err) {
      setNotice({ type: 'error', message: err.message || 'Results could not be released.' });
    } finally {
      setBusy(false);
    }
  };

  const handleExport = () => {
    try {
      const { header, rows } = quizResultsTable(quiz, quizAttempts, manualScores);
      const bytes = buildXlsxWorkbook([{
        name: 'Results',
        freezeRows: 1,
        columns: header.map((_, i) => ({ width: i < 2 ? 28 : i === 2 ? 18 : 10 })),
        rows: [header.map(h => ({ v: h, s: XLSX_STYLE.HEADER })), ...rows]
      }]);
      downloadFile(bytes, `${safeFileStem(`${course.title}_${selected.block.title || 'quiz'}`, 'Quiz')}_results.xlsx`);
    } catch {
      setNotice({ type: 'error', message: 'The results spreadsheet could not be created.' });
    }
  };

  if (loading) return <p className="qm-muted">Loading quiz attempts…</p>;
  if (!quizzes.length) {
    return <p className="qm-muted">This course has no unit quizzes yet. Add a ❓ Quiz & Questions block to a lesson in Course Builder.</p>;
  }

  return (
    <div className="qm-root">
      {data.error && <div className="qm-notice error" role="alert">{data.error}</div>}
      {!data.keysOk && (
        <div className="qm-notice error" role="alert">
          ⚠️ The answer keys could not be loaded, so closed questions cannot be marked automatically right now. Refresh to try again.
        </div>
      )}
      <div className="qm-row">
        <label className="qm-label" htmlFor="qm-quiz">Quiz</label>
        <select id="qm-quiz" className="form-input qm-select" value={selected?.block.id || ''} onChange={e => { setSelectedQuizId(e.target.value); setNotice(null); }}>
          {quizzes.map(({ unit, lesson, block }) => {
            const count = data.attempts.filter(a => a.quizId === block.id).length;
            return (
              <option key={block.id} value={block.id}>
                {unit.unitCode ? `${unit.unitCode} • ` : ''}{lesson.title || 'Lesson'} • {block.title || 'Quiz'} ({count} submitted)
              </option>
            );
          })}
        </select>
        <button type="button" className="nav-btn secondary qm-small" onClick={() => setReloadKey(k => k + 1)} disabled={busy}>↻ Refresh</button>
      </div>

      <div className="qm-stats" aria-label="Quiz summary">
        <div className="qm-stat"><strong>{quizAttempts.length}</strong><span>submitted</span></div>
        <div className="qm-stat"><strong>{toMark.length}</strong><span>to mark</span></div>
        <div className="qm-stat"><strong>{ready.length}</strong><span>ready to release</span></div>
        <div className="qm-stat"><strong>{released.length}</strong><span>released</span></div>
        <div className="qm-stat"><strong>{average}%</strong><span>average</span></div>
      </div>

      <div className="qm-row">
        <button type="button" className="nav-btn primary" onClick={handleRelease} disabled={busy || !ready.length}>
          {busy ? 'Releasing…' : `✅ Release results to all ready (${ready.length})`}
        </button>
        <button type="button" className="nav-btn secondary" onClick={handleExport} disabled={!quizAttempts.length}>⬇ Export results (.xlsx)</button>
      </div>
      {notice && <div className={`qm-notice ${notice.type}`} role="status">{notice.message}</div>}
      {notAttempted.length > 0 && (
        <details className="qm-details">
          <summary>{notAttempted.length} enrolled student{notAttempted.length === 1 ? ' has' : 's have'} not attempted this quiz</summary>
          <ul>{notAttempted.map(m => <li key={m.id || m.memberEmail}>{m.memberName || m.memberEmail} <span className="qm-muted">{m.memberEmail}</span></li>)}</ul>
        </details>
      )}

      {open.length > 0 && handMarked.length > 0 && (
        <section className="qm-section">
          <h4>✍️ Mark by question</h4>
          <p className="qm-muted">Closed questions are marked automatically. Score the answers below (short answers are pre-marked against your accepted answers — change any mark).</p>
          {handMarked.map(question => {
            const index = quiz.questions.indexOf(question);
            const answeredAttempts = open.filter(a => a.answers?.[question.id] !== undefined);
            return (
              <div key={question.id} className="qm-question">
                <div className="qm-question-head">
                  <strong>Q{index + 1}. {question.prompt || 'Question'}</strong>
                  <span className="qm-muted">{questionTypeLabel(question.type)} • {question.points} pt{question.points === 1 ? '' : 's'}</span>
                </div>
                {question.modelAnswer && <div className="qm-model"><strong>Model answer:</strong> {question.modelAnswer}</div>}
                {(question.acceptedAnswers || []).length > 0 && <div className="qm-model"><strong>Accepted:</strong> {question.acceptedAnswers.join(' • ')}</div>}
                {answeredAttempts.length === 0 && <p className="qm-muted">No answers to mark.</p>}
                {answeredAttempts.length > 0 && (
                  <div className="qm-row">
                    <button type="button" className="nav-btn secondary qm-small" onClick={() => answeredAttempts.forEach(a => setScore(a.id, question.id, question.points))}>
                      Full marks to all answered
                    </button>
                    <button type="button" className="nav-btn secondary qm-small" onClick={() => answeredAttempts.forEach(a => setScore(a.id, question.id, ''))}>
                      Clear scores
                    </button>
                  </div>
                )}
                {answeredAttempts.map(a => {
                  const r = marked.get(a.id)?.results.find(x => x.questionId === question.id);
                  const manual = manualScores[a.id]?.[question.id];
                  return (
                    <div key={a.id} className={`qm-answer ${r?.needsMarking ? 'pending' : ''}`}>
                      <div className="qm-answer-text">
                        <div className="qm-muted">{a.studentName || a.studentEmail}</div>
                        <div>{answerText(question, a.answers?.[question.id])}</div>
                      </div>
                      <label className="qm-score">
                        <input
                          type="number"
                          min="0"
                          max={question.points}
                          step="0.5"
                          className="form-input"
                          value={manual ?? (r && !r.needsMarking ? r.earned : '')}
                          placeholder="—"
                          onChange={e => setScore(a.id, question.id, e.target.value === '' ? '' : Math.min(question.points, Math.max(0, Number(e.target.value) || 0)))}
                          aria-label={`Score for ${a.studentName || a.studentEmail}, question ${index + 1}`}
                        />
                        / {question.points}
                      </label>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </section>
      )}

      <section className="qm-section">
        <h4>👩‍🎓 Students</h4>
        {quizAttempts.length === 0 && <p className="qm-muted">No one has submitted this quiz yet.</p>}
        {quizAttempts.length > 0 && (
          <div className="qm-table-wrap">
            <table className="qm-table">
              <thead>
                <tr><th>Student</th><th>Score</th><th>Status</th><th>Feedback (optional)</th></tr>
              </thead>
              <tbody>
                {quizAttempts.map(a => {
                  const m = marked.get(a.id);
                  const isReleased = a.status === 'graded';
                  return (
                    <tr key={a.id}>
                      <td>{a.studentName || a.studentEmail}<div className="qm-muted">{a.studentEmail}</div></td>
                      <td>{m.score}/{m.maxScore} ({m.percent}%)</td>
                      <td>
                        <span className={`qm-status ${isReleased ? 'released' : m.pending ? 'pending' : 'ready'}`}>
                          {isReleased ? 'Released' : m.pending ? `${m.pending} to mark` : 'Ready'}
                        </span>
                      </td>
                      <td>
                        {isReleased ? (a.feedback || <span className="qm-muted">—</span>) : (
                          <input
                            type="text"
                            className="form-input"
                            maxLength={MAX_QUIZ_FEEDBACK_CHARS}
                            value={feedback[a.id] || ''}
                            onChange={e => setFeedback(prev => ({ ...prev, [a.id]: e.target.value }))}
                            placeholder="Note to the student"
                            aria-label={`Feedback for ${a.studentName || a.studentEmail}`}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <style>{`
        .qm-root { display: flex; flex-direction: column; gap: 10px; }
        .qm-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .qm-label { font-weight: 700; font-size: 0.85rem; }
        .qm-select { flex: 1; min-width: 220px; }
        .qm-muted { color: #94a3b8; font-size: 0.8rem; font-weight: 400; }
        .qm-small { padding: 5px 10px !important; font-size: 0.78rem !important; }
        .qm-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 8px; }
        .qm-stat { display: flex; flex-direction: column; align-items: center; padding: 8px; border-radius: 10px; background: rgba(255,255,255,0.06); font-size: 0.78rem; color: #94a3b8; }
        .qm-stat strong { font-size: 1.3rem; color: #f1f5f9; }
        .qm-notice { padding: 8px 12px; border-radius: 10px; font-size: 0.85rem; }
        .qm-notice.success { background: rgba(34,197,94,0.18); color: #bbf7d0; }
        .qm-notice.error { background: rgba(239,68,68,0.18); color: #fecaca; }
        .qm-details summary { cursor: pointer; font-size: 0.85rem; color: #fcd34d; }
        .qm-section h4 { margin: 8px 0 4px; }
        .qm-question { border: 1px solid rgba(167,139,250,0.35); border-radius: 10px; padding: 10px; margin-bottom: 10px; background: rgba(76,29,149,0.12); display: flex; flex-direction: column; gap: 6px; }
        .qm-question-head { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
        .qm-model { font-size: 0.82rem; background: rgba(255,255,255,0.05); padding: 6px 8px; border-radius: 8px; white-space: pre-wrap; }
        .qm-answer { display: flex; justify-content: space-between; gap: 10px; align-items: center; padding: 6px 8px; border-radius: 8px; background: rgba(0,0,0,0.2); }
        .qm-answer.pending { border-left: 3px solid #f59e0b; }
        .qm-answer-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.88rem; flex: 1; }
        .qm-score { display: flex; align-items: center; gap: 4px; font-size: 0.82rem; white-space: nowrap; }
        .qm-score input { width: 70px; padding: 4px 6px; }
        .qm-table-wrap { overflow-x: auto; }
        .qm-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
        .qm-table th, .qm-table td { border-bottom: 1px solid rgba(255,255,255,0.1); padding: 6px 8px; text-align: left; vertical-align: top; }
        .qm-status { font-size: 0.72rem; font-weight: 800; padding: 2px 8px; border-radius: 6px; }
        .qm-status.released { background: rgba(34,197,94,0.25); color: #bbf7d0; }
        .qm-status.ready { background: rgba(59,130,246,0.25); color: #bfdbfe; }
        .qm-status.pending { background: rgba(245,158,11,0.25); color: #fde68a; }
      `}</style>
    </div>
  );
}
