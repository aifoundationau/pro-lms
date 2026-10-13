/**
 * Reads uploaded spreadsheets (.xlsx, .xlsm, .xls, .ods, .csv, .tsv, .txt) into plain text grids.
 *
 * - SheetJS (Apache-2.0, 0.20.x from the official SheetJS CDN — the npm registry copy is an
 *   older release with known CVEs) is loaded on demand so the main bundle stays small.
 * - Every cell becomes trimmed text. Date cells become ISO "YYYY-MM-DD" (timezone-safe),
 *   merged cells are filled with their value, and hyperlink targets are kept.
 * - Hard limits on file size, rows, columns and cell length keep the browser responsive.
 */

export const SPREADSHEET_FILE_ACCEPT = '.xlsx,.xlsm,.xls,.ods,.csv,.tsv,.txt';

export const SPREADSHEET_LIMITS = Object.freeze({
  maxFiles: 10,
  maxFileBytes: 10 * 1024 * 1024,
  maxSheets: 40,
  maxRows: 5000,
  maxCols: 60,
  maxCellChars: 20000
});

const WORKBOOK_EXTENSIONS = new Set(['xlsx', 'xlsm', 'xls', 'ods']);
const TEXT_EXTENSIONS = new Set(['csv', 'tsv', 'txt']);

export class SpreadsheetReadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SpreadsheetReadError';
    this.code = 'SPREADSHEET_READ_ERROR';
  }
}

let sheetJsPromise = null;

/** Lazy-loads SheetJS once; a failed chunk load can be retried. */
export function loadSheetJs() {
  if (!sheetJsPromise) {
    sheetJsPromise = import('xlsx').catch(err => {
      sheetJsPromise = null;
      console.warn('SheetJS failed to load:', err);
      throw new SpreadsheetReadError('The spreadsheet reader could not be loaded. Check your connection and try again.');
    });
  }
  return sheetJsPromise;
}

function extensionOf(name) {
  const match = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  return match ? match[1].toLowerCase() : '';
}

function stemOf(name) {
  return String(name || 'Sheet').replace(/\.[^.]+$/, '').trim() || 'Sheet';
}

function sniffFormat(bytes) {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'zip'; // xlsx/xlsm/ods
  if (bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return 'ole'; // legacy xls
  return 'text';
}

/**
 * Decodes CSV/TSV bytes. Excel "CSV UTF-8" adds a BOM, plain "CSV" on Windows is usually
 * Windows-1252, and "Unicode Text" is UTF-16LE.
 */
function decodeText(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if (!utf8.includes('�')) return utf8;
  try {
    return new TextDecoder('windows-1252').decode(bytes);
  } catch {
    return utf8;
  }
}

// Strips control characters (except tab/newline); intentional.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function cleanText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .trim();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Converts a SheetJS cell to display text. Dates use their serial, not the locale format. */
function cellToText(XLSX, cell) {
  if (!cell) return '';
  switch (cell.t) {
    case 'n': {
      if (typeof cell.z === 'string' && XLSX.SSF.is_date(cell.z)) {
        const parts = XLSX.SSF.parse_date_code(cell.v);
        if (parts && parts.y) return `${parts.y}-${pad2(parts.m)}-${pad2(parts.d)}`;
      }
      // Formatted text keeps "40%" and avoids float noise; scientific notation falls back to the value.
      if (typeof cell.w === 'string' && cell.w.trim() && !/e[+-]/i.test(cell.w)) return cell.w;
      return String(cell.v);
    }
    case 'd':
      return cell.v instanceof Date && !Number.isNaN(cell.v.getTime()) ? cell.v.toISOString().slice(0, 10) : String(cell.w || '');
    case 'b':
      return cell.v ? 'TRUE' : 'FALSE';
    case 'e':
    case 'z':
      return '';
    default:
      return cell.v === null || cell.v === undefined ? '' : String(cell.v);
  }
}

/**
 * Converts one SheetJS worksheet into { rows, links, truncatedCells }.
 * Row/column positions are absolute (row 0 = spreadsheet row 1) so warnings can cite real row numbers.
 */
export function worksheetToGrid(XLSX, worksheet, limits = SPREADSHEET_LIMITS) {
  const result = { rows: [], links: {}, truncatedCells: 0, clipped: false };
  const ref = worksheet?.['!ref'];
  if (!ref) return result;

  const range = XLSX.utils.decode_range(ref);
  const lastRow = Math.min(range.e.r, limits.maxRows - 1);
  const lastCol = Math.min(range.e.c, limits.maxCols - 1);
  // With `sheetRows`, SheetJS shortens !ref and keeps the real extent in !fullref.
  const full = typeof worksheet['!fullref'] === 'string' ? XLSX.utils.decode_range(worksheet['!fullref']) : range;
  result.clipped = full.e.r > lastRow || full.e.c > lastCol;
  const dense = Array.isArray(worksheet['!data']) ? worksheet['!data'] : null;

  for (let r = 0; r <= lastRow; r++) {
    const row = new Array(lastCol + 1).fill('');
    for (let c = 0; c <= lastCol; c++) {
      const cell = dense ? dense[r]?.[c] : worksheet[XLSX.utils.encode_cell({ r, c })];
      if (!cell) continue;
      let text = cleanText(cellToText(XLSX, cell));
      if (text.length > limits.maxCellChars) {
        text = text.slice(0, limits.maxCellChars);
        result.truncatedCells++;
      }
      row[c] = text;
      const target = typeof cell.l?.Target === 'string' ? cell.l.Target.trim() : '';
      if (/^https?:\/\//i.test(target)) result.links[`${r},${c}`] = target;
    }
    result.rows.push(row);
  }

  // Merged cells only store a value in their top-left cell; copy it across the merge.
  for (const merge of Array.isArray(worksheet['!merges']) ? worksheet['!merges'] : []) {
    const top = merge?.s;
    const bottom = merge?.e;
    if (!top || !bottom || top.r > lastRow || top.c > lastCol) continue;
    const value = result.rows[top.r]?.[top.c] || '';
    if (!value) continue;
    for (let r = top.r; r <= Math.min(bottom.r, lastRow); r++) {
      for (let c = top.c; c <= Math.min(bottom.c, lastCol); c++) {
        if (!result.rows[r][c]) result.rows[r][c] = value;
      }
    }
  }

  // Trim trailing blank rows and columns.
  while (result.rows.length && result.rows[result.rows.length - 1].every(v => !v)) result.rows.pop();
  let width = 0;
  for (const row of result.rows) {
    for (let c = row.length - 1; c >= width; c--) {
      if (row[c]) {
        width = c + 1;
        break;
      }
    }
  }
  result.rows = result.rows.map(row => row.slice(0, width));
  return result;
}

/**
 * Parses one file's bytes into sheets. Pure (no File API) so Node tests can call it.
 * @returns {{ sheets: Array<{name, fileName, rows: string[][], links: object}>, warnings: string[] }}
 */
export function readSpreadsheetBytes(XLSX, { name, bytes }, limits = SPREADSHEET_LIMITS) {
  const fileName = String(name || 'spreadsheet');
  const ext = extensionOf(fileName);
  const format = sniffFormat(bytes);
  const warnings = [];
  let workbook;

  if (format === 'text' && WORKBOOK_EXTENSIONS.has(ext)) {
    throw new SpreadsheetReadError(`"${fileName}" is not a valid ${ext.toUpperCase()} workbook. Re-save it from Excel or Google Sheets and try again.`);
  }
  if (format === 'text' && ext && !TEXT_EXTENSIONS.has(ext)) {
    throw new SpreadsheetReadError(`"${fileName}" is not a supported spreadsheet. Upload .xlsx, .xls, .ods or .csv files.`);
  }

  try {
    if (format === 'text') {
      const text = decodeText(bytes);
      if (text.includes('\u0000')) {
        throw new SpreadsheetReadError(`"${fileName}" does not look like a text (CSV) file.`);
      }
      // raw: keep every value as typed (no date/percent guessing on CSV text).
      workbook = XLSX.read(text, { type: 'string', raw: true, sheetRows: limits.maxRows });
    } else {
      workbook = XLSX.read(bytes, {
        type: 'array',
        cellNF: true,
        cellHTML: false,
        cellFormula: false,
        cellStyles: false,
        bookVBA: false,
        sheetRows: limits.maxRows
      });
    }
  } catch (err) {
    if (err instanceof SpreadsheetReadError) throw err;
    const reason = /password|encrypt/i.test(String(err?.message))
      ? 'is password-protected. Remove the password and upload it again.'
      : 'could not be read. It may be damaged or not a spreadsheet.';
    throw new SpreadsheetReadError(`"${fileName}" ${reason}`);
  }

  const sheets = [];
  const names = Array.isArray(workbook?.SheetNames) ? workbook.SheetNames : [];
  names.forEach((sheetName, index) => {
    if (workbook.Workbook?.Sheets?.[index]?.Hidden) return; // helper/hidden tabs are skipped
    const grid = worksheetToGrid(XLSX, workbook.Sheets[sheetName], limits);
    if (grid.truncatedCells) warnings.push(`"${fileName}" › ${sheetName}: ${grid.truncatedCells} very long cell(s) were shortened to ${limits.maxCellChars.toLocaleString()} characters.`);
    if (grid.clipped) warnings.push(`"${fileName}" › ${sheetName}: only the first ${limits.maxRows.toLocaleString()} rows and ${limits.maxCols} columns were read.`);
    if (!grid.rows.length) return;
    sheets.push({
      // A CSV has a single unnamed sheet; its file name ("Course Template - Units.csv") identifies it.
      name: format === 'text' ? stemOf(fileName) : String(sheetName),
      fileName,
      rows: grid.rows,
      links: grid.links
    });
  });

  return { sheets, warnings };
}

/**
 * Reads browser File objects (one or many) into sheets.
 * @returns {Promise<{ sheets: Array, warnings: string[], fileNames: string[] }>}
 */
export async function readSpreadsheetFiles(fileList, { limits = SPREADSHEET_LIMITS, XLSX: injectedXlsx } = {}) {
  const files = Array.from(fileList || []).filter(Boolean);
  if (!files.length) throw new SpreadsheetReadError('Choose at least one spreadsheet file.');
  if (files.length > limits.maxFiles) throw new SpreadsheetReadError(`Upload at most ${limits.maxFiles} files at a time.`);

  for (const file of files) {
    if (Number(file.size) > limits.maxFileBytes) {
      throw new SpreadsheetReadError(`"${file.name}" is larger than ${Math.round(limits.maxFileBytes / 1024 / 1024)} MB. Split it into smaller files or remove images.`);
    }
  }

  const XLSX = injectedXlsx || await loadSheetJs();
  const sheets = [];
  const warnings = [];
  for (const file of files) {
    let bytes;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      throw new SpreadsheetReadError(`"${file.name}" could not be opened. Close it in other programs and try again.`);
    }
    const result = readSpreadsheetBytes(XLSX, { name: file.name, bytes }, limits);
    sheets.push(...result.sheets);
    warnings.push(...result.warnings);
  }

  if (!sheets.length) throw new SpreadsheetReadError('The spreadsheet is empty — no cells with content were found.');
  if (sheets.length > limits.maxSheets) {
    warnings.push(`Only the first ${limits.maxSheets} sheets were read.`);
    sheets.length = limits.maxSheets;
  }
  return { sheets, warnings, fileNames: files.map(f => f.name) };
}
