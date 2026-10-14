import React, { useEffect, useRef, useState } from 'react';
import {
  listMySubmissions,
  submitAssessment,
  saveDraftAssessment,
  getLocalDraft,
  saveLocalDraft,
  MAX_SUBMISSION_CHARS
} from '../../services/submissionService';
import { isHttpUrl } from '../../services/courseSpreadsheetSchema';
import { formatLocalizedDate } from '../../services/geminiCourseService';
import { LINK_BLOCK_METADATA_KEYS, moveUnitAssessmentsToCourse, getAqfLevelMeta } from '../../types/courseBuilderTypes';
import { listMyQuizAttempts } from '../../services/quizService';
import StudentQuiz from './StudentQuiz.jsx';
import { youtubeVideoId, isGoogleDocsUrl } from '../../services/mediaLinks';
import { summarizeStudentProgress } from '../../services/studentDashboard';

function blockLink(block) {
  const key = LINK_BLOCK_METADATA_KEYS[block.type];
  const url = (key && block.metadata?.[key]) || block.content || '';
  return isHttpUrl(url) ? url : '';
}

function ExternalLink({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="sl-link">
      {children} ↗
    </a>
  );
}

/** Student-facing rendering of one content block (Teacher Guides are never shown). */
function StudentBlock({ block, renderQuiz }) {
  if (block.type === 'teacher_guide') return null;
  if (block.type === 'quiz') {
    return (
      <div className="sl-block sl-quiz-block">
        <h5>❓ {block.title || 'Quiz'}</h5>
        {renderQuiz ? renderQuiz(block) : <p className="sl-muted">Open the course to take this quiz.</p>}
      </div>
    );
  }
  const link = blockLink(block);
  return (
    <div className="sl-block">
      {block.title && <h5>{block.title}</h5>}
      {block.type === 'text_description' && <div className="sl-text">{block.content}</div>}
      {block.type === 'youtube_video' && (youtubeVideoId(link) ? (
        <div className="sl-video">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${youtubeVideoId(link)}`}
            title={block.title || 'Lesson video'}
            loading="lazy"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      ) : link ? <ExternalLink href={link}>▶️ Watch video</ExternalLink> : <p className="sl-muted">Video link coming soon.</p>)}
      {block.type === 'google_drive_link' && (link
        ? <ExternalLink href={link}>{isGoogleDocsUrl(link) ? '📁 Open in Google Drive' : '🔗 Open resource'}</ExternalLink>
        : <p className="sl-muted">Resource link coming soon.</p>)}
      {block.type === 'notebook_link' && (link ? <ExternalLink href={link}>📓 Open Gemini Notebook</ExternalLink> : <p className="sl-muted">Gemini Notebook link coming soon.</p>)}
      {block.type === 'file_upload' && (link ? <ExternalLink href={link}>📎 Download {block.metadata?.fileName || 'file'}</ExternalLink> : <p className="sl-muted">File coming soon.</p>)}
    </div>
  );
}

/** Renders Rubric criteria matrix or text description. */
function RubricView({ rubric, rubricUrl }) {
  if (typeof rubric === 'string' && rubric.trim()) {
    return (
      <details className="sl-rubric" open>
        <summary>📊 How this is marked</summary>
        <div className="sl-text sl-rubric-text" style={{ marginTop: 6 }}>{rubric}</div>
        {isHttpUrl(rubricUrl) && (
          <div style={{ marginTop: 8 }}>
            <ExternalLink href={rubricUrl}>📎 View complete rubric document</ExternalLink>
          </div>
        )}
      </details>
    );
  }
  const rows = Array.isArray(rubric) ? rubric : [];
  if (!rows.length && !isHttpUrl(rubricUrl)) return null;
  const labels = rows.reduce((best, c) => ((c.levels || []).length > best.length ? (c.levels || []).map(l => l.label) : best), []);
  return (
    <details className="sl-rubric" open>
      <summary>📊 How this is marked ({rows.length} criteria)</summary>
      {rows.length > 0 && (
        <div className="sl-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Criterion & Weight</th>
                {labels.map((label, i) => <th key={i}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => (
                <tr key={c.id || i}>
                  <td><strong>{c.criterionTitle}</strong><div className="sl-muted">{Number(c.weightPercentage) || 0}%</div></td>
                  {labels.map((_, li) => <td key={li}>{c.levels?.[li]?.descriptor || ''}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {isHttpUrl(rubricUrl) && (
        <div style={{ marginTop: 8 }}>
          <ExternalLink href={rubricUrl}>📎 View complete rubric document</ExternalLink>
        </div>
      )}
    </details>
  );
}

/** Renders Assessment Questions and Practical Exercises */
function QuestionsView({ assessment }) {
  const questions = assessment.questions || assessment.typeText || assessment.details || '';
  const multipleChoice = assessment.multipleChoice || '';
  const shortAnswer = assessment.shortAnswer || '';
  const exercises = assessment.exercises || assessment.assessmentExercises || assessment.tasks || '';

  const hasQuestions = Boolean(questions || multipleChoice || shortAnswer);
  const hasExercises = Boolean(exercises);

  if (!hasQuestions && !hasExercises) return null;

  return (
    <div className="sl-questions-wrapper">
      {hasQuestions && (
        <div className="sl-asmt-box sl-q-box">
          <h5 style={{ margin: '0 0 6px', color: '#93c5fd' }}>❓ Assessment Questions & Prompts</h5>
          {questions && <div className="sl-text" style={{ marginBottom: 8 }}>{questions}</div>}
          {multipleChoice && (
            <div className="sl-sub-box">
              <strong style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>Multiple Choice:</strong>
              <div className="sl-text" style={{ marginTop: 4 }}>{multipleChoice}</div>
            </div>
          )}
          {shortAnswer && (
            <div className="sl-sub-box">
              <strong style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>Short Answer Questions:</strong>
              <div className="sl-text" style={{ marginTop: 4 }}>{shortAnswer}</div>
            </div>
          )}
        </div>
      )}

      {hasExercises && (
        <div className="sl-asmt-box sl-ex-box">
          <h5 style={{ margin: '0 0 6px', color: '#a7f3d0' }}>🏋️ Assessment Exercises & Practical Tasks</h5>
          <div className="sl-text">{exercises}</div>
        </div>
      )}
    </div>
  );
}

function SubmissionBox({ course, unit, assessment, currentUser, submission, onSubmitted, isDraftCourse = false }) {
  const localDraft = currentUser?.uid ? getLocalDraft(course.id, assessment.id, currentUser.uid) : null;
  const initialText = submission?.text ?? localDraft?.text ?? '';
  const initialLink = submission?.linkUrl ?? localDraft?.linkUrl ?? '';

  const [text, setText] = useState(initialText);
  const [link, setLink] = useState(initialLink);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const graded = submission?.status === 'graded';
  const isDraft = submission?.status === 'draft';

  useEffect(() => {
    if (submission) {
      if (submission.text !== undefined) setText(submission.text);
      if (submission.linkUrl !== undefined) setLink(submission.linkUrl);
    }
  }, [submission]);

  const handleSaveDraft = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const saved = await saveDraftAssessment({ course, unit, assessment, user: currentUser, text, linkUrl: link });
      setNotice({ type: 'success', message: '💾 Draft saved! Your teacher will not see this until you officially submit.' });
      onSubmitted(saved);
    } catch (err) {
      setNotice({ type: 'error', message: err.message || 'Draft could not be saved.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isDraftCourse) {
      setNotice({ type: 'error', message: 'Assessments cannot be submitted while the course is in draft mode.' });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const saved = await submitAssessment({ course, unit, assessment, user: currentUser, text, linkUrl: link });
      setNotice({ type: 'success', message: '✅ Submitted. Your teacher can now see your work.' });
      onSubmitted(saved);
    } catch (err) {
      setNotice({ type: 'error', message: err.message || 'Submission failed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sl-submit">
      {isDraftCourse && (
        <div className="sl-draft-submission-notice" style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(234, 179, 8, 0.15)', border: '1px solid rgba(234, 179, 8, 0.4)', color: '#fef08a', marginBottom: '10px', fontSize: '0.85rem' }}>
          🔒 <strong>Assessments Locked in Draft Mode:</strong> You can view tasks and prepare notes, but assessment submissions are disabled while the course is in draft. Once your teacher publishes the course, you will be able to submit your work.
        </div>
      )}
      {submission && (
        <div className={`sl-status ${graded ? 'graded' : isDraft ? 'draft' : 'submitted'}`}>
          {graded ? (
            <>
              <strong>🏅 Grade: {submission.grade}</strong>
              {submission.feedback && <div className="sl-text" style={{ marginTop: 4 }}>{submission.feedback}</div>}
              <div className="sl-muted">Graded by {submission.gradedByName || 'your teacher'}</div>
            </>
          ) : isDraft ? (
            <span>
              ✏️ <strong>Draft saved</strong>
              {submission.draftSavedAtMs ? ` on ${new Date(submission.draftSavedAtMs).toLocaleString()}` : ''}
              {' '}— not submitted to teacher yet. You can keep editing anytime.
            </span>
          ) : (
            <span>📥 Submitted{submission.submittedAtMs ? ` ${new Date(submission.submittedAtMs).toLocaleString()}` : ''}{submission.attempts > 1 ? ` • attempt ${submission.attempts}` : ''} — awaiting marking</span>
          )}
        </div>
      )}
      {!graded && (
        <form onSubmit={handleSubmit}>
          <label className="sl-label" htmlFor={`ans-${assessment.id}`}>Your answer or submission notes</label>
          <textarea
            id={`ans-${assessment.id}`}
            className="form-input"
            rows={5}
            maxLength={MAX_SUBMISSION_CHARS}
            value={text}
            onChange={e => {
              setText(e.target.value);
              saveLocalDraft(course.id, assessment.id, currentUser?.uid, { text: e.target.value, linkUrl: link });
            }}
            placeholder="Type your answer, response to questions, or submission notes here…"
          />
          <label className="sl-label" htmlFor={`link-${assessment.id}`}>Link to your work (optional)</label>
          <input
            id={`link-${assessment.id}`}
            type="url"
            className="form-input"
            value={link}
            onChange={e => {
              setLink(e.target.value);
              saveLocalDraft(course.id, assessment.id, currentUser?.uid, { text, linkUrl: e.target.value });
            }}
            placeholder="https://docs.google.com/… (share as “Anyone with the link can view”)"
          />
          {notice && <div className={`sl-notice ${notice.type}`} role="status">{notice.message}</div>}
          <div className="sl-row" style={{ marginTop: 8 }}>
            <span className="sl-muted">{text.length.toLocaleString()}/{MAX_SUBMISSION_CHARS.toLocaleString()}</span>
            <div className="sl-btn-cluster">
              <button
                type="button"
                className="nav-btn secondary sl-draft-btn"
                onClick={handleSaveDraft}
                disabled={busy || (!text.trim() && !link.trim())}
              >
                {busy ? 'Saving…' : '💾 Save Draft'}
              </button>
              <button
                type="submit"
                className="nav-btn primary"
                disabled={busy || isDraftCourse || (!text.trim() && !link.trim())}
                title={isDraftCourse ? 'Assessments cannot be submitted while the course is in draft' : undefined}
              >
                {busy ? 'Submitting…' : isDraftCourse ? 'Locked in Draft' : submission?.status === 'submitted' ? 'Resubmit' : 'Submit'}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

/** Unit Card with interactive Dropdown on the right displaying all description, content, and links. */
function StudentUnitCard({ unit, defaultOpen = false, renderQuiz }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const lessons = Array.isArray(unit.lessons) ? unit.lessons : [];
  const quizCount = lessons.reduce((n, lesson) => n + (lesson.blocks || []).filter(b => b?.type === 'quiz').length, 0);

  // Extract all external and learning links within this unit
  const unitLinks = [];
  lessons.forEach(lesson => {
    (lesson.blocks || []).forEach(block => {
      if (block.type === 'teacher_guide') return;
      const url = blockLink(block);
      if (url) {
        unitLinks.push({
          title: block.title || lesson.title,
          url,
          type: block.type
        });
      }
    });
  });

  return (
    <details
      className="glass sl-card sl-unit-dropdown"
      open={isOpen}
      onToggle={e => setIsOpen(e.currentTarget.open)}
    >
      <summary className="sl-unit-summary">
        <div className="sl-unit-summary-left">
          <span className="sl-code">{unit.unitCode}</span>
          <strong className="sl-unit-title">{unit.unitTitle}</strong>
          <span className="sl-muted">
            • {unit.nominalHours || 0} hrs • {lessons.length} lessons
            {quizCount > 0 ? ` • ${quizCount} quiz${quizCount === 1 ? '' : 'zes'}` : ''}
            {unitLinks.length > 0 ? ` • ${unitLinks.length} links` : ''}
          </span>
        </div>
        <div className="sl-unit-summary-right">
          <span className={`sl-unit-dropdown-btn ${isOpen ? 'open' : ''}`}>
            {isOpen ? 'Close Content ▴' : 'View Description, Content & Links ▾'}
          </span>
        </div>
      </summary>

      <div className="sl-unit-dropdown-box">
        {/* Unit Description */}
        <div className="sl-unit-desc-card">
          <h5 style={{ margin: '0 0 6px', color: '#93c5fd' }}>📋 Performance Criteria</h5>
          <p className="sl-text" style={{ margin: 0 }}>
            {unit.description || 'Welcome to this unit of study. Review the lessons, learning activities, and links below.'}
          </p>
        </div>

        {/* Quick Links & Resources in this Unit */}
        {unitLinks.length > 0 && (
          <div className="sl-unit-links-box">
            <h5 style={{ margin: '0 0 8px', color: '#fef08a' }}>🔗 Resources & Links in this Unit ({unitLinks.length})</h5>
            <div className="sl-unit-links-grid">
              {unitLinks.map((item, idx) => (
                <a key={idx} href={item.url} target="_blank" rel="noopener noreferrer" className="sl-unit-link-chip">
                  <span className="sl-chip-icon">
                    {item.type === 'youtube_video' ? '▶️' : item.type === 'notebook_link' ? '📓' : item.type === 'google_drive_link' ? '📁' : '🔗'}
                  </span>
                  <span className="sl-chip-text">{item.title}</span>
                  <span className="sl-chip-arrow">↗</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Lessons & Content */}
        <h5 style={{ margin: '14px 0 8px', color: '#cbd5e1' }}>📘 Lessons & Course Content</h5>
        {lessons.length === 0 && (
          <p className="sl-muted">No lessons have been added to this unit yet.</p>
        )}
        {lessons.map((lesson, lIdx) => (
          <div key={lesson.id || lIdx} className="sl-lesson-box glass">
            <div className="sl-lesson-header">
              <span className="sl-lesson-name">📘 {lesson.title}</span>
              <span className="sl-muted">({lesson.estimatedMinutes || 45} min)</span>
            </div>
            <div className="sl-lesson-content">
              {(lesson.blocks || []).map((block, bIdx) => (
                <StudentBlock key={block.id || bIdx} block={block} renderQuiz={renderQuiz ? quizBlock => renderQuiz(unit, lesson, quizBlock) : null} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function CourseViewer({ course: rawCourse, currentUser, onBack, onMessageTeacher, enrolledCourses = [], onSelectCourse }) {
  // One Assessments & Rubrics list per course (older courses keep their tasks, moved up from units).
  const course = moveUnitAssessmentsToCourse(rawCourse);
  // Submissions and quiz attempts for this course; "loading" until they arrive for the open course.
  const [submissionState, setSubmissionState] = useState({ courseId: null, byAssessment: {} });
  const [quizState, setQuizState] = useState({ courseId: null, byQuiz: {} });
  const [isAssessmentsExpanded, setIsAssessmentsExpanded] = useState(true);
  const [isUnitsSectionExpanded, setIsUnitsSectionExpanded] = useState(true);
  const loading = submissionState.courseId !== course.id;
  const quizzesLoading = quizState.courseId !== course.id;
  const submissions = submissionState.byAssessment;
  const units = Array.isArray(course.units) ? course.units : [];
  const [activeUnitId, setActiveUnitId] = useState(units[0]?.id || null);
  const isDraftCourse = Boolean(course.isDraft || course.status === 'draft' || (Array.isArray(course.tags) && course.tags.includes('Draft')));

  const allAssessments = (Array.isArray(course.assessments) ? course.assessments : [])
    .filter(asmt => asmt && typeof asmt === 'object')
    .map(asmt => {
      const unit = units.find(u => u.id && u.id === asmt.unitId) || null;
      return { assessment: asmt, unitCode: unit?.unitCode || '', unitTitle: unit?.unitTitle || '', unit };
    });

  useEffect(() => {
    let cancelled = false;
    listMySubmissions(course.id, currentUser?.uid).then(byAssessment => {
      if (!cancelled) setSubmissionState({ courseId: course.id, byAssessment });
    });
    listMyQuizAttempts(course.id, currentUser?.uid).then(byQuiz => {
      if (!cancelled) setQuizState({ courseId: course.id, byQuiz });
    });
    return () => {
      cancelled = true;
    };
  }, [course.id, currentUser?.uid]);

  const renderQuiz = (unit, lesson, block) => (quizzesLoading ? (
    <p className="sl-muted">Loading your quiz…</p>
  ) : (
    <StudentQuiz
      key={block.id}
      course={course}
      unit={unit}
      lesson={lesson}
      block={block}
      currentUser={currentUser}
      attempt={quizState.byQuiz[block.id]}
      onSaved={saved => setQuizState(prev => ({ ...prev, byQuiz: { ...prev.byQuiz, [block.id]: { ...prev.byQuiz[block.id], ...saved } } }))}
    />
  ));

  return (
    <div className="sl-viewer aqf-builder-container">
      {/* Top Bar Navigation & Actions */}
      <header className="builder-top-header glass sl-top-nav-bar" style={{ marginBottom: '16px' }}>
        <div className="builder-header-left">
          <button type="button" className="nav-btn secondary" onClick={onBack}>
            ← Student Panel
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: '1.3rem', color: '#fef08a' }}>
                {course.title || 'Untitled Course'}
              </h2>
              {course.category && (
                <span className="aqf-badge-pill" style={{ background: '#0284c7' }}>
                  {course.category}
                </span>
              )}
              {course.code && (
                <span className="aqf-badge-pill" style={{ background: '#334155' }}>
                  {course.code}
                </span>
              )}
              {isDraftCourse ? (
                <span className="aqf-badge-pill" style={{ background: '#d97706', color: '#fff', border: '1px dashed #fef08a' }}>
                  📝 Draft Course (View-Only)
                </span>
              ) : (
                <span className="aqf-badge-pill" style={{ background: '#059669', color: '#fff' }}>
                  🌐 Enrolled
                </span>
              )}
            </div>
            <p style={{ margin: '2px 0 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Teacher: {course.authorName || 'Your teacher'}
              {course.startDate ? ` • Starts ${formatLocalizedDate(course.startDate)}` : ''}
              {course.nominalHours ? ` • ${course.nominalHours} nominal hrs` : ''}
            </p>
          </div>
        </div>

        <div className="builder-header-right" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {enrolledCourses.length > 1 && (
            <div className="sl-course-dropdown-wrap">
              <label htmlFor="sl-view-course-dropdown" className="sl-dropdown-mini-label">Course:</label>
              <select
                id="sl-view-course-dropdown"
                className="form-input sl-compact-select"
                value={course.id}
                onChange={e => onSelectCourse?.(e.target.value)}
                aria-label="Switch Enrolled Course"
              >
                {enrolledCourses.map(c => {
                  const draftFlag = Boolean(c.isDraft || c.status === 'draft' || (Array.isArray(c.tags) && c.tags.includes('Draft')));
                  return (
                    <option key={c.id} value={c.id}>
                      {c.title}{draftFlag ? ' (Draft)' : ''} {c.code ? `(${c.code})` : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          )}
          {course.authorEmail && (
            <button type="button" className="nav-btn secondary" onClick={() => onMessageTeacher?.(course)}>
              💬 Message teacher
            </button>
          )}
        </div>
      </header>

      {/* Main 2-Column Grid Emulating Teacher View */}
      <div className="builder-workspace-grid sl-viewer-grid">
        {/* Left Column: Course Specifications & Quick Navigator (View-Only) */}
        <aside className="builder-sidebar glass sl-student-sidebar">
          <div className="sidebar-section">
            <h4 className="sidebar-heading">Course Specifications</h4>
            
            <div style={{ marginBottom: '12px' }}>
              <label className="field-label">Course Title</label>
              <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#f1f5f9' }}>{course.title || 'Untitled Course'}</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
              <div>
                <label className="field-label">Course Code</label>
                <div style={{ fontWeight: 600, color: '#38bdf8', fontSize: '0.9rem' }}>{course.code || 'N/A'}</div>
              </div>
              <div>
                <label className="field-label">Category</label>
                <div style={{ color: '#cbd5e1', fontSize: '0.9rem' }}>{course.category || 'General'}</div>
              </div>
            </div>

            {course.aqfLevel !== undefined && (
              <div style={{ marginBottom: '12px' }}>
                <label className="field-label">Level Taxonomy</label>
                <span className="aqf-badge-pill" style={{ background: '#0284c7', display: 'inline-block' }}>
                  {getAqfLevelMeta(course.aqfLevel).shortTitle}
                </span>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
              <div>
                <label className="field-label">Delivery Mode</label>
                <div style={{ color: '#cbd5e1', fontSize: '0.85rem' }}>{course.deliveryMode || 'Online'}</div>
              </div>
              <div>
                <label className="field-label">Start Date</label>
                <div style={{ color: '#cbd5e1', fontSize: '0.85rem' }}>{course.startDate ? formatLocalizedDate(course.startDate) : 'Self-Paced'}</div>
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label className="field-label">Teacher</label>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ fontSize: '0.9rem', color: '#f1f5f9', fontWeight: 600 }}>{course.authorName || 'Teacher'}</span>
                {course.authorEmail && (
                  <button
                    type="button"
                    className="nav-btn secondary icon-only-btn"
                    style={{ fontSize: '0.75rem', padding: '3px 8px' }}
                    onClick={() => onMessageTeacher?.(course)}
                    title="Send message to teacher"
                  >
                    💬 Message
                  </button>
                )}
              </div>
            </div>

            {course.description && (
              <div style={{ marginBottom: '12px' }}>
                <label className="field-label">Description</label>
                <div className="sl-text" style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>{course.description}</div>
              </div>
            )}

            {course.learningOutcomes?.length > 0 && (
              <div>
                <label className="field-label">What you will learn</label>
                <ul style={{ margin: '4px 0 0 16px', padding: 0, fontSize: '0.85rem', color: '#cbd5e1' }}>
                  {course.learningOutcomes.map((o, i) => (
                    <li key={i} style={{ marginBottom: '4px' }}>{o}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Quick Navigator */}
          <div className="sidebar-section">
            <h4 className="sidebar-heading">Quick Navigator</h4>
            <button
              type="button"
              className={`course-assessments-nav ${isAssessmentsExpanded ? 'active' : ''}`}
              onClick={() => {
                setIsAssessmentsExpanded(true);
                const el = document.getElementById('student-assessments-panel');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              style={{ width: '100%', marginBottom: '12px' }}
              title="Jump to Course Assessments at top of right column"
            >
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div className="course-assessments-nav-label">🎯 Assessments & Rubrics</div>
                <div className="course-assessments-nav-sub">
                  {allAssessments.length} assessment{allAssessments.length === 1 ? '' : 's'}
                </div>
              </div>
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#fef08a' }}>
                Units of Study ({units.length})
              </span>
            </div>

            <div className="units-nav-list">
              {units.map((u, idx) => (
                <div
                  key={u.id || idx}
                  className={`unit-nav-item ${u.id === activeUnitId ? 'active' : ''}`}
                  onClick={() => {
                    setActiveUnitId(u.id);
                    setIsUnitsSectionExpanded(true);
                    const el = document.getElementById(`student-unit-${u.id}`);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="unit-nav-code">{u.unitCode || `UNIT-${idx + 1}`}</div>
                    <div className="unit-nav-title">{u.unitTitle || 'Untitled Unit'}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Right Main Area */}
        <main className="builder-main-panel glass sl-student-main">
          {/* Draft Course Notice Banner (if draft) */}
          {isDraftCourse && (
            <div className="glass sl-card sl-draft-banner" style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.3rem' }}>📝</span>
                <div>
                  <strong style={{ color: '#fef08a' }}>Draft Course Mode:</strong>
                  <span className="sl-muted" style={{ marginLeft: '6px' }}>
                    You have permission as an enrolled student to view and study this course. However, assessment submissions are locked while the course is in draft.
                  </span>
                </div>
              </div>
              <span className="sl-pill draft">DRAFT COURSE</span>
            </div>
          )}

          {/* Panel 1: 🎯 Course Assessments (Top of right column) */}
          <section id="student-assessments-panel" className="builder-collapsible-panel sl-assessments-top-panel" aria-label="Course Assessments" style={{ marginBottom: '28px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '10px',
                gap: '10px',
                flexWrap: 'wrap',
                cursor: 'pointer',
                padding: '6px 8px',
                borderRadius: '10px',
                background: 'rgba(255, 255, 255, 0.03)'
              }}
              onClick={() => setIsAssessmentsExpanded(prev => !prev)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  className="collapse-toggle-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsAssessmentsExpanded(prev => !prev);
                  }}
                  aria-label={isAssessmentsExpanded ? "Collapse Course Assessments" : "Expand Course Assessments"}
                  style={{ background: 'transparent', border: 'none', color: '#fef08a', fontSize: '1rem', cursor: 'pointer' }}
                >
                  {isAssessmentsExpanded ? '▼' : '►'}
                </button>
                <h3 style={{ margin: 0, fontSize: '1.15rem' }}>🎯 Course Assessments</h3>
                <span className="count-badge" style={{ background: '#3b82f6', color: '#fff', fontSize: '0.75rem', fontWeight: 800, padding: '2px 8px', borderRadius: '10px' }}>
                  {allAssessments.length}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                <button
                  type="button"
                  className="nav-btn secondary"
                  style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                  onClick={() => setIsAssessmentsExpanded(prev => !prev)}
                >
                  {isAssessmentsExpanded ? 'Collapse' : 'Expand'}
                </button>
              </div>
            </div>

            <p className="sl-muted" style={{ margin: '0 0 14px' }}>
              Review assessment questions, exercises, and marking rubrics. Enter your answers as drafts or submit for marking.
            </p>

            {isAssessmentsExpanded && (
              <div>
                {allAssessments.length === 0 ? (
                  <p className="sl-muted" style={{ marginTop: 8 }}>This course currently has no assessments listed.</p>
                ) : (
                  allAssessments.map(({ assessment, unitCode, unitTitle, unit }, aIdx) => {
                    const sub = submissions[assessment.id];
                    const isGraded = sub?.status === 'graded';
                    const isSub = sub?.status === 'submitted';
                    const isDraft = sub?.status === 'draft';
                    return (
                      <details key={assessment.id || aIdx} className="glass sl-assessment-dropdown" open>
                        <summary className="sl-asmt-summary">
                          <div className="sl-asmt-summary-title">
                            <span className={`sl-pill ${assessment.type || 'formative'}`}>
                              {String(assessment.type || 'formative').toUpperCase()}
                            </span>
                            <strong>{assessment.title}</strong>
                            {unitCode && <span className="sl-unit-pill">{unitCode}</span>}
                          </div>
                          <div className="sl-asmt-summary-meta">
                            {isGraded ? (
                              <span className="sl-status-tag graded">🏅 Graded: {sub.grade}</span>
                            ) : isSub ? (
                              <span className="sl-status-tag submitted">📥 Submitted</span>
                            ) : isDraft ? (
                              <span className="sl-status-tag draft">✏️ Draft Saved</span>
                            ) : (
                              <span className="sl-status-tag todo">📝 To Do</span>
                            )}
                            <span className="sl-muted">
                              {assessment.dueDate ? `Due ${formatLocalizedDate(assessment.dueDate)}` : 'No due date'}
                              {Number.isFinite(Number(assessment.nominalWeight)) ? ` • ${assessment.nominalWeight}%` : ''}
                            </span>
                          </div>
                        </summary>

                        <div className="sl-asmt-content">
                          {/* Task brief / description */}
                          {assessment.description && (
                            <div className="sl-asmt-brief">
                              <h5 style={{ margin: '0 0 4px', color: 'var(--text-secondary)' }}>📋 Task Description</h5>
                              <p className="sl-text">{assessment.description}</p>
                            </div>
                          )}

                          {/* Questions & Assessment Exercises */}
                          <QuestionsView assessment={assessment} />

                          {/* External submission links */}
                          {(assessment.externalSubmissionLinks || []).filter(isHttpUrl).map(href => (
                            <div key={href} style={{ margin: '8px 0' }}>
                              <ExternalLink href={href}>🔗 External submission page</ExternalLink>
                            </div>
                          ))}

                          {/* Marking Rubric */}
                          <RubricView rubric={assessment.rubric} rubricUrl={assessment.rubricUrl} />

                          {/* Draft and Official Submission Box */}
                          {loading ? <p className="sl-muted">Loading your submission…</p> : assessment.id ? (
                            <SubmissionBox
                              course={course}
                              unit={unit}
                              assessment={assessment}
                              currentUser={currentUser}
                              submission={submissions[assessment.id]}
                              isDraftCourse={isDraftCourse}
                              onSubmitted={saved => setSubmissionState(prev => ({
                                ...prev,
                                byAssessment: { ...prev.byAssessment, [assessment.id]: { ...prev.byAssessment[assessment.id], ...saved } }
                              }))}
                            />
                          ) : null}
                        </div>
                      </details>
                    );
                  })
                )}
              </div>
            )}
          </section>

          {/* Panel 2: 📚 Units of Study (Below Course Assessments) */}
          <section id="student-units-panel" className="builder-collapsible-panel sl-units-container" aria-label="Units of Study">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px',
                gap: '10px',
                flexWrap: 'wrap',
                cursor: 'pointer',
                padding: '6px 8px',
                borderRadius: '10px',
                background: 'rgba(255, 255, 255, 0.03)',
                borderTop: '1px solid rgba(255, 255, 255, 0.1)'
              }}
              onClick={() => setIsUnitsSectionExpanded(prev => !prev)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  className="collapse-toggle-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsUnitsSectionExpanded(prev => !prev);
                  }}
                  aria-label={isUnitsSectionExpanded ? "Collapse Units of Study" : "Expand Units of Study"}
                  style={{ background: 'transparent', border: 'none', color: '#fef08a', fontSize: '1rem', cursor: 'pointer' }}
                >
                  {isUnitsSectionExpanded ? '▼' : '►'}
                </button>
                <h3 style={{ margin: 0, fontSize: '1.15rem' }}>📚 Units of Study & Course Content</h3>
                <span className="count-badge" style={{ background: '#3b82f6', color: '#fff', fontSize: '0.75rem', fontWeight: 800, padding: '2px 8px', borderRadius: '10px' }}>
                  {units.length}
                </span>
                <span className="sl-muted" style={{ fontSize: '0.82rem', fontWeight: 400 }}>(View-Only)</span>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                <button
                  type="button"
                  className="nav-btn secondary"
                  style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                  onClick={() => setIsUnitsSectionExpanded(prev => !prev)}
                >
                  {isUnitsSectionExpanded ? 'Collapse' : 'Expand'}
                </button>
              </div>
            </div>

            {isUnitsSectionExpanded && (
              <div>
                {units.length === 0 && <p className="sl-muted">Your teacher has not added content units yet.</p>}

                {units.map((unit, uIdx) => (
                  <div key={unit.id || uIdx} id={`student-unit-${unit.id}`}>
                    <StudentUnitCard unit={unit} defaultOpen={uIdx === 0} renderQuiz={renderQuiz} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

const STATUS_LABEL = { overdue: '⚠️ Overdue', due: '📝 To do', draft: '✏️ Draft saved' };

/** Loads the student's submissions and quiz attempts for every enrolled course (a few at a time). */
async function loadAllSubmissions(courses, uid) {
  const submissions = {};
  const quizzes = {};
  const queue = courses.slice();
  const worker = async () => {
    while (queue.length) {
      const course = queue.shift();
      const [subs, attempts] = await Promise.all([
        listMySubmissions(course.id, uid).catch(() => ({})),
        listMyQuizAttempts(course.id, uid).catch(() => ({}))
      ]);
      submissions[course.id] = subs;
      quizzes[course.id] = attempts;
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  return { submissions, quizzes };
}

/**
 * Student Admin Panel: overview (progress, what is due), enrolled courses, content, assessments and
 * submission boxes. Messages to teachers and the Super Admin are in the 💬 Messages dock below.
 * @param {Array} courses enrolled course documents (with units)
 */
export default function StudentLearningPanel({
  currentUser,
  courses = [],
  loading = false,
  error = '',
  onRetry,
  onMessageTeacher,
  onBrowseGlobalCourses,
  onContactTeacher,
  tokenBalanceLabel = ''
}) {
  const [openCourseId, setOpenCourseId] = useState(null);
  // Bumped when the student returns to the overview, so progress reflects work just submitted.
  const [overviewVisit, setOverviewVisit] = useState(0);
  const [progress, setProgress] = useState({ key: null, byCourse: {}, quizzesByCourse: {} });
  const topRef = useRef(null);
  const openCourse = courses.find(c => String(c.id) === String(openCourseId));
  const uid = currentUser?.uid;
  const progressKey = `${uid || ''}|${courses.map(c => c.id).join(',')}|${overviewVisit}`;
  const wantsProgress = !openCourseId && courses.length > 0 && Boolean(uid);
  const progressLoading = wantsProgress && progress.key !== progressKey;

  useEffect(() => {
    topRef.current?.scrollIntoView?.({ block: 'start' });
  }, [openCourseId]);

  useEffect(() => {
    if (!wantsProgress) return undefined;
    let cancelled = false;
    loadAllSubmissions(courses, uid).then(({ submissions, quizzes }) => {
      if (!cancelled) setProgress({ key: progressKey, byCourse: submissions, quizzesByCourse: quizzes });
    });
    return () => {
      cancelled = true;
    };
  }, [wantsProgress, progressKey, courses, uid]);

  const { stats, perCourse, upcoming } = summarizeStudentProgress(courses, progress.byCourse, Date.now(), progress.quizzesByCourse);

  return (
    <div className="admin-section sl-root" ref={topRef}>
      {openCourse ? (
        <CourseViewer
          course={openCourse}
          currentUser={currentUser}
          onBack={() => {
            setOpenCourseId(null);
            setOverviewVisit(v => v + 1);
          }}
          onMessageTeacher={onMessageTeacher}
          enrolledCourses={courses}
          onSelectCourse={id => setOpenCourseId(id)}
        />
      ) : (
        <>
          <h2 className="section-title">🎓 Student Admin Panel</h2>
          <div className="glass sl-card sl-profile">
            <div>
              <div className="sl-profile-name">{currentUser?.displayName || 'Student'}</div>
              <div className="sl-muted">{currentUser?.email}</div>
            </div>
            {tokenBalanceLabel !== '' && <div className="sl-token">🪙 {tokenBalanceLabel} tokens</div>}
          </div>

          {loading && <p className="sl-muted">Loading your courses…</p>}
          {error && (
            <div className="sl-notice error" role="alert">
              {error} {onRetry && <button type="button" className="nav-btn secondary sl-small" onClick={onRetry}>Retry</button>}
            </div>
          )}
          {!loading && !error && courses.length === 0 && (
            <div className="glass sl-card" style={{ maxWidth: 640, textAlign: 'center', margin: '20px auto' }}>
              <h3>You are not enrolled in any courses yet</h3>
              <p className="sl-text" style={{ marginTop: '10px' }}>
                You can view Global Courses in the catalog, but a registered teacher must enrol you in their course.
                Ask your teacher to add <strong>{currentUser?.email}</strong> to their course.
              </p>
              <div className="sl-row" style={{ justifyContent: 'center', gap: '12px', marginTop: '16px' }}>
                {onBrowseGlobalCourses && (
                  <button type="button" className="nav-btn primary" onClick={onBrowseGlobalCourses}>
                    🌏 Browse Global Courses
                  </button>
                )}
                <button
                  type="button"
                  className="nav-btn secondary"
                  onClick={() => onContactTeacher ? onContactTeacher() : onMessageTeacher?.({ authorEmail: 'superadmin', authorName: 'Super Admin' })}
                >
                  💬 Contact a Teacher
                </button>
              </div>
            </div>
          )}

          {courses.length > 0 && (
            <div className="cards-grid" style={{ width: '100%', maxWidth: 1100, marginTop: '8px' }}>
              {courses.map(course => {
                const courseProg = perCourse[course.id] || { total: 0, submitted: 0, graded: 0 };
                const pct = courseProg.total ? Math.round((courseProg.submitted / courseProg.total) * 100) : 0;
                const isDraft = Boolean(course.isDraft || course.status === 'draft' || (Array.isArray(course.tags) && course.tags.includes('Draft')));
                return (
                  <div key={course.id} className="glass card sl-course-card">
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <div className="card-icon" style={{ margin: 0 }}>{isDraft ? '📝' : '📚'}</div>
                        {isDraft && <span className="sl-draft-pill" style={{ margin: 0 }}>Draft</span>}
                      </div>
                      <h3 style={{ margin: '4px 0 2px 0' }}>
                        {course.title}
                      </h3>
                      <p className="sl-muted">{course.authorName ? `Teacher: ${course.authorName}` : 'Course'}{course.category ? ` • ${course.category}` : ''}</p>
                      <p className="sl-muted">{(course.units || []).length} units • {courseProg.total} assessments • {courseProg.submitted} submitted • {courseProg.graded} graded{courseProg.quizzes ? ` • ${courseProg.quizzesDone}/${courseProg.quizzes} quizzes` : ''}</p>
                    </div>

                    <div style={{ marginTop: 'auto', width: '100%' }}>
                      {courseProg.total > 0 && (
                        <div className="sl-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${course.title} progress`} style={{ margin: '6px 0 8px' }}>
                          <span style={{ width: `${pct}%` }} />
                        </div>
                      )}
                      <div className="sl-card-btn-grid" style={{ display: 'grid', gridTemplateColumns: course.authorEmail ? '1fr 1fr' : '1fr', gap: '6px', width: '100%' }}>
                        <button type="button" className="nav-btn primary" style={{ padding: '7px 8px', fontSize: '0.8rem', whiteSpace: 'nowrap' }} onClick={() => setOpenCourseId(course.id)}>Open course</button>
                        {course.authorEmail && (
                          <button type="button" className="nav-btn secondary" style={{ padding: '7px 8px', fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} onClick={() => onMessageTeacher?.(course)}>
                            💬 Contact Teacher
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <style>{`
        .sl-root { gap: 0; padding-bottom: 20px; }
        .sl-viewer { width: 100%; max-width: 1000px; }
        .sl-card { border-radius: 16px; padding: 18px 20px; margin-bottom: 14px; }
        .sl-top-nav-bar { padding: 10px 16px; margin-bottom: 12px; }
        .sl-course-dropdown-wrap { display: flex; align-items: center; gap: 8px; flex: 1; max-width: 480px; }
        .sl-dropdown-mini-label { font-size: 0.85rem; font-weight: 600; color: var(--text-secondary); white-space: nowrap; }
        .sl-compact-select { padding: 6px 10px; font-size: 0.88rem; border-radius: 8px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15); }
        .sl-course-dropdown-card { width: 100%; max-width: 1000px; }
        .sl-select-title { font-size: 1rem; color: #cbd5e1; }
        .sl-course-select { font-size: 0.95rem; font-weight: 600; padding: 8px 12px; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.18); border-radius: 10px; }

        /* Draft Mode Banner & Pills */
        .sl-draft-banner { border-left: 4px solid #f59e0b; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; background: rgba(245,158,11,0.08); border-color: rgba(245,158,11,0.35); }
        .sl-draft-pill { font-size: 0.72rem; font-weight: 800; padding: 2px 7px; border-radius: 6px; background: rgba(245,158,11,0.22); color: #fbbf24; border: 1px solid rgba(245,158,11,0.45); margin-left: 8px; vertical-align: middle; }

        /* Assessments Section placed near top */
        .sl-assessments-top-panel { border-left: 4px solid #38bdf8; }
        .sl-section-heading { margin-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 10px; }
        .sl-count-pill { font-size: 0.8rem; font-weight: 800; padding: 2px 8px; border-radius: 12px; background: rgba(56,189,248,0.25); color: #7dd3fc; border: 1px solid rgba(56,189,248,0.4); }
        .sl-assessment-dropdown { border: 1px solid rgba(255,255,255,0.12); border-radius: 14px; margin-bottom: 12px; background: rgba(15,23,42,0.55); overflow: hidden; }
        .sl-asmt-summary { cursor: pointer; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; background: rgba(255,255,255,0.03); border-bottom: 1px solid rgba(255,255,255,0.06); }
        .sl-asmt-summary-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 1rem; }
        .sl-asmt-summary-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 0.85rem; }
        .sl-unit-pill { font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.08); color: #94a3b8; }
        .sl-status-tag { font-size: 0.75rem; font-weight: 700; padding: 3px 8px; border-radius: 6px; }
        .sl-status-tag.graded { background: rgba(34,197,94,0.2); color: #86efac; border: 1px solid rgba(74,222,128,0.4); }
        .sl-status-tag.submitted { background: rgba(59,130,246,0.2); color: #93c5fd; border: 1px solid rgba(96,165,250,0.4); }
        .sl-status-tag.draft { background: rgba(245,158,11,0.2); color: #fcd34d; border: 1px solid rgba(251,191,36,0.4); }
        .sl-status-tag.todo { background: rgba(148,163,184,0.15); color: #cbd5e1; }
        .sl-asmt-content { padding: 14px 18px; }
        .sl-asmt-brief { margin-bottom: 12px; padding: 10px 14px; border-radius: 10px; background: rgba(255,255,255,0.03); border-left: 3px solid rgba(255,255,255,0.2); }

        /* Questions & Exercises */
        .sl-questions-wrapper { margin: 12px 0; display: flex; flex-direction: column; gap: 10px; }
        .sl-asmt-box { padding: 12px 14px; border-radius: 12px; background: rgba(0,0,0,0.22); border: 1px solid rgba(255,255,255,0.08); }
        .sl-q-box { border-left: 3px solid #60a5fa; }
        .sl-ex-box { border-left: 3px solid #34d399; }
        .sl-sub-box { margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: rgba(255,255,255,0.04); }

        /* Units of Study: Dropdown on the right */
        .sl-units-container { margin-top: 10px; }
        .sl-unit-dropdown { border-radius: 14px; margin-bottom: 14px; border: 1px solid rgba(255,255,255,0.12); overflow: hidden; background: rgba(15,23,42,0.45); }
        .sl-unit-summary { cursor: pointer; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; background: rgba(255,255,255,0.03); }
        .sl-unit-summary-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 1.05rem; }
        .sl-unit-title { color: #f1f5f9; }
        .sl-unit-summary-right { display: flex; align-items: center; }
        .sl-unit-dropdown-btn { font-size: 0.8rem; font-weight: 700; padding: 5px 12px; border-radius: 8px; background: rgba(52,211,153,0.16); color: #34d399; border: 1px solid rgba(52,211,153,0.4); display: inline-flex; align-items: center; gap: 4px; transition: all 0.2s ease; }
        .sl-unit-dropdown-btn.open { background: rgba(255,255,255,0.1); color: #cbd5e1; border-color: rgba(255,255,255,0.2); }
        .sl-unit-dropdown-box { padding: 16px 18px; border-top: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.15); }
        .sl-unit-desc-card { padding: 12px 14px; border-radius: 10px; background: rgba(0,0,0,0.22); border: 1px solid rgba(255,255,255,0.08); margin-bottom: 12px; }
        .sl-unit-links-box { padding: 12px 14px; border-radius: 10px; background: rgba(0,0,0,0.22); border: 1px solid rgba(255,255,255,0.08); margin-bottom: 12px; }
        .sl-unit-links-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
        .sl-unit-link-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: #fcd34d; font-size: 0.83rem; text-decoration: none; font-weight: 600; transition: background 0.2s ease; }
        .sl-unit-link-chip:hover { background: rgba(255,255,255,0.12); text-decoration: underline; }
        .sl-chip-icon { font-size: 0.95rem; }
        .sl-chip-arrow { opacity: 0.75; font-size: 0.85rem; }

        /* Lesson content */
        .sl-lesson-box { border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; background: rgba(0,0,0,0.18); }
        .sl-lesson-header { display: flex; justify-content: space-between; align-items: center; font-weight: 600; font-size: 0.95rem; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .sl-lesson-name { color: #e2e8f0; }
        .sl-lesson-content { margin-top: 6px; }

        .sl-code { color: #34d399; font-weight: 800; margin-right: 4px; }
        .sl-muted { color: #94a3b8; font-size: 0.85rem; }
        .sl-text { white-space: pre-wrap; line-height: 1.6; color: var(--text-primary); overflow-wrap: anywhere; }
        .sl-block { margin: 8px 0 12px; padding-left: 10px; border-left: 3px solid rgba(52, 211, 153, 0.35); }
        .sl-block h5 { margin: 0 0 4px; font-size: 0.95rem; }
        .sl-quiz-block { border-left-color: rgba(167,139,250,0.6); }
        .sl-video { position: relative; width: 100%; max-width: 720px; aspect-ratio: 16 / 9; border-radius: 12px; overflow: hidden; background: #000; }
        .sl-video iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
        .sl-link { color: #fcd34d; font-weight: 600; text-decoration: none; }
        .sl-link:hover { text-decoration: underline; }
        .sl-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
        .sl-pill { padding: 2px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 800; background: #0d9488; color: #fff; }
        .sl-pill.summative { background: #e11d48; }
        .sl-pill.draft { background: #f59e0b; color: #000; font-weight: 800; }

        /* Rubrics */
        .sl-rubric { margin: 12px 0; border: 1px solid rgba(254,240,138,0.2); border-radius: 10px; padding: 10px 14px; background: rgba(0,0,0,0.18); }
        .sl-rubric summary { cursor: pointer; color: #fef08a; font-weight: 600; font-size: 0.9rem; }
        .sl-rubric-text { white-space: pre-wrap; margin-top: 6px; font-size: 0.88rem; }
        .sl-table-wrap { overflow-x: auto; margin-top: 8px; }
        .sl-table-wrap table { border-collapse: collapse; width: 100%; font-size: 0.8rem; }
        .sl-table-wrap th, .sl-table-wrap td { border: 1px solid rgba(255,255,255,0.12); padding: 6px 8px; vertical-align: top; text-align: left; }

        /* Submissions & Drafts */
        .sl-submit { margin-top: 14px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); }
        .sl-submit form { display: flex; flex-direction: column; gap: 6px; }
        .sl-label { font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); }
        .sl-status { padding: 8px 12px; border-radius: 10px; background: rgba(59,130,246,0.15); border: 1px solid rgba(96,165,250,0.4); margin-bottom: 8px; font-size: 0.88rem; }
        .sl-status.graded { background: rgba(34,197,94,0.15); border-color: rgba(74,222,128,0.45); }
        .sl-status.draft { background: rgba(245,158,11,0.15); border-color: rgba(251,191,36,0.45); color: #fde68a; }
        .sl-btn-cluster { display: flex; gap: 8px; align-items: center; }
        .sl-draft-btn { background: rgba(245,158,11,0.18) !important; color: #fcd34d !important; border: 1px solid rgba(245,158,11,0.4) !important; }
        .sl-draft-btn:hover { background: rgba(245,158,11,0.28) !important; }
        .sl-notice { padding: 8px 12px; border-radius: 10px; font-size: 0.85rem; margin: 6px 0; }
        .sl-notice.success { background: rgba(34,197,94,0.18); color: #bbf7d0; }
        .sl-notice.error { background: rgba(239,68,68,0.18); color: #fecaca; }
        .sl-course-card { aspect-ratio: 1 / 1; min-height: 240px; padding: 14px; box-sizing: border-box; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; }
        .sl-course-card h3 { margin: 4px 0 2px 0; font-size: 0.95rem; font-weight: 700; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; }
        .sl-card-btn-grid button { width: 100%; }
        @media (max-width: 600px) {
          .sl-course-card { padding: 10px; min-height: 190px; }
          .sl-course-card h3 { font-size: 0.85rem; }
        }
        .sl-profile { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; width: 100%; max-width: 1000px; }
        .sl-profile-name { font-weight: 800; font-size: 1.1rem; }
        .sl-token { font-weight: 800; color: #fcd34d; }
        .sl-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; width: 100%; max-width: 1000px; margin-bottom: 14px; }
        .sl-stat { display: flex; flex-direction: column; align-items: center; padding: 12px; border-radius: 14px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); }
        .sl-stat.warn { border-color: rgba(248,113,113,0.6); background: rgba(239,68,68,0.12); }
        .sl-stat-value { font-size: 1.5rem; font-weight: 800; }
        .sl-upcoming { width: 100%; max-width: 1000px; }
        .sl-due-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 0; border-top: 1px solid rgba(255,255,255,0.08); }
        .sl-due-row.overdue strong { color: #fca5a5; }
        .sl-due-right { display: flex; align-items: center; gap: 6px; }
        .sl-progress { height: 8px; border-radius: 6px; background: rgba(255,255,255,0.1); overflow: hidden; margin: 6px 0 10px; }
        .sl-progress span { display: block; height: 100%; background: linear-gradient(90deg, #34d399, #10b981); }

        /* Workspace Grid & Sidebar emulation for student view */
        .sl-viewer-grid {
          display: grid;
          grid-template-columns: 320px 1fr;
          gap: 18px;
          align-items: start;
        }
        @media (max-width: 980px) {
          .sl-viewer-grid {
            grid-template-columns: 1fr;
          }
        }
        .sl-student-sidebar {
          padding: 18px;
          border-radius: 16px;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .sl-student-main {
          padding: 20px;
          border-radius: 16px;
          min-height: 500px;
        }
      `}</style>
    </div>
  );
}
