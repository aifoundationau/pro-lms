import React, { useEffect, useRef, useState } from 'react';
import { listMySubmissions, submitAssessment, MAX_SUBMISSION_CHARS } from '../../services/submissionService';
import { isHttpUrl } from '../../services/courseSpreadsheetSchema';
import { formatLocalizedDate } from '../../services/geminiCourseService';
import { LINK_BLOCK_METADATA_KEYS } from '../../types/courseBuilderTypes';
import { youtubeVideoId, isGoogleDocsUrl } from '../../services/mediaLinks';

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
function StudentBlock({ block }) {
  if (block.type === 'teacher_guide') return null;
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

function RubricView({ rubric }) {
  const rows = Array.isArray(rubric) ? rubric : [];
  if (!rows.length) return null;
  const labels = rows.reduce((best, c) => ((c.levels || []).length > best.length ? (c.levels || []).map(l => l.label) : best), []);
  return (
    <details className="sl-rubric">
      <summary>📊 How this is marked ({rows.length} criteria)</summary>
      <div className="sl-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Criterion</th>
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
    </details>
  );
}

function SubmissionBox({ course, unit, assessment, currentUser, submission, onSubmitted }) {
  const [text, setText] = useState(submission?.text || '');
  const [link, setLink] = useState(submission?.linkUrl || '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const graded = submission?.status === 'graded';

  const handleSubmit = async (e) => {
    e.preventDefault();
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
      {submission && (
        <div className={`sl-status ${graded ? 'graded' : ''}`}>
          {graded ? (
            <>
              <strong>🏅 Grade: {submission.grade}</strong>
              {submission.feedback && <div className="sl-text" style={{ marginTop: 4 }}>{submission.feedback}</div>}
              <div className="sl-muted">Graded by {submission.gradedByName || 'your teacher'}</div>
            </>
          ) : (
            <span>📥 Submitted{submission.submittedAtMs ? ` ${new Date(submission.submittedAtMs).toLocaleString()}` : ''}{submission.attempts > 1 ? ` • attempt ${submission.attempts}` : ''} — awaiting marking</span>
          )}
        </div>
      )}
      {!graded && (
        <form onSubmit={handleSubmit}>
          <label className="sl-label" htmlFor={`ans-${assessment.id}`}>Your answer</label>
          <textarea
            id={`ans-${assessment.id}`}
            className="form-input"
            rows={5}
            maxLength={MAX_SUBMISSION_CHARS}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Type your answer here…"
          />
          <label className="sl-label" htmlFor={`link-${assessment.id}`}>Link to your work (optional)</label>
          <input
            id={`link-${assessment.id}`}
            type="url"
            className="form-input"
            value={link}
            onChange={e => setLink(e.target.value)}
            placeholder="https://docs.google.com/… (share as “Anyone with the link can view”)"
          />
          {notice && <div className={`sl-notice ${notice.type}`} role="status">{notice.message}</div>}
          <div className="sl-row">
            <span className="sl-muted">{text.length.toLocaleString()}/{MAX_SUBMISSION_CHARS.toLocaleString()}</span>
            <button type="submit" className="nav-btn primary" disabled={busy || (!text.trim() && !link.trim())}>
              {busy ? 'Submitting…' : submission ? 'Resubmit' : 'Submit'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function CourseViewer({ course, currentUser, onBack, onMessageTeacher }) {
  // Submissions for this course; "loading" until they arrive for the open course.
  const [submissionState, setSubmissionState] = useState({ courseId: null, byAssessment: {} });
  const loading = submissionState.courseId !== course.id;
  const submissions = submissionState.byAssessment;
  const units = Array.isArray(course.units) ? course.units : [];

  useEffect(() => {
    let cancelled = false;
    listMySubmissions(course.id, currentUser?.uid).then(byAssessment => {
      if (!cancelled) setSubmissionState({ courseId: course.id, byAssessment });
    });
    return () => {
      cancelled = true;
    };
  }, [course.id, currentUser?.uid]);

  return (
    <div className="sl-viewer">
      <div className="sl-row" style={{ marginBottom: 12 }}>
        <button type="button" className="nav-btn secondary" onClick={onBack}>← My Learning</button>
        {course.authorEmail && (
          <button type="button" className="nav-btn secondary" onClick={() => onMessageTeacher?.(course)}>💬 Message teacher</button>
        )}
      </div>
      <header className="glass sl-card">
        <div className="sl-muted">{course.category || 'Course'}{course.code ? ` • ${course.code}` : ''}</div>
        <h2 style={{ margin: '4px 0' }}>{course.title}</h2>
        <div className="sl-muted">Teacher: {course.authorName || 'Your teacher'}{course.startDate ? ` • Starts ${formatLocalizedDate(course.startDate)}` : ''}</div>
        {course.description && <p className="sl-text">{course.description}</p>}
        {course.learningOutcomes?.length > 0 && (
          <>
            <h4 style={{ marginBottom: 4 }}>What you will learn</h4>
            <ul>{course.learningOutcomes.map((o, i) => <li key={i}>{o}</li>)}</ul>
          </>
        )}
      </header>

      {units.length === 0 && <p className="sl-muted">Your teacher has not added content yet.</p>}
      {units.map((unit, uIdx) => (
        <details key={unit.id || uIdx} className="glass sl-card sl-unit" open={uIdx === 0}>
          <summary>
            <span className="sl-code">{unit.unitCode}</span> {unit.unitTitle}
            <span className="sl-muted"> • {unit.nominalHours || 0} hrs • {(unit.lessons || []).length} lessons • {(unit.assessments || []).length} assessments</span>
          </summary>
          {unit.description && <p className="sl-text">{unit.description}</p>}

          {(unit.lessons || []).map((lesson, lIdx) => (
            <div key={lesson.id || lIdx} className="sl-lesson">
              <h4>📘 {lesson.title} <span className="sl-muted">({lesson.estimatedMinutes || 45} min)</span></h4>
              {(lesson.blocks || []).map((block, bIdx) => <StudentBlock key={block.id || bIdx} block={block} />)}
            </div>
          ))}

          {(unit.assessments || []).length > 0 && <h4 style={{ marginTop: 18 }}>🎯 Assessments</h4>}
          {(unit.assessments || []).map((assessment, aIdx) => (
            <div key={assessment.id || aIdx} className="sl-assessment">
              <div className="sl-row">
                <strong>{assessment.title}</strong>
                <span className={`sl-pill ${assessment.type}`}>{String(assessment.type || 'formative').toUpperCase()}</span>
              </div>
              <div className="sl-muted">
                {assessment.dueDate ? `Due ${formatLocalizedDate(assessment.dueDate)}` : 'No due date'}
                {Number.isFinite(Number(assessment.nominalWeight)) ? ` • ${assessment.nominalWeight}% of unit` : ''}
              </div>
              {assessment.description && <div className="sl-text">{assessment.description}</div>}
              {(assessment.externalSubmissionLinks || []).filter(isHttpUrl).map(href => (
                <div key={href}><ExternalLink href={href}>🔗 External submission page</ExternalLink></div>
              ))}
              <RubricView rubric={assessment.rubric} />
              {loading ? <p className="sl-muted">Loading your submission…</p> : assessment.id ? (
                <SubmissionBox
                  course={course}
                  unit={unit}
                  assessment={assessment}
                  currentUser={currentUser}
                  submission={submissions[assessment.id]}
                  onSubmitted={saved => setSubmissionState(prev => ({
                    ...prev,
                    byAssessment: { ...prev.byAssessment, [assessment.id]: { ...prev.byAssessment[assessment.id], ...saved } }
                  }))}
                />
              ) : null}
            </div>
          ))}
        </details>
      ))}
    </div>
  );
}

/**
 * Student Admin Panel ("My Learning"): enrolled courses, content, assessments and submission boxes.
 * @param {Array} courses enrolled course documents (with units)
 */
export default function StudentLearningPanel({ currentUser, courses = [], loading = false, error = '', onRetry, onMessageTeacher }) {
  const [openCourseId, setOpenCourseId] = useState(null);
  const topRef = useRef(null);
  const openCourse = courses.find(c => String(c.id) === String(openCourseId));

  useEffect(() => {
    topRef.current?.scrollIntoView?.({ block: 'start' });
  }, [openCourseId]);

  return (
    <div className="admin-section sl-root" ref={topRef}>
      {openCourse ? (
        <CourseViewer course={openCourse} currentUser={currentUser} onBack={() => setOpenCourseId(null)} onMessageTeacher={onMessageTeacher} />
      ) : (
        <>
          <h2 className="section-title">🎓 My Learning</h2>
          {loading && <p className="sl-muted">Loading your courses…</p>}
          {error && (
            <div className="sl-notice error" role="alert">
              {error} {onRetry && <button type="button" className="nav-btn secondary sl-small" onClick={onRetry}>Retry</button>}
            </div>
          )}
          {!loading && !error && courses.length === 0 && (
            <div className="glass sl-card" style={{ maxWidth: 640, textAlign: 'center' }}>
              <h3>You are not enrolled in any courses yet</h3>
              <p className="sl-text">
                Ask your teacher to add <strong>{currentUser?.email}</strong> to their course. It will appear here as soon as they do.
                You can also message the Super Admin from 💬 Messages below.
              </p>
            </div>
          )}
          <div className="cards-grid">
            {courses.map(course => (
              <div key={course.id} className="glass card sl-course-card">
                <div className="card-icon">📚</div>
                <h3>{course.title}</h3>
                <p className="sl-muted">{course.authorName ? `Teacher: ${course.authorName}` : 'Course'}{course.category ? ` • ${course.category}` : ''}</p>
                <p className="sl-muted">{(course.units || []).length} units • {(course.units || []).reduce((n, u) => n + (u.assessments || []).length, 0)} assessments</p>
                <button type="button" className="nav-btn primary" onClick={() => setOpenCourseId(course.id)}>Open course</button>
              </div>
            ))}
          </div>
        </>
      )}

      <style>{`
        .sl-root { gap: 0; padding-bottom: 20px; }
        .sl-viewer { width: 100%; max-width: 1000px; }
        .sl-card { border-radius: 16px; padding: 18px 20px; margin-bottom: 14px; }
        .sl-unit > summary { cursor: pointer; font-weight: 700; font-size: 1.05rem; }
        .sl-code { color: #34d399; font-weight: 800; margin-right: 4px; }
        .sl-muted { color: #94a3b8; font-size: 0.85rem; }
        .sl-text { white-space: pre-wrap; line-height: 1.6; color: var(--text-primary); overflow-wrap: anywhere; }
        .sl-lesson { border-top: 1px solid rgba(255,255,255,0.08); padding-top: 10px; margin-top: 12px; }
        .sl-lesson h4 { margin: 6px 0; }
        .sl-block { margin: 8px 0 12px; padding-left: 10px; border-left: 3px solid rgba(52, 211, 153, 0.35); }
        .sl-block h5 { margin: 0 0 4px; font-size: 0.95rem; }
        .sl-video { position: relative; width: 100%; max-width: 720px; aspect-ratio: 16 / 9; border-radius: 12px; overflow: hidden; background: #000; }
        .sl-video iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
        .sl-link { color: #fcd34d; font-weight: 600; text-decoration: none; }
        .sl-link:hover { text-decoration: underline; }
        .sl-assessment { border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 12px 14px; margin-top: 10px; background: rgba(0,0,0,0.18); }
        .sl-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
        .sl-pill { padding: 2px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 800; background: #0d9488; color: #fff; }
        .sl-pill.summative { background: #e11d48; }
        .sl-rubric { margin: 10px 0; }
        .sl-rubric summary { cursor: pointer; color: #fef08a; font-weight: 600; font-size: 0.9rem; }
        .sl-table-wrap { overflow-x: auto; margin-top: 8px; }
        .sl-table-wrap table { border-collapse: collapse; width: 100%; font-size: 0.8rem; }
        .sl-table-wrap th, .sl-table-wrap td { border: 1px solid rgba(255,255,255,0.12); padding: 6px 8px; vertical-align: top; text-align: left; }
        .sl-submit { margin-top: 10px; }
        .sl-submit form { display: flex; flex-direction: column; gap: 6px; }
        .sl-label { font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); }
        .sl-status { padding: 8px 12px; border-radius: 10px; background: rgba(59,130,246,0.15); border: 1px solid rgba(96,165,250,0.4); margin-bottom: 8px; font-size: 0.88rem; }
        .sl-status.graded { background: rgba(34,197,94,0.15); border-color: rgba(74,222,128,0.45); }
        .sl-notice { padding: 8px 12px; border-radius: 10px; font-size: 0.85rem; margin: 6px 0; }
        .sl-notice.success { background: rgba(34,197,94,0.18); color: #bbf7d0; }
        .sl-notice.error { background: rgba(239,68,68,0.18); color: #fecaca; }
        .sl-small { padding: 4px 10px !important; font-size: 0.8rem !important; margin-left: 8px; }
        .sl-course-card h3 { margin: 6px 0; }
      `}</style>
    </div>
  );
}
