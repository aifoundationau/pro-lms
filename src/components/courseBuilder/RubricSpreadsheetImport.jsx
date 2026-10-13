import React, { useEffect, useRef, useState } from 'react';
import { readSpreadsheetFiles, SPREADSHEET_FILE_ACCEPT } from '../../services/spreadsheetReader';
import { parseRubricSpreadsheet, formatImportWarning } from '../../services/courseSpreadsheetImport';
import { downloadRubricWorkbook } from '../../services/courseSpreadsheetTemplate';

function weightTotal(rubric) {
  return Math.round((rubric || []).reduce((sum, c) => sum + (Number(c.weightPercentage) || 0), 0) * 100) / 100;
}

/**
 * "⬆ Upload Rubric" / "⬇ Rubric (.xlsx)" for one assessment's Rubric Matrix.
 * The uploaded sheet may have any number of Criterion & Weight rows and 2–10 level columns.
 */
export default function RubricSpreadsheetImport({ assessment, onApply }) {
  const inputRef = useRef(null);
  const mountedRef = useRef(true);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleFile = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setError('');
    setReading(true);
    try {
      const { sheets, warnings } = await readSpreadsheetFiles(files.slice(0, 1));
      const result = parseRubricSpreadsheet(sheets, { assessmentTitle: assessment?.title || '' });
      if (!mountedRef.current) return;
      setPreview({ ...result, fileName: files[0].name, notes: [...warnings, ...result.warnings.map(formatImportWarning)] });
    } catch (err) {
      if (mountedRef.current) setError(err?.message || 'The rubric could not be read.');
    } finally {
      if (mountedRef.current) setReading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const apply = (mode) => {
    if (!preview) return;
    const current = Array.isArray(assessment?.rubric) ? assessment.rubric : [];
    onApply(mode === 'append' ? [...current, ...preview.rubric] : preview.rubric);
    setPreview(null);
  };

  const handleDownload = () => {
    try {
      if (!downloadRubricWorkbook(assessment)) setError('Downloads are only available in a browser.');
    } catch (err) {
      setError(`The rubric file could not be created: ${err.message}`);
    }
  };

  const labels = preview?.levelLabels || [];
  const total = preview ? weightTotal(preview.rubric) : 0;

  return (
    <>
      <span className="rsi-actions">
        <button type="button" className="nav-btn secondary rsi-btn" onClick={() => inputRef.current?.click()} disabled={reading} title="Upload a rubric spreadsheet (.xlsx, .xls, .ods or .csv): Criterion | Weight % | one column per level">
          {reading ? 'Reading…' : '⬆ Upload Rubric'}
        </button>
        <button type="button" className="nav-btn secondary rsi-btn" onClick={handleDownload} title="Download this rubric as a spreadsheet to edit and re-upload">
          ⬇ Rubric (.xlsx)
        </button>
        <input ref={inputRef} type="file" accept={SPREADSHEET_FILE_ACCEPT} style={{ display: 'none' }} onChange={e => handleFile(e.target.files)} />
      </span>
      {error && <div className="rsi-error" role="alert">⚠️ {error}</div>}

      {preview && (
        <div className="builder-modal-overlay" onClick={() => setPreview(null)}>
          <div className="builder-modal-dialog glass rsi-dialog" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="rsi-title">
            <div className="modal-header">
              <h3 id="rsi-title" style={{ margin: 0, color: '#fef08a' }}>📊 Rubric from “{preview.fileName}”</h3>
              <button className="close-btn" onClick={() => setPreview(null)} aria-label="Close">✕</button>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '4px 0 10px' }}>
              {preview.rubric.length} criteria • {labels.length} performance levels •{' '}
              <strong style={{ color: Math.abs(total - 100) < 0.01 ? '#86efac' : '#fca5a5' }}>Σ {total}%</strong>
              {' '}— for “{assessment?.title || 'this assessment'}”.
            </p>
            {preview.notes.length > 0 && (
              <ul className="rsi-notes">{preview.notes.slice(0, 10).map((n, i) => <li key={i}>{n}</li>)}</ul>
            )}
            <div className="rubric-table-responsive">
              <table className="rubric-matrix-table">
                <thead>
                  <tr>
                    <th>Criterion & Weight</th>
                    {labels.map((label, i) => <th key={i}>{label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {preview.rubric.map(c => (
                    <tr key={c.id}>
                      <td><strong>{c.criterionTitle}</strong><div style={{ color: '#94a3b8' }}>{c.weightPercentage}%</div></td>
                      {labels.map((_, i) => <td key={i}>{c.levels[i]?.descriptor || <span style={{ color: '#64748b' }}>—</span>}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px', flexWrap: 'wrap' }}>
              <button type="button" className="nav-btn secondary" onClick={() => setPreview(null)}>Cancel</button>
              <button type="button" className="nav-btn secondary" onClick={() => apply('append')}>➕ Add to current rubric</button>
              <button type="button" className="nav-btn primary" onClick={() => apply('replace')}>Replace rubric</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .rsi-actions { display: inline-flex; gap: 6px; flex-wrap: wrap; }
        .rsi-btn { font-size: 0.78rem !important; padding: 4px 8px !important; }
        .rsi-error { color: #fca5a5; font-size: 0.78rem; margin: 6px 0; }
        .rsi-dialog { max-width: 920px !important; }
        .rsi-notes { font-size: 0.78rem; color: #fcd34d; margin: 0 0 10px; padding-left: 18px; }
      `}</style>
    </>
  );
}
