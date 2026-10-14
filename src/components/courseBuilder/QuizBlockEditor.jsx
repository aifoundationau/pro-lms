import React from 'react';
import { QUIZ_QUESTION_TYPES, QUIZ_KEY_FIELDS, QUIZ_LIMITS, createQuizQuestion, generateEntityId } from '../../types/courseBuilderTypes';
import { CLOSED_QUESTION_TYPES } from '../../services/quizModel';

/** True when the question carries its answer key (it may not, if the keys could not be loaded). */
function hasKey(question) {
  return QUIZ_KEY_FIELDS.some(field => question?.[field] !== undefined);
}

function linesToList(value) {
  return String(value || '').split('\n').map(s => s.trim()).filter(Boolean);
}

/** Teacher editor for a "Quiz & Questions" block: questions, correct answers and points. */
export default function QuizBlockEditor({ quiz, onChange, keysStatus = 'ok' }) {
  const questions = Array.isArray(quiz?.questions) ? quiz.questions : [];
  const update = (patch) => onChange({ ...quiz, questions, ...patch });
  const updateQuestion = (id, patch) => update({ questions: questions.map(q => (q.id === id ? { ...q, ...patch } : q)) });
  const removeQuestion = (id) => update({ questions: questions.filter(q => q.id !== id) });
  const moveQuestion = (index, delta) => {
    const next = questions.slice();
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    update({ questions: next });
  };
  const addQuestion = (type) => {
    if (questions.length >= QUIZ_LIMITS.questions) return;
    update({ questions: [...questions, createQuizQuestion(type)] });
  };
  const changeType = (q, type) => {
    const fresh = createQuizQuestion(type);
    updateQuestion(q.id, { ...fresh, id: q.id, prompt: q.prompt, points: type === 'open' && q.type !== 'open' ? fresh.points : q.points });
  };

  const totalPoints = questions.reduce((sum, q) => sum + (Number(q.points) || 0), 0);
  const autoMarked = questions.filter(q => CLOSED_QUESTION_TYPES.has(q.type) && (
    (q.type === 'multiple_choice' && (q.correctOptionIds || []).length) ||
    (q.type === 'true_false' && typeof q.correctAnswer === 'boolean') ||
    (q.type === 'short_answer' && (q.acceptedAnswers || []).length)
  )).length;

  return (
    <div className="qb-editor">
      {keysStatus === 'error' && questions.some(q => !hasKey(q)) && (
        <div className="qb-warning" role="alert">
          ⚠️ The correct answers could not be loaded (offline?). They are kept safely — saving now will not change them. Reopen the course to edit them.
        </div>
      )}
      <div className="qb-summary">
        <span>❓ {questions.length} question{questions.length === 1 ? '' : 's'} • {totalPoints} point{totalPoints === 1 ? '' : 's'} • {autoMarked} marked automatically</span>
        <span className="qb-lock" title="Correct answers and model answers are stored separately and never sent to students.">🔒 Answers hidden from students</span>
      </div>
      <textarea
        rows="2"
        className="form-input"
        value={quiz?.instructions || ''}
        onChange={e => update({ instructions: e.target.value })}
        placeholder="Instructions for students (optional), e.g. Answer all questions. You can resubmit until your teacher releases results."
        aria-label="Quiz instructions"
      />

      {questions.map((q, index) => {
        const isMulti = q.type === 'multiple_choice';
        const options = Array.isArray(q.options) ? q.options : [];
        const correct = new Set(q.correctOptionIds || []);
        const missingAnswer = isMulti && options.length > 0 && correct.size === 0 && (hasKey(q) || keysStatus === 'ok');
        return (
          <div key={q.id} className="qb-question" data-question-type={q.type}>
            <div className="qb-question-head">
              <strong>Q{index + 1}</strong>
              <select className="form-input qb-type" value={q.type} onChange={e => changeType(q, e.target.value)} aria-label={`Question ${index + 1} type`}>
                {QUIZ_QUESTION_TYPES.map(t => <option key={t.type} value={t.type}>{t.label}{t.closed ? '' : ' (teacher-marked)'}</option>)}
              </select>
              <label className="qb-points">
                <input
                  type="number"
                  min="0"
                  max={QUIZ_LIMITS.points}
                  step="0.5"
                  className="form-input"
                  value={q.points ?? 1}
                  onChange={e => updateQuestion(q.id, { points: Math.min(QUIZ_LIMITS.points, Math.max(0, Number(e.target.value) || 0)) })}
                  aria-label={`Question ${index + 1} points`}
                />
                pts
              </label>
              <div className="qb-actions">
                <button type="button" className="qb-icon" onClick={() => moveQuestion(index, -1)} disabled={index === 0} title="Move up" aria-label={`Move question ${index + 1} up`}>↑</button>
                <button type="button" className="qb-icon" onClick={() => moveQuestion(index, 1)} disabled={index === questions.length - 1} title="Move down" aria-label={`Move question ${index + 1} down`}>↓</button>
                <button type="button" className="qb-icon" onClick={() => removeQuestion(q.id)} title="Remove question" aria-label={`Remove question ${index + 1}`}>×</button>
              </div>
            </div>
            <textarea
              rows="2"
              className="form-input"
              maxLength={QUIZ_LIMITS.prompt}
              value={q.prompt || ''}
              onChange={e => updateQuestion(q.id, { prompt: e.target.value })}
              placeholder="Question"
              aria-label={`Question ${index + 1}`}
            />

            {isMulti && (
              <div className="qb-options">
                {options.map((option, oIdx) => (
                  <div key={option.id} className="qb-option">
                    <input
                      type={q.allowMultiple ? 'checkbox' : 'radio'}
                      name={`correct-${q.id}`}
                      checked={correct.has(option.id)}
                      onChange={() => {
                        const next = q.allowMultiple
                          ? (correct.has(option.id) ? [...correct].filter(id => id !== option.id) : [...correct, option.id])
                          : [option.id];
                        updateQuestion(q.id, { correctOptionIds: next });
                      }}
                      aria-label={`Option ${String.fromCharCode(65 + oIdx)} is correct`}
                      title="Correct answer"
                    />
                    <span className="qb-letter">{String.fromCharCode(65 + oIdx)}</span>
                    <input
                      type="text"
                      className="form-input"
                      maxLength={QUIZ_LIMITS.option}
                      value={option.text || ''}
                      onChange={e => updateQuestion(q.id, { options: options.map(o => (o.id === option.id ? { ...o, text: e.target.value } : o)) })}
                      placeholder={`Option ${String.fromCharCode(65 + oIdx)}`}
                      aria-label={`Question ${index + 1} option ${String.fromCharCode(65 + oIdx)}`}
                    />
                    <button
                      type="button"
                      className="qb-icon"
                      onClick={() => updateQuestion(q.id, {
                        options: options.filter(o => o.id !== option.id),
                        correctOptionIds: [...correct].filter(id => id !== option.id)
                      })}
                      disabled={options.length <= 2}
                      aria-label={`Remove option ${String.fromCharCode(65 + oIdx)}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <div className="qb-row">
                  <button
                    type="button"
                    className="nav-btn secondary qb-small"
                    onClick={() => updateQuestion(q.id, { options: [...options, { id: generateEntityId('opt'), text: '' }] })}
                    disabled={options.length >= QUIZ_LIMITS.options}
                  >
                    + Option
                  </button>
                  <label className="qb-check">
                    <input
                      type="checkbox"
                      checked={Boolean(q.allowMultiple)}
                      onChange={e => updateQuestion(q.id, {
                        allowMultiple: e.target.checked,
                        correctOptionIds: e.target.checked ? [...correct] : [...correct].slice(0, 1)
                      })}
                    />
                    More than one correct answer
                  </label>
                </div>
                {missingAnswer && <div className="qb-hint">⚠️ Tick the correct answer so this question is marked automatically.</div>}
              </div>
            )}

            {q.type === 'true_false' && (
              <div className="qb-row qb-tf" role="radiogroup" aria-label={`Question ${index + 1} correct answer`}>
                <span className="qb-muted">Correct answer:</span>
                {[true, false].map(value => (
                  <label key={String(value)} className="qb-check">
                    <input
                      type="radio"
                      name={`tf-${q.id}`}
                      checked={q.correctAnswer === value}
                      onChange={() => updateQuestion(q.id, { correctAnswer: value })}
                    />
                    {value ? 'True' : 'False'}
                  </label>
                ))}
              </div>
            )}

            {q.type === 'short_answer' && (
              <>
                <textarea
                  rows="2"
                  className="form-input"
                  value={(q.acceptedAnswers || []).join('\n')}
                  onChange={e => updateQuestion(q.id, { acceptedAnswers: linesToList(e.target.value).slice(0, 20) })}
                  placeholder="Accepted answers, one per line (not case-sensitive)"
                  aria-label={`Question ${index + 1} accepted answers`}
                />
                <div className="qb-muted">{(q.acceptedAnswers || []).length ? 'Marked automatically; you can override any mark when marking.' : 'No accepted answers yet: this question will be marked by you.'}</div>
              </>
            )}

            {q.type === 'open' && (
              <textarea
                rows="2"
                className="form-input"
                maxLength={QUIZ_LIMITS.answer}
                value={q.modelAnswer || ''}
                onChange={e => updateQuestion(q.id, { modelAnswer: e.target.value })}
                placeholder="Model answer / marking guide (teachers only)"
                aria-label={`Question ${index + 1} model answer`}
              />
            )}
          </div>
        );
      })}

      <div className="qb-add-row">
        <span className="qb-muted">Add question:</span>
        {QUIZ_QUESTION_TYPES.map(t => (
          <button key={t.type} type="button" className="nav-btn secondary qb-small" onClick={() => addQuestion(t.type)} disabled={questions.length >= QUIZ_LIMITS.questions}>
            + {t.label}
          </button>
        ))}
      </div>

      <style>{`
        .qb-editor { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
        .qb-summary { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 0.8rem; color: #c4b5fd; font-weight: 600; }
        .qb-lock { color: #94a3b8; font-weight: 500; }
        .qb-warning { padding: 8px 10px; border-radius: 8px; background: rgba(239,68,68,0.15); color: #fecaca; font-size: 0.82rem; }
        .qb-question { border: 1px solid rgba(167,139,250,0.35); border-radius: 10px; padding: 10px; background: rgba(76,29,149,0.12); display: flex; flex-direction: column; gap: 6px; }
        .qb-question-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .qb-type { width: auto; min-width: 170px; padding: 4px 8px; }
        .qb-points { display: flex; align-items: center; gap: 4px; font-size: 0.78rem; color: #94a3b8; }
        .qb-points input { width: 70px; padding: 4px 6px; }
        .qb-actions { margin-left: auto; display: flex; gap: 4px; }
        .qb-icon { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #e2e8f0; border-radius: 6px; width: 28px; height: 28px; cursor: pointer; }
        .qb-icon:disabled { opacity: 0.35; cursor: not-allowed; }
        .qb-options { display: flex; flex-direction: column; gap: 4px; }
        .qb-option { display: flex; align-items: center; gap: 6px; }
        .qb-option .form-input { padding: 5px 8px; }
        .qb-letter { font-weight: 800; color: #c4b5fd; width: 16px; text-align: center; }
        .qb-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .qb-check { display: inline-flex; align-items: center; gap: 4px; font-size: 0.82rem; color: #e2e8f0; cursor: pointer; }
        .qb-muted { font-size: 0.78rem; color: #94a3b8; }
        .qb-hint { font-size: 0.78rem; color: #fcd34d; }
        .qb-small { padding: 4px 10px !important; font-size: 0.78rem !important; }
        .qb-add-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      `}</style>
    </div>
  );
}
