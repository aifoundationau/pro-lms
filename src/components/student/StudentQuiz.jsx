import React, { useState } from 'react';
import { submitQuizAttempt } from '../../services/quizService';
import { countAnswered, normalizeQuiz, questionTypeLabel } from '../../services/quizModel';
import { QUIZ_LIMITS } from '../../types/courseBuilderTypes';

function answerText(question, value) {
  if (value === undefined) return 'No answer';
  if (question.type === 'multiple_choice') {
    const chosen = new Set(Array.isArray(value) ? value : []);
    return (question.options || []).filter(o => chosen.has(o.id)).map(o => o.text || 'Option').join(', ') || 'No answer';
  }
  if (question.type === 'true_false') return value ? 'True' : 'False';
  return String(value);
}

/** Student view of a "Quiz & Questions" block: answer, submit (resubmit until released), see results. */
export default function StudentQuiz({ course, unit, lesson, block, currentUser, attempt, onSaved }) {
  const quiz = normalizeQuiz(block.quiz);
  const [answers, setAnswers] = useState(() => (attempt?.answers && typeof attempt.answers === 'object' ? attempt.answers : {}));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const released = attempt?.status === 'graded';
  const answered = countAnswered(quiz, answers);
  const setAnswer = (questionId, value) => setAnswers(prev => ({ ...prev, [questionId]: value }));

  if (!quiz.questions.length) {
    return <p className="sl-muted">This quiz has no questions yet.</p>;
  }

  if (released) {
    const results = new Map((attempt.results || []).map(r => [r.questionId, r]));
    return (
      <div className="sq-quiz sq-released" aria-label={`${block.title || 'Quiz'} results`}>
        <div className="sl-status graded">
          <strong>🏅 Score: {attempt.score}/{attempt.maxScore} ({attempt.percent}%)</strong>
          {attempt.feedback && <div className="sl-text" style={{ marginTop: 4 }}>{attempt.feedback}</div>}
          <div className="sl-muted">Marked by {attempt.gradedByName || 'your teacher'}</div>
        </div>
        <ol className="sq-list">
          {quiz.questions.map(q => {
            const r = results.get(q.id);
            return (
              <li key={q.id} className={`sq-question ${r?.correct ? 'right' : r ? 'wrong' : ''}`}>
                <div className="sq-prompt">{q.prompt || 'Question'}</div>
                <div className="sl-muted">Your answer: {answerText(q, attempt.answers?.[q.id])}</div>
                {r && <div className="sq-mark">{r.correct ? '✓' : '✗'} {r.earned}/{r.points}</div>}
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const saved = await submitQuizAttempt({ course, unit, lesson, block, user: currentUser, answers });
      setNotice({ type: 'success', message: '✅ Quiz submitted. Your results appear here when your teacher releases them.' });
      onSaved?.(saved);
    } catch (err) {
      setNotice({ type: 'error', message: err.message || 'Your quiz could not be submitted.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="sq-quiz" onSubmit={handleSubmit} aria-label={block.title || 'Quiz'}>
      {quiz.instructions && <div className="sl-text sq-instructions">{quiz.instructions}</div>}
      {attempt && (
        <div className="sl-status">
          📥 Submitted{attempt.submittedAtMs ? ` ${new Date(attempt.submittedAtMs).toLocaleString()}` : ''} — you can change your answers and resubmit until your teacher releases results.
        </div>
      )}
      <ol className="sq-list">
        {quiz.questions.map((q, index) => {
          const fieldId = `quiz-${block.id}-${q.id}`;
          const value = answers[q.id];
          return (
            <li key={q.id} className="sq-question">
              <div className="sq-prompt" id={`${fieldId}-label`}>
                {q.prompt || `Question ${index + 1}`}
                <span className="sl-muted"> ({q.points} pt{q.points === 1 ? '' : 's'} • {questionTypeLabel(q.type)})</span>
              </div>
              {q.type === 'multiple_choice' && (
                <div role={q.allowMultiple ? 'group' : 'radiogroup'} aria-labelledby={`${fieldId}-label`} className="sq-options">
                  {q.allowMultiple && <div className="sl-muted">Select all that apply.</div>}
                  {(q.options || []).map(option => {
                    const chosen = Array.isArray(value) ? value : [];
                    return (
                      <label key={option.id} className="sq-option">
                        <input
                          type={q.allowMultiple ? 'checkbox' : 'radio'}
                          name={fieldId}
                          checked={chosen.includes(option.id)}
                          onChange={() => setAnswer(q.id, q.allowMultiple
                            ? (chosen.includes(option.id) ? chosen.filter(id => id !== option.id) : [...chosen, option.id])
                            : [option.id])}
                        />
                        <span>{option.text || 'Option'}</span>
                      </label>
                    );
                  })}
                </div>
              )}
              {q.type === 'true_false' && (
                <div role="radiogroup" aria-labelledby={`${fieldId}-label`} className="sq-options sq-inline">
                  {[true, false].map(option => (
                    <label key={String(option)} className="sq-option">
                      <input type="radio" name={fieldId} checked={value === option} onChange={() => setAnswer(q.id, option)} />
                      <span>{option ? 'True' : 'False'}</span>
                    </label>
                  ))}
                </div>
              )}
              {q.type === 'short_answer' && (
                <input
                  type="text"
                  className="form-input"
                  maxLength={500}
                  value={typeof value === 'string' ? value : ''}
                  onChange={e => setAnswer(q.id, e.target.value)}
                  aria-labelledby={`${fieldId}-label`}
                  placeholder="Your answer"
                />
              )}
              {q.type === 'open' && (
                <textarea
                  className="form-input"
                  rows={4}
                  maxLength={QUIZ_LIMITS.answer}
                  value={typeof value === 'string' ? value : ''}
                  onChange={e => setAnswer(q.id, e.target.value)}
                  aria-labelledby={`${fieldId}-label`}
                  placeholder="Write your answer"
                />
              )}
            </li>
          );
        })}
      </ol>
      {notice && <div className={`sl-notice ${notice.type}`} role="status">{notice.message}</div>}
      <div className="sl-row">
        <span className="sl-muted">{answered}/{quiz.questions.length} answered{answered < quiz.questions.length ? ' — unanswered questions score 0' : ''}</span>
        <button type="submit" className="nav-btn primary" disabled={busy || answered === 0}>
          {busy ? 'Submitting…' : attempt ? 'Resubmit quiz' : 'Submit quiz'}
        </button>
      </div>
      <style>{`
        .sq-quiz { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
        .sq-instructions { font-size: 0.9rem; color: #cbd5e1; }
        .sq-list { margin: 0; padding-left: 22px; display: flex; flex-direction: column; gap: 10px; }
        .sq-question { padding: 8px 10px; border-radius: 10px; background: rgba(76,29,149,0.14); border: 1px solid rgba(167,139,250,0.3); }
        .sq-question.right { border-color: rgba(74,222,128,0.5); }
        .sq-question.wrong { border-color: rgba(248,113,113,0.5); }
        .sq-prompt { font-weight: 600; margin-bottom: 6px; white-space: pre-wrap; }
        .sq-options { display: flex; flex-direction: column; gap: 4px; }
        .sq-inline { flex-direction: row; gap: 16px; }
        .sq-option { display: flex; align-items: center; gap: 8px; cursor: pointer; }
        .sq-mark { font-weight: 800; margin-top: 4px; }
      `}</style>
    </form>
  );
}
