/**
 * Dependency-free XLSX writer for downloadable OzEdu spreadsheets (templates & exports).
 *
 * Produces a standard Office Open XML workbook (ZIP "store" method, inline strings) that
 * Excel, Google Sheets, LibreOffice and Numbers open without repair prompts. Supports bold
 * frozen header rows, column widths, wrapped text, dropdown lists and hover hints.
 * Pure module: runs in the browser and in Node tests.
 */

const encoder = new TextEncoder();

export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Cell style ids (indexes into cellXfs in STYLES_XML). */
export const XLSX_STYLE = Object.freeze({
  DEFAULT: 0,
  HEADER: 1,   // bold white on navy, bordered
  WRAP: 2,     // wrapped body text, top aligned
  TITLE: 3,    // large bold title
  CALLOUT: 4,  // pale yellow note box
  TEXT: 5,     // "Text" number format, so codes like MAR-01 are not turned into dates
  SECTION: 6,  // bold section heading
  LABEL: 7     // bold grey field label
});

const EXCEL_MAX_CELL_CHARS = 32767;
const MAX_SHEET_NAME_CHARS = 31;

// ---------- ZIP (store method, no compression) ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Fixed timestamp (2026-01-01 00:00) keeps output byte-identical between runs.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const UTF8_NAMES_FLAG = 0x0800;

function zipStore(files) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const { path, data } of files) {
    const name = encoder.encode(path);
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, UTF8_NAMES_FLAG, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, DOS_TIME, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, UTF8_NAMES_FLAG, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, DOS_TIME, true);
    entry.setUint16(14, DOS_DATE, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true); // extra/comment/disk/attrs fields stay 0
    central.push(new Uint8Array(entry.buffer), name);

    offset += 30 + name.length + data.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of all) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

// ---------- XML helpers ----------

// XML 1.0 forbids these control characters; Excel refuses files that contain them.
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

function escapeXml(value) {
  return String(value)
    .replace(INVALID_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(value, max) {
  const s = String(value ?? '');
  return s.length > max ? s.slice(0, max) : s;
}

/** 0-based column index -> Excel letters (0 -> A, 26 -> AA). */
export function columnLetter(index) {
  let n = Math.floor(index) + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Excel sheet names: max 31 chars, none of []:*?/\ and unique within the workbook. */
function safeSheetName(name, used) {
  const base = truncate(String(name || 'Sheet').replace(/[[\]:*?/\\]/g, ' ').trim() || 'Sheet', MAX_SHEET_NAME_CHARS);
  let candidate = base;
  for (let i = 2; used.has(candidate.toLowerCase()); i++) {
    const suffix = ` (${i})`;
    candidate = truncate(base, MAX_SHEET_NAME_CHARS - suffix.length) + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="5">
<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
<font><b/><sz val="16"/><color rgb="FF1F3864"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
<font><b/><sz val="12"/><color rgb="FF1F4E79"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
</fonts>
<fills count="5">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="0"/>
<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;

/** Cells without an explicit style inherit their column's style (e.g. Text format for codes). */
function cellXml(ref, cell, columnStyle) {
  const isObj = cell !== null && typeof cell === 'object';
  const value = isObj ? cell.v : cell;
  const style = isObj && Number.isInteger(cell.s) ? cell.s : (Number.isInteger(columnStyle) ? columnStyle : null);
  const sAttr = style ? ` s="${style}"` : '';

  if (value === null || value === undefined || value === '') {
    return style ? `<c r="${ref}"${sAttr}/>` : '';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"${sAttr}><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${ref}"${sAttr} t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  const text = escapeXml(truncate(String(value).replace(/\r\n?/g, '\n'), EXCEL_MAX_CELL_CHARS));
  return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

// Inline list validations must be <= 255 chars and items may not contain commas or quotes.
function listFormula(items) {
  const cleaned = (items || [])
    .map(item => String(item).replace(/[,"]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const kept = [];
  for (const item of cleaned) {
    if ([...kept, item].join(',').length > 253) break;
    kept.push(item);
  }
  return `"${escapeXml(kept.join(','))}"`;
}

function validationXml(v) {
  const attrs = [];
  if (Array.isArray(v.list) && v.list.length) {
    attrs.push('type="list"', 'errorStyle="warning"', 'showErrorMessage="1"');
    attrs.push(`errorTitle="${escapeXml(truncate(v.errorTitle || 'Unrecognised value', 32))}"`);
    attrs.push(`error="${escapeXml(truncate(v.error || 'Choose a value from the list (other values may not import as expected).', 225))}"`);
  }
  attrs.push('allowBlank="1"');
  if (v.prompt) {
    attrs.push('showInputMessage="1"');
    if (v.promptTitle) attrs.push(`promptTitle="${escapeXml(truncate(v.promptTitle, 32))}"`);
    attrs.push(`prompt="${escapeXml(truncate(v.prompt, 255))}"`);
  }
  attrs.push(`sqref="${escapeXml(v.range)}"`);
  const formula = Array.isArray(v.list) && v.list.length ? `<formula1>${listFormula(v.list)}</formula1>` : '';
  return formula ? `<dataValidation ${attrs.join(' ')}>${formula}</dataValidation>` : `<dataValidation ${attrs.join(' ')}/>`;
}

/**
 * Sheet definition:
 * {
 *   name: 'Units',
 *   columns: [{ width: 18, style: XLSX_STYLE.TEXT }],   // optional per-column width / default style
 *   rows: [[ 'Unit Code', { v: 'Title', s: XLSX_STYLE.HEADER } ], ...],
 *   rowHeights: { 0: 32 },                                // optional, by 0-based row index
 *   freezeRows: 1,                                        // header rows to freeze
 *   merges: ['A1:F1'],
 *   validations: [{ range: 'D2:D500', list: ['Formative', 'Summative'], promptTitle, prompt }],
 *   tabColor: 'FF1F4E79'
 * }
 */
function worksheetXml(sheet, isFirst) {
  const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
  const columns = Array.isArray(sheet.columns) ? sheet.columns : [];
  const colCount = Math.max(1, columns.length, ...rows.map(r => (Array.isArray(r) ? r.length : 0)));
  const rowCount = Math.max(1, rows.length);
  const dimension = colCount === 1 && rowCount === 1 ? 'A1' : `A1:${columnLetter(colCount - 1)}${rowCount}`;
  const freezeRows = Math.max(0, Math.floor(Number(sheet.freezeRows) || 0));

  const xml = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'];
  xml.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">');
  if (sheet.tabColor) xml.push(`<sheetPr><tabColor rgb="${escapeXml(sheet.tabColor)}"/></sheetPr>`);
  xml.push(`<dimension ref="${dimension}"/>`);

  const selected = isFirst ? ' tabSelected="1"' : '';
  if (freezeRows > 0) {
    const topLeft = `A${freezeRows + 1}`;
    xml.push(`<sheetViews><sheetView workbookViewId="0"${selected}><pane ySplit="${freezeRows}" topLeftCell="${topLeft}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="${topLeft}" sqref="${topLeft}"/></sheetView></sheetViews>`);
  } else {
    xml.push(`<sheetViews><sheetView workbookViewId="0"${selected}/></sheetViews>`);
  }
  xml.push('<sheetFormatPr defaultRowHeight="15"/>');

  if (columns.length) {
    xml.push('<cols>');
    columns.forEach((col, i) => {
      const width = Math.min(255, Math.max(2, Number(col?.width) || 12));
      const style = Number.isInteger(col?.style) && col.style > 0 ? ` style="${col.style}"` : '';
      xml.push(`<col min="${i + 1}" max="${i + 1}" width="${width}"${style} customWidth="1"/>`);
    });
    xml.push('</cols>');
  }

  xml.push('<sheetData>');
  rows.forEach((row, r) => {
    const cells = (Array.isArray(row) ? row : [])
      .map((cell, c) => cellXml(`${columnLetter(c)}${r + 1}`, cell, columns[c]?.style))
      .join('');
    const height = Number(sheet.rowHeights?.[r]);
    const ht = height > 0 ? ` ht="${Math.min(409, height)}" customHeight="1"` : '';
    if (cells || ht) xml.push(`<row r="${r + 1}"${ht}>${cells}</row>`);
  });
  xml.push('</sheetData>');

  const merges = Array.isArray(sheet.merges) ? sheet.merges.filter(Boolean) : [];
  if (merges.length) {
    xml.push(`<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${escapeXml(m)}"/>`).join('')}</mergeCells>`);
  }

  const validations = Array.isArray(sheet.validations) ? sheet.validations.filter(v => v?.range) : [];
  if (validations.length) {
    xml.push(`<dataValidations count="${validations.length}">${validations.map(validationXml).join('')}</dataValidations>`);
  }

  xml.push('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>');
  xml.push('</worksheet>');
  return xml.join('');
}

/** Builds an .xlsx file from sheet definitions. Returns a Uint8Array. */
export function buildXlsxWorkbook(sheets) {
  const list = (Array.isArray(sheets) ? sheets : []).filter(Boolean);
  if (!list.length) throw new Error('A workbook needs at least one sheet.');

  const used = new Set();
  const names = list.map(s => safeSheetName(s.name, used));

  const contentTypes = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    ...list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`),
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    '</Types>'
  ].join('');

  const rootRels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
    '</Relationships>'
  ].join('');

  const workbook = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    '<bookViews><workbookView activeTab="0"/></bookViews>',
    '<sheets>',
    ...names.map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`),
    '</sheets>',
    '</workbook>'
  ].join('');

  const workbookRels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ...list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`),
    `<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
    '</Relationships>'
  ].join('');

  const files = [
    { path: '[Content_Types].xml', data: encoder.encode(contentTypes) },
    { path: '_rels/.rels', data: encoder.encode(rootRels) },
    { path: 'xl/workbook.xml', data: encoder.encode(workbook) },
    { path: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRels) },
    { path: 'xl/styles.xml', data: encoder.encode(STYLES_XML) },
    ...list.map((sheet, i) => ({ path: `xl/worksheets/sheet${i + 1}.xml`, data: encoder.encode(worksheetXml(sheet, i === 0)) }))
  ];
  return zipStore(files);
}

/** Browser-only: saves bytes as a file download. Returns false when downloads are unavailable. */
export function downloadFile(bytes, fileName, mimeType = XLSX_MIME_TYPE) {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') return false;
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Revoke after the click has been handled so the download is not cancelled.
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  return true;
}

/** Filesystem-safe file name stem, e.g. "Diploma of IT (2026)" -> "Diploma_of_IT_2026". */
export function safeFileStem(value, fallback = 'OzEdu') {
  const stem = String(value || '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '_')
    .slice(0, 60);
  return stem || fallback;
}
