import React, { useEffect, useRef, useState } from 'react';
import { readSpreadsheetFiles, SPREADSHEET_FILE_ACCEPT } from '../../services/spreadsheetReader';
import {
  parseCourseSpreadsheet,
  finalizeCourseDraft,
  hasSpreadsheetContent,
  estimateCourseBytes,
  formatImportWarning,
  FIRESTORE_SAFE_COURSE_BYTES
} from '../../services/courseSpreadsheetImport';
import { downloadCourseTemplate, downloadCourseExample, downloadCourseExport } from '../../services/courseSpreadsheetTemplate';
import { buildCourseFromSpreadsheetWithAI } from '../../services/courseSpreadsheetAiService';
import { getAqfLevelMeta } from '../../types/courseBuilderTypes';

const STAT_LABELS = [
  ['outcomes', 'learning outcomes'],
  ['units', 'units'],
  ['lessons', 'lessons'],
  ['blocks', 'content blocks'],
  ['assessments', 'assessments'],
  ['criteria', 'rubric criteria']
];

/**
 * Upload course spreadsheets, then import them as-is (free) or let Gemini build out the rest.
 * Used by the 📊 Spreadsheet window and by ✨ AI Assist → Spreadsheets.
 */
export default function CourseSpreadsheetPanel({
  course,
  currentUser,
  userProfile,
  aiAssistCost = 10,
  isAiAssistFree = false,
  displayBalance = '0',
  targetAqfLevel,
  curriculumStandards = [],
  skillTexts = {},
  primaryAction = 'import',
  onApplyCourse,
  onBusyChange,
  onRefreshBalance
}) {
  const [status, setStatus] = useState('idle'); // idle | reading | ready | building
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(null);
  const [showAllWarnings, setShowAllWarnings] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const abortRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort(); // stop Gemini calls if the window closes
    };
  }, []);

  useEffect(() => {
    onBusyChange?.(status === 'reading' || status === 'building');
  }, [status, onBusyChange]);

  const busy = status === 'reading' || status === 'building';

  const download = (fn, label) => {
    try {
      if (!fn()) setError(`${label} can only be downloaded in a browser.`);
    } catch (err) {
      console.error(`${label} download failed:`, err);
      setError(`${label} could not be created: ${err.message}`);
    }
  };

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length || busy) return;
    setError('');
    setParsed(null);
    setShowAllWarnings(false);
    setStatus('reading');
    try {
      const { sheets, warnings: readWarnings, fileNames } = await readSpreadsheetFiles(files);
      const result = parseCourseSpreadsheet(sheets);
      const preview = finalizeCourseDraft(result.draft, course);
      if (!mountedRef.current) return;
      setParsed({ ...result, readWarnings, fileNames, preview, bytes: estimateCourseBytes(preview) });
      setStatus('ready');
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err?.message || 'The spreadsheet could not be read.');
      setStatus('idle');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const canImport = Boolean(parsed) && (parsed.stats.units > 0 || Boolean(parsed.draft.course.title || parsed.draft.course.description || parsed.stats.outcomes));
  const canBuild = Boolean(parsed) && hasSpreadsheetContent(parsed);

  const handleImport = () => {
    if (!canImport) return;
    const { stats } = parsed;
    onApplyCourse?.(parsed.preview, {
      source: 'spreadsheet',
      message: `📊 Imported "${parsed.preview.title}" from your spreadsheet: ${stats.units} units, ${stats.lessons} lessons, ${stats.blocks} blocks, ${stats.assessments} assessments, ${stats.criteria} rubric criteria. Review it, then Save Draft.`,
      warnings: parsed.warnings.map(formatImportWarning)
    });
  };

  const handleBuild = async () => {
    if (!canBuild || busy) return;
    setError('');
    setStatus('building');
    setProgress({ stage: 'starting', done: 0, total: 1, message: 'Contacting Gemini…' });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await buildCourseFromSpreadsheetWithAI({
        currentUser,
        userProfile,
        parsed,
        baseCourse: course,
        targetAqfLevel,
        curriculumStandards,
        skillTexts,
        costTokens: aiAssistCost,
        signal: controller.signal,
        onProgress: p => mountedRef.current && setProgress(p)
      });
      if (!mountedRef.current) return;
      onRefreshBalance?.();
      onApplyCourse?.(result.course, { source: 'ai', message: result.message, warnings: result.warnings });
      setStatus('ready');
    } catch (err) {
      if (!mountedRef.current) return;
      onRefreshBalance?.();
      setError(err.code === 'INSUFFICIENT_TOKENS_FOR_AI'
        ? `⚠️ Insufficient tokens (${err.currentBalance}/${err.requiredTokens}). Ask the Super Admin for tokens in 💬 Messages, or import without AI (free).`
        : err.message || 'AI Assist could not build the course.');
      setStatus('ready');
    } finally {
      abortRef.current = null;
      if (mountedRef.current) setProgress(null);
    }
  };

  const allWarnings = parsed ? [...parsed.readWarnings, ...parsed.warnings.map(formatImportWarning)] : [];
  const shownWarnings = showAllWarnings ? allWarnings : allWarnings.slice(0, 12);
  const levelMeta = parsed ? getAqfLevelMeta(parsed.preview.aqfLevel) : null;
  const percent = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  const importButton = (
    <button type="button" className={`nav-btn ${primaryAction === 'import' ? 'primary' : 'secondary'}`} onClick={handleImport} disabled={!canImport || busy}>
      📥 Import into Course Builder (free)
    </button>
  );
  const buildButton = (
    <button
      type="button"
      className={`nav-btn ${primaryAction === 'ai' ? 'primary' : 'secondary'} ssp-ai-btn`}
      onClick={handleBuild}
      disabled={!canBuild || busy}
      title="Gemini keeps everything you typed and fills in the rest"
    >
      {status === 'building' ? '⚡ Gemini is building…' : `✨ Build out with Gemini AI (${isAiAssistFree ? '0' : aiAssistCost} tokens)`}
    </button>
  );

  return (
    <div className="ssp">
      <section className="ssp-step">
        <h4>1. Get the spreadsheet</h4>
        <p className="ssp-muted">Every part of a course, A to Z: Course details, Learning Outcomes, Units, Lessons, Content Blocks, Assessments and the Assessment Rubric Matrix (any number of criteria).</p>
        <p className="ssp-muted">Links: the Lessons tab has YouTube Video, Google Drive Resource and Gemini Notebook columns. Put as many links as you need in each cell, one per line, optionally as “Title | link”. Each link becomes its own block.</p>
        <div className="ssp-row">
          <button type="button" className="nav-btn secondary ssp-small" onClick={() => download(downloadCourseTemplate, 'The template')} disabled={busy}>⬇ Blank template (.xlsx)</button>
          <button type="button" className="nav-btn secondary ssp-small" onClick={() => download(downloadCourseExample, 'The example')} disabled={busy}>⬇ Worked example</button>
          <button type="button" className="nav-btn secondary ssp-small" onClick={() => download(() => downloadCourseExport(course), 'The export')} disabled={busy}>⬇ This course</button>
        </div>
      </section>

      <section className="ssp-step">
        <h4>2. Upload your completed spreadsheet(s)</h4>
        <label
          className={`ssp-drop ${isDragging ? 'dragging' : ''} ${busy ? 'disabled' : ''}`}
          onDragOver={e => {
            e.preventDefault();
            if (!busy) setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={e => {
            e.preventDefault();
            setIsDragging(false);
            handleFiles(e.dataTransfer?.files);
          }}
        >
          <span style={{ fontSize: '1.6rem' }}>📊</span>
          <strong>{status === 'reading' ? 'Reading spreadsheet…' : 'Click or drop files here'}</strong>
          <span className="ssp-muted">.xlsx, .xls, .ods or .csv — several CSV tabs can be uploaded together (max 10 files, 10 MB each)</span>
          <input
            ref={fileInputRef}
            type="file"
            accept={SPREADSHEET_FILE_ACCEPT}
            multiple
            disabled={busy}
            onChange={e => handleFiles(e.target.files)}
            style={{ display: 'none' }}
          />
        </label>
      </section>

      {error && <div className="ssp-notice error" role="alert">{error}</div>}

      {parsed && (
        <section className="ssp-step">
          <h4>3. Check and build</h4>
          <div className="ssp-summary glass">
            <div><strong>{parsed.preview.title}</strong>{parsed.preview.code ? ` (${parsed.preview.code})` : ''} • {levelMeta?.shortTitle}</div>
            <div className="ssp-stats">
              {STAT_LABELS.map(([key, label]) => (
                <span key={key} className="ssp-stat"><strong>{parsed.stats[key]}</strong> {label}</span>
              ))}
            </div>
            <div className="ssp-muted">
              Files: {parsed.fileNames.join(', ')}
              {parsed.recognizedSheets.length > 0 && <> • Recognised: {parsed.recognizedSheets.join(', ')}</>}
              {parsed.unstructuredSheets.length > 0 && <> • For ✨ AI only: {parsed.unstructuredSheets.join(', ')}</>}
            </div>
            {parsed.bytes > FIRESTORE_SAFE_COURSE_BYTES && (
              <div className="ssp-notice error">This course is very large (~{Math.round(parsed.bytes / 1024)} KB). Each course is saved as one database record (limit 1 MB), so saving may fail — consider splitting it into two courses.</div>
            )}
          </div>

          {allWarnings.length > 0 && (
            <div className="ssp-warnings">
              <strong>⚠️ {allWarnings.length}{parsed.warningsTruncated ? '+' : ''} note{allWarnings.length === 1 ? '' : 's'}</strong>
              <ul>{shownWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              {allWarnings.length > shownWarnings.length && (
                <button type="button" className="ssp-link" onClick={() => setShowAllWarnings(true)}>Show all {allWarnings.length}</button>
              )}
            </div>
          )}

          {status === 'building' && progress && (
            <div className="ssp-progress" role="status" aria-live="polite">
              <div className="ssp-progress-bar"><div style={{ width: `${Math.max(5, percent)}%` }} /></div>
              <span>{progress.message}</span>
            </div>
          )}

          <div className="ssp-row ssp-actions">
            {primaryAction === 'ai' ? <>{importButton}{buildButton}</> : <>{buildButton}{importButton}</>}
          </div>
          <p className="ssp-muted">
            Import replaces this course's units with the spreadsheet's and fills the course details you provided (blank details keep their current values).
            ✨ Gemini keeps every value you typed exactly, fills in everything left blank, and never invents links.
            {' '}Your balance: {displayBalance} tokens{isAiAssistFree ? ' (AI Assist is free for you)' : ` — the ${aiAssistCost}-token fee is charged only after Gemini returns content`}.
          </p>
          {!canImport && <p className="ssp-muted">Nothing in this file matches the template's tabs, so it cannot be imported directly — ✨ Gemini can still build the course from it.</p>}
        </section>
      )}

      <style>{`
        .ssp { display: flex; flex-direction: column; gap: 14px; }
        .ssp-step h4 { margin: 0 0 6px; color: #fef08a; font-size: 0.95rem; }
        .ssp-muted { color: var(--text-secondary); font-size: 0.8rem; margin: 4px 0; line-height: 1.45; }
        .ssp-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .ssp-small { padding: 6px 12px !important; font-size: 0.8rem !important; }
        .ssp-drop {
          display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 18px; text-align: center;
          border: 2px dashed rgba(250, 204, 21, 0.45); border-radius: 14px; cursor: pointer; background: rgba(0,0,0,0.18);
        }
        .ssp-drop.dragging { background: rgba(250, 204, 21, 0.12); border-color: #facc15; }
        .ssp-drop.disabled { opacity: 0.6; cursor: wait; }
        .ssp-summary { border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
        .ssp-stats { display: flex; gap: 8px; flex-wrap: wrap; }
        .ssp-stat { background: rgba(255,255,255,0.07); border-radius: 8px; padding: 2px 8px; font-size: 0.8rem; }
        .ssp-warnings { background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 10px; padding: 8px 12px; font-size: 0.8rem; max-height: 220px; overflow-y: auto; }
        .ssp-warnings ul { margin: 6px 0 0; padding-left: 18px; }
        .ssp-link { background: none; padding: 0; color: #fcd34d; text-decoration: underline; font-size: 0.8rem; }
        .ssp-notice { padding: 8px 12px; border-radius: 10px; font-size: 0.85rem; }
        .ssp-notice.error { background: rgba(239,68,68,0.18); border: 1px solid rgba(248,113,113,0.45); color: #fecaca; }
        .ssp-progress { display: flex; flex-direction: column; gap: 6px; font-size: 0.85rem; color: #e9d5ff; }
        .ssp-progress-bar { height: 8px; background: rgba(255,255,255,0.1); border-radius: 999px; overflow: hidden; }
        .ssp-progress-bar > div { height: 100%; background: linear-gradient(90deg, #a855f7, #6366f1); transition: width 0.4s ease; }
        .ssp-actions { margin-top: 10px; }
        .ssp-ai-btn.primary { background: linear-gradient(135deg, #a855f7, #6366f1) !important; }
      `}</style>
    </div>
  );
}
