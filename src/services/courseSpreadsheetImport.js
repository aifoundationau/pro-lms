/**
 * Course Spreadsheet Importer: turns uploaded sheets into a complete Course Builder course.
 *
 * - parseCourseSpreadsheet(sheets) -> a "draft" that keeps blanks blank (so ✨ AI Assist knows
 *   what to fill), plus row-level warnings, stats and any unrecognised content.
 * - finalizeCourseDraft(draft, baseCourse) -> a Course Builder course (ids, defaults, 'lms' tags).
 * - parseRubricSpreadsheet(sheets) -> rubric criteria for one assessment (unlimited rows).
 *
 * Layout-tolerant: header rows are detected anywhere (several tables may share one tab, e.g. a
 * CSV export), column names may vary, blank reference cells repeat the row above, and merged
 * cells are already filled by the reader. Pure module (no Firebase, no DOM).
 */

import {
  generateEntityId,
  createDefaultRubric,
  createBlankContentBlock,
  DEFAULT_RUBRIC_LEVEL_LABELS,
  MIN_RUBRIC_LEVELS,
  MAX_RUBRIC_LEVELS,
  LINK_BLOCK_METADATA_KEYS,
  isGoogleNotebookUrl,
  defaultLevelPoints,
  createQuizQuestion,
  QUIZ_LIMITS
} from '../types/courseBuilderTypes.js';
import { normalizeQuiz } from './quizModel.js';
import { sanitizeStandardIds } from './curriculumStandards.js';
import {
  SPREADSHEET_TEMPLATE_VERSION,
  SHEET,
  TABLES,
  RUBRIC_IGNORED_HEADERS,
  normalizeHeader,
  normalizeKey,
  detectHeaderRow,
  matchCourseFieldLabel,
  blockTypeLabel,
  parseBlockType,
  parseAssessmentType,
  parseIntegerInRange,
  parsePercentCell,
  parseDateCell,
  parseAqfLevel,
  parseStandards,
  isHttpUrl,
  extractUrls,
  splitListCell,
  QUESTION_TYPE_OPTIONS,
  parseQuestionType,
  parseOptionsCell,
  parseTrueFalse,
  splitAnswerList,
  parseCorrectOptions
} from './courseSpreadsheetSchema.js';

export const IMPORT_LIMITS = Object.freeze({
  units: 60,
  lessonsPerUnit: 80,
  blocksPerLesson: 40,
  assessments: 60,
  criteria: 100,
  outcomes: 60,
  text: 20000,
  title: 300,
  warnings: 200,
  unstructuredChars: 60000
});

// ---------- small helpers ----------

function text(value, max = IMPORT_LIMITS.text) {
  return String(value ?? '').trim().slice(0, max);
}

const DANGEROUS_SCHEME = /^\s*(javascript|data|vbscript|file):/i;

function createContext() {
  const warnings = [];
  let truncated = false;
  return {
    warnings,
    get truncated() {
      return truncated;
    },
    warn(sheet, row, message) {
      if (warnings.length >= IMPORT_LIMITS.warnings) {
        truncated = true;
        return;
      }
      warnings.push({ sheet: sheet || '', row: row || null, message });
    }
  };
}

/** "Lessons row 12: …" */
export function formatImportWarning(w) {
  if (!w) return '';
  const where = [w.sheet, w.row ? `row ${w.row}` : ''].filter(Boolean).join(' ');
  return where ? `${where}: ${w.message}` : w.message;
}

/** "3", "Unit 3", "U3", "Lesson 2", "Week 4", "AT1", "Task 2" -> number; otherwise null. */
function parseRefNumber(value) {
  const match = /^(?:unit|module|lesson|week|session|assessment|task|at|u|l|a)?\s*#?\s*(\d{1,4})$/i.exec(String(value ?? '').trim());
  return match ? Number(match[1]) : null;
}

function isInstructionsSheet(sheet) {
  const name = normalizeHeader(sheet?.name);
  if (/(^| )(instructions|readme|read me|how to use)$/.test(name)) return true;
  const firstCell = String(sheet?.rows?.[0]?.[0] || '');
  return firstCell.includes(SPREADSHEET_TEMPLATE_VERSION) || /^OzEdu Course Spreadsheet/i.test(firstCell);
}

function isCourseSheetName(name) {
  const n = normalizeHeader(name);
  return n === 'course' || / course$/.test(n) || /^course (details|info|information|overview)$/.test(n);
}

function firstFilledIndex(cells) {
  return cells.findIndex(c => String(c ?? '').trim() !== '');
}

function matchVerticalFieldRow(cells) {
  const i = firstFilledIndex(cells);
  if (i < 0) return null;
  const field = matchCourseFieldLabel(cells[i]);
  return field ? { field, valueIndex: i + 1 } : null;
}

function countVerticalFieldRows(rows) {
  let count = 0;
  for (const cells of rows) {
    const hit = matchVerticalFieldRow(cells);
    if (hit && String(cells[hit.valueIndex] ?? '').trim()) count++;
  }
  return count;
}

const TEMPLATE_NOISE = new Set(['field', 'value', 'help', 'help and examples', 'notes', 'example']);

function isTemplateNoiseRow(cells) {
  const filled = cells.map(normalizeHeader).filter(Boolean);
  return filled.length > 0 && filled.every(h => TEMPLATE_NOISE.has(h));
}

function cellAt(row, index) {
  return index === undefined || index === null ? '' : String(row.cells[index] ?? '').trim();
}

/** Link-aware cell value: a hyperlink's target wins when the visible text is not itself a URL. */
function linkCellAt(row, index) {
  const value = cellAt(row, index);
  if (index === undefined || index === null) return value;
  const target = row.links?.[index];
  return target && !isHttpUrl(value) ? target : value;
}

// ---------- link lists (Lessons tab: YouTube / Google Drive / Gemini Notebook columns) ----------

const LIST_BULLET = /^\s*(?:[-*•▪◦]|\(?\d{1,2}[.)])\s+/u;
const LINK_TITLE_TRAIL = /[\s|:,;–—([-]+$/u;
const LINK_TITLE_LEAD = /^[\s|:,;–—)\]-]+/u;

function cleanLinkTitle(value) {
  let title = String(value ?? '').replace(LIST_BULLET, '').replace(LINK_TITLE_LEAD, '').replace(LINK_TITLE_TRAIL, '').trim();
  const wrapped = /^\((.*)\)$/s.exec(title) || /^\[(.*)\]$/s.exec(title);
  if (wrapped) title = wrapped[1].trim();
  return /[\p{L}\p{N}]/u.test(title) ? title.slice(0, IMPORT_LIMITS.title) : '';
}

/**
 * A link-list cell -> { links: [{ title, url }], skipped: [text] }. Any number of links: one per
 * line (or several on a line), each with an optional title — "Title | link", "Title - link",
 * "Title: link", "link (Title)", or the title alone on the line above the link. A clickable
 * hyperlink is used when the cell text has no link of its own (e.g. a cell showing "Week 1 video").
 */
export function parseLinkCell(value, hyperlink = '') {
  const links = [];
  const skipped = [];
  let pendingTitle = '';
  const lines = String(value ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (const rawLine of lines) {
    // A whole-line link, or "Title | link", keeps the link exactly as typed (even "…_(film)" or a final ".").
    const lastToken = rawLine.split(/\s+/).pop();
    const before = rawLine.slice(0, rawLine.length - lastToken.length);
    if (isHttpUrl(lastToken) && !extractUrls(before).length) {
      links.push({ title: cleanLinkTitle(before) || cleanLinkTitle(pendingTitle), url: lastToken });
      pendingTitle = '';
      continue;
    }
    // "https://a,https://b" -> two links
    const line = rawLine.replace(/[,;](?=https?:\/\/)/gi, ' ');
    const urls = extractUrls(line).filter(isHttpUrl);
    if (!urls.length) {
      if (pendingTitle) skipped.push(pendingTitle);
      pendingTitle = rawLine;
      continue;
    }
    let cursor = 0;
    urls.forEach((url, i) => {
      const at = line.indexOf(url, cursor);
      let title = cleanLinkTitle(line.slice(cursor, at < 0 ? cursor : at));
      cursor = at < 0 ? cursor : at + url.length;
      if (i === urls.length - 1 && !title) title = cleanLinkTitle(line.slice(cursor));
      if (i === 0 && !title && pendingTitle) title = cleanLinkTitle(pendingTitle);
      links.push({ title, url });
    });
    pendingTitle = '';
  }
  const target = String(hyperlink ?? '').trim();
  if (isHttpUrl(target) && !links.some(link => link.url === target)) {
    if (!links.length) {
      // A cell showing "Week 1 video" that links to the video.
      links.push({ title: cleanLinkTitle(lines.join(' ')), url: target });
      pendingTitle = '';
      skipped.length = 0;
    } else if (pendingTitle) {
      links.push({ title: cleanLinkTitle(pendingTitle), url: target });
      pendingTitle = '';
    }
  }
  if (pendingTitle) skipped.push(pendingTitle);
  return { links, skipped };
}

/** The one-line form parseLinkCell reads back: "Title | link" (or just the link). */
export function formatLinkLine(title, url) {
  const t = String(title ?? '').trim();
  return t ? `${t} | ${url}` : String(url ?? '');
}

// ---------- draft factories ----------

function newUnitDraft(init = {}) {
  return {
    unitCode: '',
    unitTitle: '',
    nominalHours: null,
    description: '',
    learningOutcomes: [],
    order: null,
    lessons: [],
    _seq: 0,
    ...init
  };
}

function newLessonDraft(init = {}) {
  return { title: '', estimatedMinutes: null, number: null, blocks: [], _links: [], _seq: 0, ...init };
}

function newAssessmentDraft(init = {}) {
  return {
    title: '',
    type: '',
    description: '',
    dueDate: '',
    nominalWeight: null,
    externalSubmissionLinks: [],
    number: null,
    rubric: [],
    _seq: 0,
    ...init
  };
}

function emptyCourseFields() {
  return {
    title: '',
    code: '',
    aqfLevel: null,
    category: '',
    year: '',
    startDate: '',
    token_cost: null,
    description: '',
    knowledge: '',
    curriculumStandards: null,
    aqfEquivalenceNotes: '',
    thumbnail: '',
    learningOutcomes: []
  };
}

// ---------- scanning ----------

function rubricLevelColumns(headerCells, used) {
  const levels = [];
  const ignored = [];
  const empty = [];
  headerCells.forEach((raw, index) => {
    if (used.has(index)) return;
    const label = String(raw ?? '').trim();
    if (!label) {
      empty.push(index);
      return;
    }
    if (RUBRIC_IGNORED_HEADERS.has(normalizeHeader(label))) {
      ignored.push(label);
      return;
    }
    levels.push({ index, label: label.replace(/\s*descriptors?\s*$/i, '').trim() || label });
  });
  return { levels, ignored, empty };
}

function openSection(detected, cells, rowIndex, sheet, ctx) {
  const section = {
    table: detected.table,
    map: detected.match.map,
    sheet: sheet.name,
    headerRow: rowIndex + 1,
    dataRows: 0,
    last: {} // fill-down memory: unitRef / lessonRef / assessmentRef
  };
  if (detected.table === 'rubrics') {
    const { levels, ignored, empty } = rubricLevelColumns(cells, detected.match.used);
    section.levelColumns = levels;
    section.emptyColumns = empty;
    for (const label of ignored) ctx.warn(sheet.name, rowIndex + 1, `Column "${label}" is not a performance level and was ignored.`);
    if (levels.length > MAX_RUBRIC_LEVELS) {
      ctx.warn(sheet.name, rowIndex + 1, `Only the first ${MAX_RUBRIC_LEVELS} performance levels were used (${levels.length} found).`);
      section.levelColumns = levels.slice(0, MAX_RUBRIC_LEVELS);
    }
  }
  return section;
}

function scanSheet(sheet, state) {
  const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
  const verticalAllowed = isCourseSheetName(sheet.name) || countVerticalFieldRows(rows) >= 3;
  let section = null;
  const leftovers = [];
  const linksByRow = new Map();
  for (const [key, target] of Object.entries(sheet.links || {})) {
    const [lr, lc] = key.split(',').map(Number);
    if (!linksByRow.has(lr)) linksByRow.set(lr, {});
    linksByRow.get(lr)[lc] = target;
  }

  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].map(c => String(c ?? ''));
    if (!cells.some(c => c.trim())) continue;
    const links = linksByRow.get(r) || {};
    for (const c of cells) for (const url of extractUrls(c)) state.sourceUrls.add(url);
    for (const target of Object.values(links)) state.sourceUrls.add(target);

    if (!section && verticalAllowed) {
      const hit = matchVerticalFieldRow(cells);
      if (hit) {
        applyCourseField(state, hit.field.key, cells[hit.valueIndex], links[hit.valueIndex], { sheet: sheet.name, row: r + 1 });
        state.recognized.add(sheet.name);
        continue;
      }
      if (isTemplateNoiseRow(cells)) continue;
    }

    const detected = detectHeaderRow(cells, { strict: Boolean(section) });
    if (detected) {
      section = openSection(detected, cells, r, sheet, state.ctx);
      state.recognized.add(sheet.name);
      continue;
    }

    if (section) {
      if (section.table === 'courseRow' && section.dataRows >= 1) {
        leftovers.push(cells);
        continue;
      }
      section.dataRows++;
      state.rows[section.table].push({ sheet: sheet.name, row: r + 1, cells, links, section });
      continue;
    }
    leftovers.push(cells);
  }

  if (leftovers.length) state.unstructured.push({ sheet: sheet.name, rows: leftovers });
}

// ---------- course fields ----------

function applyCourseField(state, key, rawValue, linkTarget, where) {
  const { course, ctx } = state;
  const value = String(rawValue ?? '').trim();
  if (!value) return;
  const label = (TABLES.courseRow.columns.find(c => c.key === key) || {}).header || key;
  const alreadySet = (v) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

  const assign = (field, next) => {
    if (alreadySet(course[field]) && JSON.stringify(course[field]) !== JSON.stringify(next)) {
      ctx.warn(where.sheet, where.row, `${label} was given more than once — the first value was kept.`);
      return;
    }
    course[field] = next;
  };

  switch (key) {
    case 'title':
    case 'code':
      assign(key, text(value, IMPORT_LIMITS.title));
      break;
    case 'category':
    case 'year':
      assign(key, text(value, 200));
      break;
    case 'description':
    case 'knowledge':
    case 'aqfEquivalenceNotes':
      assign(key, text(value));
      break;
    case 'aqfLevel': {
      const parsed = parseAqfLevel(value);
      if (parsed.error) ctx.warn(where.sheet, where.row, `${parsed.error}.`);
      else if (parsed.value !== null) assign('aqfLevel', parsed.value);
      break;
    }
    case 'startDate': {
      const iso = parseDateCell(value);
      if (iso === undefined) ctx.warn(where.sheet, where.row, `Start Date "${value}" was not understood — use YYYY-MM-DD.`);
      else if (iso) assign('startDate', iso);
      break;
    }
    case 'token_cost': {
      const parsed = /^free$/i.test(value) ? { value: 0 } : parseIntegerInRange(value, 0, 1000000, 'Enrolment cost');
      if (parsed.error) ctx.warn(where.sheet, where.row, `${parsed.error}.`);
      else if (parsed.value !== null) assign('token_cost', parsed.value);
      break;
    }
    case 'curriculumStandards': {
      const { ids, unknown } = parseStandards(value);
      if (unknown.length) ctx.warn(where.sheet, where.row, `Unknown curriculum standard(s): ${unknown.join(', ')}.`);
      if (ids) assign('curriculumStandards', ids);
      break;
    }
    case 'thumbnail': {
      const url = linkTarget && !isHttpUrl(value) ? linkTarget : value;
      if (isHttpUrl(url)) assign('thumbnail', url);
      else ctx.warn(where.sheet, where.row, 'Cover Image URL must be an https:// link — it was skipped.');
      break;
    }
    case 'learningOutcomes':
      for (const item of splitListCell(value)) course.learningOutcomes.push(text(item, 2000));
      break;
    default:
      break;
  }
}

// ---------- unit / lesson / assessment resolution ----------

function indexUnit(state, unit) {
  if (unit.unitCode) state.unitByCode.set(normalizeKey(unit.unitCode), unit);
  if (unit.unitTitle) state.unitByTitle.set(normalizeKey(unit.unitTitle), unit);
}

function unitAtNumber(state, number) {
  return state.units.find(u => u.order === number) || (state.units.every(u => u.order === null) ? state.units[number - 1] : null) || null;
}

function resolveUnit(state, raw, where) {
  const ref = String(raw ?? '').trim();
  const key = normalizeKey(ref);
  if (!key) return null;
  const direct = state.unitByCode.get(key) || state.unitByTitle.get(key);
  if (direct) return direct;
  const number = parseRefNumber(ref);
  if (number !== null) {
    const byNumber = unitAtNumber(state, number);
    if (byNumber) return byNumber;
  }
  if (state.units.length >= IMPORT_LIMITS.units) {
    state.ctx.warn(where.sheet, where.row, `Unit "${ref}" could not be created (limit of ${IMPORT_LIMITS.units} units).`);
    return null;
  }
  const unit = newUnitDraft(number !== null ? { order: number } : { unitCode: text(ref, 100) });
  unit._seq = state.seq++;
  state.units.push(unit);
  indexUnit(state, unit);
  state.ctx.warn(where.sheet, where.row, `Unit "${ref}" is not on the Units tab — it was added.`);
  return unit;
}

/** Unit for a child row: its own reference, else the row above (fill-down), else the only unit. */
function unitForRow(state, row) {
  const { section } = row;
  const where = { sheet: row.sheet, row: row.row };
  if (section.map.unitRef !== undefined) {
    const ref = cellAt(row, section.map.unitRef);
    if (ref) {
      // Lesson/assessment fill-down only carries over while the unit stays the same.
      if (normalizeKey(ref) !== normalizeKey(section.last.unitRef)) {
        section.last.lessonRef = undefined;
        section.last.assessmentRef = undefined;
      }
      section.last.unitRef = ref;
      return resolveUnit(state, ref, where);
    }
    if (section.last.unitRef) return resolveUnit(state, section.last.unitRef, where);
  }
  if (state.units.length === 0) {
    const unit = newUnitDraft({ order: 1 });
    unit._seq = state.seq++;
    state.units.push(unit);
    return unit;
  }
  if (state.units.length > 1 && !section.warnedNoUnit) {
    section.warnedNoUnit = true;
    state.ctx.warn(row.sheet, row.row, 'No Unit Code given — rows were added to the first unit.');
  }
  return state.units[0];
}

function lessonAt(unit, ref) {
  const number = parseRefNumber(ref);
  if (number !== null) {
    const hit = unit.lessons.find(l => l.number === number);
    if (hit) return hit;
  }
  const key = normalizeKey(ref);
  return unit.lessons.find(l => key && normalizeKey(l.title) === key) || null;
}

/** Explicit numbers are kept; unnumbered items get the next free number in row order. */
function numberItems(items) {
  let next = items.reduce((max, item) => Math.max(max, item.number || 0), 0);
  for (const item of items.slice().sort((a, b) => a._seq - b._seq)) {
    if (item.number === null) item.number = ++next;
  }
  items.sort((a, b) => a.number - b.number || a._seq - b._seq);
}

// ---------- rubric helpers ----------

const TRAILING_WEIGHT = /^(.*?)[\s\-–—:,(]*(\d{1,3}(?:\.\d+)?)\s*%\s*\)?\s*$/;

/** "Research quality (30%)" -> { title: 'Research quality', weight: 30 } */
export function splitCriterionWeight(value) {
  const s = String(value ?? '').trim();
  const match = TRAILING_WEIGHT.exec(s);
  if (match && match[1].trim()) return { title: match[1].trim(), weight: Number(match[2]) };
  return { title: s, weight: null };
}

/** Quick-entry rubric text: "Clarity (30%), Analysis (40%), Recommendations (30%)". */
function parseRubricSummary(value) {
  const parts = String(value ?? '').split(/[;\n]+|,(?=[^,]*\d\s*%)/).map(p => p.trim()).filter(Boolean);
  const criteria = parts.map(splitCriterionWeight).filter(c => c.title);
  if (criteria.filter(c => c.weight !== null).length < 2) return null;
  return criteria.map(c => ({
    criterionTitle: text(c.title, IMPORT_LIMITS.title),
    weightPercentage: c.weight,
    levels: []
  }));
}

/** Criteria drafts from rubric rows sharing one level header. */
function criteriaFromRows(rows, ctx) {
  if (!rows.length) return { criteria: [], labels: [] };
  const section = rows[0].section;
  const hasWeightColumn = section.map.weight !== undefined;

  // Columns without a heading still count as levels when they hold descriptors.
  const extraColumns = (section.emptyColumns || []).filter(index => rows.some(row => cellAt(row, index)));
  const levelColumns = [
    ...section.levelColumns,
    ...extraColumns.map(index => ({ index, label: '' }))
  ].sort((a, b) => a.index - b.index).slice(0, MAX_RUBRIC_LEVELS);
  if (extraColumns.length) ctx.warn(rows[0].sheet, section.headerRow, 'Some descriptor columns have no level heading — they were named "Level N".');

  const criteria = [];
  for (const row of rows) {
    const rawTitle = cellAt(row, section.map.criterion);
    const descriptors = levelColumns.map(col => text(cellAt(row, col.index), 4000));
    const weightCell = hasWeightColumn ? cellAt(row, section.map.weight) : '';
    if (!rawTitle && !weightCell && descriptors.every(d => !d)) continue;

    let title = rawTitle;
    let weight = null;
    if (hasWeightColumn) {
      const parsed = parsePercentCell(weightCell);
      if (Number.isNaN(parsed)) ctx.warn(row.sheet, row.row, `Weight "${weightCell}" is not a number — it was left blank.`);
      else weight = parsed;
    } else {
      const split = splitCriterionWeight(rawTitle);
      title = split.title;
      weight = split.weight;
    }
    if (!title) {
      title = `Criterion ${criteria.length + 1}`;
      ctx.warn(row.sheet, row.row, `A rubric row has descriptors but no criterion name — it was called "${title}".`);
    }
    criteria.push({ criterionTitle: text(title, IMPORT_LIMITS.title), weightPercentage: weight, descriptors, _row: row });
    if (criteria.length >= IMPORT_LIMITS.criteria) {
      ctx.warn(row.sheet, row.row, `Only the first ${IMPORT_LIMITS.criteria} criteria of a rubric were imported.`);
      break;
    }
  }

  // Excel "General" cells hold fractions (0.4) when typed without %.
  const weights = criteria.map(c => c.weightPercentage).filter(w => w !== null);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length && weights.every(w => w <= 1) && Math.abs(sum - 1) <= 0.011) {
    for (const c of criteria) if (c.weightPercentage !== null) c.weightPercentage = Math.round(c.weightPercentage * 10000) / 100;
  }
  for (const c of criteria) {
    if (c.weightPercentage !== null && (c.weightPercentage < 0 || c.weightPercentage > 100)) {
      ctx.warn(c._row.sheet, c._row.row, `Weight ${c.weightPercentage} is outside 0–100 — it was left blank.`);
      c.weightPercentage = null;
    }
  }

  // Drop trailing level columns that no criterion uses (e.g. a 5th column left empty).
  let used = 0;
  for (const c of criteria) {
    c.descriptors.forEach((d, i) => {
      if (d) used = Math.max(used, i + 1);
    });
  }
  let levelCount = levelColumns.length;
  if (used > 0 && used < levelCount) levelCount = Math.max(MIN_RUBRIC_LEVELS, used);
  const labels = levelColumns.slice(0, levelCount).map((col, i) => col.label || `Level ${i + 1}`);

  return {
    labels,
    criteria: criteria.map(c => ({
      criterionTitle: c.criterionTitle,
      weightPercentage: c.weightPercentage,
      levels: labels.map((label, i) => ({ label, descriptor: c.descriptors[i] || '' }))
    }))
  };
}

// ---------- table processors ----------

function processCourseRows(state) {
  for (const row of state.rows.courseRow) {
    for (const [key, index] of Object.entries(row.section.map)) {
      applyCourseField(state, key, row.cells[index], row.links[index], { sheet: row.sheet, row: row.row });
    }
  }
}

function processOutcomes(state) {
  const items = [];
  for (const row of state.rows.outcomes) {
    const value = cellAt(row, row.section.map.text);
    if (!value) continue;
    const order = parseIntegerInRange(cellAt(row, row.section.map.order), 0, 100000, 'Outcome #').value ?? null;
    for (const item of splitListCell(value)) items.push({ text: text(item, 2000), order, seq: items.length });
  }
  items.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.seq - b.seq);
  const merged = [...items.map(i => i.text), ...state.course.learningOutcomes];
  const seen = new Set();
  state.course.learningOutcomes = merged.filter(o => {
    const key = normalizeKey(o);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, IMPORT_LIMITS.outcomes);
}

function processUnits(state) {
  const { ctx } = state;
  for (const row of state.rows.units) {
    const map = row.section.map;
    const code = text(cellAt(row, map.unitCode), 100);
    const title = text(cellAt(row, map.unitTitle), IMPORT_LIMITS.title);
    const description = text(cellAt(row, map.description));
    const outcomes = splitListCell(cellAt(row, map.learningOutcomes)).map(o => text(o, 2000));
    const hoursCell = cellAt(row, map.nominalHours);
    if (!code && !title && !description && !outcomes.length && !hoursCell) continue;

    if (code && state.unitByCode.has(normalizeKey(code))) {
      ctx.warn(row.sheet, row.row, `Unit Code "${code}" is used more than once — this row was skipped.`);
      continue;
    }
    if (state.units.length >= IMPORT_LIMITS.units) {
      ctx.warn(row.sheet, row.row, `Only the first ${IMPORT_LIMITS.units} units were imported.`);
      break;
    }
    if (!code && !title) ctx.warn(row.sheet, row.row, 'This unit has no Unit Code or Unit Title — other tabs cannot link to it.');

    const hours = parseIntegerInRange(hoursCell, 1, 2000, 'Nominal Hours');
    if (hours.error) ctx.warn(row.sheet, row.row, `${hours.error}.`);
    const order = parseIntegerInRange(cellAt(row, map.order), 0, 100000, 'Unit #');

    const unit = newUnitDraft({
      unitCode: code,
      unitTitle: title,
      nominalHours: hours.value ?? null,
      description,
      learningOutcomes: outcomes,
      order: order.value ?? null
    });
    unit._seq = state.seq++;
    state.units.push(unit);
    indexUnit(state, unit);
  }
  state.units.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a._seq - b._seq);
}

/** Lessons-tab link columns (YouTube Video / Google Drive Resource / Gemini Notebook Links). */
const LESSON_LINK_COLUMNS = TABLES.lessons.columns.filter(column => column.linkType);
const LINK_TYPE_RANK = new Map(LESSON_LINK_COLUMNS.map((column, i) => [column.linkType, i]));

function lessonLinkCells(row) {
  const cells = [];
  for (const column of LESSON_LINK_COLUMNS) {
    const index = row.section.map[column.key];
    if (index === undefined) continue;
    const value = cellAt(row, index);
    const hyperlink = row.links?.[index] || '';
    if (value || hyperlink) cells.push({ column, value, hyperlink });
  }
  return cells;
}

/** Every link in a lesson row becomes its own block (added after the lesson's Content Blocks rows). */
function addLessonLinks(state, row, lesson, linkCells) {
  for (const { column, value, hyperlink } of linkCells) {
    const { links, skipped } = parseLinkCell(value, hyperlink);
    for (const entry of skipped) {
      state.ctx.warn(row.sheet, row.row, `"${entry.slice(0, 60)}" in ${column.header} has no https:// link — it was skipped.`);
    }
    for (const link of links) {
      const content = checkBlockLink(state, row, column.linkType, link.url);
      if (!content) continue;
      lesson._links.push({
        type: column.linkType,
        title: link.title,
        content,
        fileName: '',
        order: null,
        _seq: state.seq++,
        _rank: LINK_TYPE_RANK.get(column.linkType) ?? 0,
        _where: [row.sheet, row.row]
      });
    }
  }
}

function processLessons(state) {
  const { ctx } = state;
  for (const row of state.rows.lessons) {
    const map = row.section.map;
    const unit = unitForRow(state, row);
    if (!unit) continue;
    const numberCell = cellAt(row, map.lessonNo);
    let title = text(cellAt(row, map.title), IMPORT_LIMITS.title);
    const minutesCell = cellAt(row, map.estimatedMinutes);
    const linkCells = lessonLinkCells(row);
    if (!numberCell && !title && !minutesCell) {
      if (!linkCells.length) continue;
      // A row with only links adds them to the lesson above.
      const previous = row.section.lastLesson;
      if (previous && previous.unit === unit) {
        addLessonLinks(state, row, previous.lesson, linkCells);
        continue;
      }
    }

    let number = parseRefNumber(numberCell);
    if (numberCell && number === null) {
      if (!title) title = text(numberCell, IMPORT_LIMITS.title); // "Week 1: Ocean currents" in the number column
      else ctx.warn(row.sheet, row.row, `Lesson # "${numberCell}" is not a number — the lesson was numbered automatically.`);
    }
    const minutes = parseIntegerInRange(minutesCell, 1, 1440, 'Duration');
    const existing = number !== null ? unit.lessons.find(l => l.number === number) : null;
    if (existing) {
      // The same Lesson # repeated just to list more links: add them to that lesson.
      const sameTitle = !title || normalizeKey(title) === normalizeKey(existing.title);
      const sameMinutes = !minutesCell || minutes.value === existing.estimatedMinutes;
      if (linkCells.length && sameTitle && sameMinutes) {
        addLessonLinks(state, row, existing, linkCells);
        row.section.lastLesson = { unit, lesson: existing };
        continue;
      }
      ctx.warn(row.sheet, row.row, `Lesson ${number} appears twice in unit ${unit.unitCode || unit.unitTitle || ''} — this row was skipped.`);
      row.section.lastLesson = null;
      continue;
    }
    if (unit.lessons.length >= IMPORT_LIMITS.lessonsPerUnit) {
      ctx.warn(row.sheet, row.row, `Only ${IMPORT_LIMITS.lessonsPerUnit} lessons per unit are supported.`);
      row.section.lastLesson = null;
      continue;
    }
    if (minutes.error) ctx.warn(row.sheet, row.row, `${minutes.error}.`);
    const lesson = newLessonDraft({ title, estimatedMinutes: minutes.value ?? null, number });
    lesson._seq = state.seq++;
    unit.lessons.push(lesson);
    row.section.lastLesson = { unit, lesson };
    addLessonLinks(state, row, lesson, linkCells);
  }
  for (const unit of state.units) numberItems(unit.lessons);
}

/** Lessons-tab links follow the lesson's Content Blocks: videos, then Drive resources, then notebooks. */
function appendLessonLinks(state) {
  for (const unit of state.units) {
    for (const lesson of unit.lessons) {
      const links = (lesson._links || []).slice().sort((a, b) => a._rank - b._rank || a._seq - b._seq);
      lesson._links = [];
      if (!links.length) continue;
      const room = Math.max(0, IMPORT_LIMITS.blocksPerLesson - lesson.blocks.length);
      if (links.length > room) {
        const [sheet, rowNumber] = links[room]._where;
        state.ctx.warn(sheet, rowNumber, `Only ${IMPORT_LIMITS.blocksPerLesson} blocks per lesson are supported — ${links.length - room} link(s) were not added.`);
      }
      lesson.blocks.push(...links.slice(0, room));
    }
  }
}

function lessonForRow(state, unit, row) {
  const { section } = row;
  let ref = section.map.lessonRef !== undefined ? cellAt(row, section.map.lessonRef) : '';
  if (ref) section.last.lessonRef = ref;
  else if (section.last.lessonRef) ref = section.last.lessonRef;

  if (!ref) {
    if (unit.lessons.length === 0) {
      const lesson = newLessonDraft({ number: 1 });
      lesson._seq = state.seq++;
      unit.lessons.push(lesson);
      return lesson;
    }
    if (unit.lessons.length > 1 && !section.warnedNoLesson) {
      section.warnedNoLesson = true;
      state.ctx.warn(row.sheet, row.row, 'No Lesson # given — blocks were added to the first lesson of the unit.');
    }
    return unit.lessons[0];
  }

  const existing = lessonAt(unit, ref);
  if (existing) return existing;
  if (unit.lessons.length >= IMPORT_LIMITS.lessonsPerUnit) return null;
  const number = parseRefNumber(ref);
  const lesson = newLessonDraft(number !== null
    ? { number }
    : { title: text(ref, IMPORT_LIMITS.title), number: unit.lessons.reduce((m, l) => Math.max(m, l.number || 0), 0) + 1 });
  lesson._seq = state.seq++;
  unit.lessons.push(lesson);
  unit.lessons.sort((a, b) => a.number - b.number || a._seq - b._seq);
  state.ctx.warn(row.sheet, row.row, `Lesson "${ref}" is not on the Lessons tab — it was added.`);
  return lesson;
}

const YOUTUBE_HOST = /(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)youtube-nocookie\.com$/;
const GOOGLE_DRIVE_HOST = /(^|\.)(drive|docs)\.google\.com$/;

/** Block type for a link given without a Block Type: YouTube, Gemini Notebook, else a resource link. */
function linkTypeForUrl(url) {
  if (!isHttpUrl(url)) return null;
  const host = new URL(url).hostname.toLowerCase();
  if (YOUTUBE_HOST.test(host)) return 'youtube_video';
  if (isGoogleNotebookUrl(url)) return 'notebook_link';
  return 'google_drive_link';
}

function checkBlockLink(state, row, type, content) {
  const where = [row.sheet, row.row];
  if (!content) return content;
  if (DANGEROUS_SCHEME.test(content)) {
    state.ctx.warn(...where, 'A link using an unsafe scheme (javascript:, data:, …) was removed.');
    return '';
  }
  if (!LINK_BLOCK_METADATA_KEYS[type]) return content;
  if (!isHttpUrl(content)) {
    state.ctx.warn(...where, `This ${blockTypeLabel(type)} block needs an https:// link.`);
    return content;
  }
  const host = new URL(content).hostname.toLowerCase();
  if (type === 'youtube_video' && !YOUTUBE_HOST.test(host)) {
    state.ctx.warn(...where, 'This link does not look like a YouTube video.');
  } else if (type === 'google_drive_link' && !GOOGLE_DRIVE_HOST.test(host)) {
    state.ctx.warn(...where, 'This link does not look like a Google Drive / Docs link.');
  } else if (type === 'notebook_link' && !isGoogleNotebookUrl(content)) {
    state.ctx.warn(...where, 'This does not look like a Gemini Notebook link (for example https://notebooklm.google.com/notebook/…).');
  } else if (type === 'file_upload') {
    state.ctx.warn(...where, 'Direct file attachments are coming soon — the link was kept, but consider a Google Drive Resource block.');
  }
  return content;
}

function processBlocks(state) {
  const { ctx } = state;
  const pending = new Set();
  for (const row of state.rows.blocks) {
    const map = row.section.map;
    const typeCell = cellAt(row, map.type);
    const title = text(cellAt(row, map.title), IMPORT_LIMITS.title);
    const rawContent = cellAt(row, map.content);
    const linkCell = cellAt(row, map.linkUrl);
    const linkTarget = map.linkUrl !== undefined ? row.links?.[map.linkUrl] || '' : '';
    const fileName = text(cellAt(row, map.fileName), 200);
    if (!typeCell && !title && !rawContent && !linkCell && !linkTarget && !fileName) continue;

    const unit = unitForRow(state, row);
    if (!unit) continue;
    const lesson = lessonForRow(state, unit, row);
    if (!lesson) continue;
    const order = parseIntegerInRange(cellAt(row, map.order), 0, 100000, 'Block #').value ?? null;
    const add = (block) => {
      if (lesson.blocks.length >= IMPORT_LIMITS.blocksPerLesson) {
        ctx.warn(row.sheet, row.row, `Only ${IMPORT_LIMITS.blocksPerLesson} blocks per lesson are supported.`);
        return false;
      }
      lesson.blocks.push({ ...block, order, _seq: state.seq++ });
      pending.add(lesson);
      return true;
    };

    const parsedType = parseBlockType(typeCell);
    if (typeCell && !parsedType.recognized) ctx.warn(row.sheet, row.row, `Block Type "${typeCell}" was not recognised — used Content Description.`);
    // Links go in the Link URL column; older templates typed them in the Text column.
    const hasLinkColumn = Boolean(linkCell || linkTarget);
    const linkSource = hasLinkColumn
      ? parseLinkCell(linkCell, linkTarget)
      : parseLinkCell(rawContent, map.content !== undefined ? row.links?.[map.content] || '' : '');
    let type = parsedType.type;
    if (!typeCell) {
      // No Block Type: a link decides it (YouTube Video, Gemini Notebook or Google Drive Resource).
      const candidate = hasLinkColumn ? linkSource.links[0]?.url : (isHttpUrl(linkCellAt(row, map.content)) ? linkCellAt(row, map.content) : '');
      type = linkTypeForUrl(candidate) || type;
    }

    if (type === 'quiz') {
      add({ type, title, content: text(rawContent, 5000), fileName: '', quiz: { questions: [] } });
      continue;
    }

    if (!LINK_BLOCK_METADATA_KEYS[type]) {
      // Content Description / Teacher Guide. A Link URL on a text row is kept at the end of the text.
      let content = text(rawContent);
      if (hasLinkColumn) {
        content = text([content, text(linkCellAt(row, map.linkUrl))].filter(Boolean).join('\n'));
        ctx.warn(row.sheet, row.row, `${blockTypeLabel(type)} blocks do not use Link URL — the link was added to the text. Use a YouTube Video, Google Drive Resource or Gemini Notebook row to show it as a link.`);
      }
      add({ type, title, content: checkBlockLink(state, row, type, content), fileName });
      continue;
    }

    // Link blocks: one block per link (a Link URL cell may list several, one per line).
    const besideText = hasLinkColumn && !linkSource.links.some(link => link.url === text(rawContent)) ? text(rawContent) : '';
    if (besideText) {
      ctx.warn(row.sheet, row.row, `The Text of this ${blockTypeLabel(type)} row was added as a Content Description block above it (link blocks show a title and a link).`);
      if (!add({ type: 'text_description', title, content: checkBlockLink(state, row, 'text_description', besideText), fileName: '' })) continue;
    }
    if (!linkSource.links.length) {
      // Missing or invalid link: keep what was typed so it can be fixed in Course Builder.
      const typed = hasLinkColumn ? linkCellAt(row, map.linkUrl) : linkCellAt(row, map.content);
      add({ type, title, content: checkBlockLink(state, row, type, text(typed)), fileName });
      continue;
    }
    for (const entry of linkSource.skipped) {
      ctx.warn(row.sheet, row.row, `"${entry.slice(0, 60)}" has no https:// link — it was skipped.`);
    }
    const single = linkSource.links.length === 1;
    for (const [i, link] of linkSource.links.entries()) {
      const content = checkBlockLink(state, row, type, link.url);
      if (!content) continue;
      const blockTitle = single ? (title || link.title) : (link.title || title);
      if (!add({ type, title: blockTitle, content, fileName: i === 0 ? fileName : '' })) break;
    }
  }
  for (const lesson of pending) {
    lesson.blocks.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a._seq - b._seq);
  }
}

/** An existing unit for a reference (code, title or number); never creates one. */
function findUnit(state, raw) {
  const ref = String(raw ?? '').trim();
  const key = normalizeKey(ref);
  if (!key) return null;
  const direct = state.unitByCode.get(key) || state.unitByTitle.get(key);
  if (direct) return direct;
  const number = parseRefNumber(ref);
  return number !== null ? unitAtNumber(state, number) : null;
}

/**
 * The (optional) unit an Assessments / Rubrics row refers to. Older layouts start with a Unit Code
 * that fills down and restart numbering in every unit ("scoped"); the template's Covers Unit column
 * does not fill down and a blank cell means the whole course.
 * @returns {{ unit: object|null, scoped: boolean }}
 */
function assessmentUnitForRow(state, row) {
  const { section } = row;
  const map = section.map;
  if (!section.warnedUnits) section.warnedUnits = new Set();
  const warnUnknown = (ref) => {
    const key = normalizeKey(ref);
    if (section.warnedUnits.has(key)) return;
    section.warnedUnits.add(key);
    state.ctx.warn(row.sheet, row.row, `Unit "${ref}" is not on the Units tab — the assessment covers the whole course.`);
  };
  if (map.unitRef !== undefined) {
    let ref = cellAt(row, map.unitRef);
    if (ref) {
      if (normalizeKey(ref) !== normalizeKey(section.last.unitRef)) section.last.assessmentRef = undefined;
      section.last.unitRef = ref;
    } else {
      ref = section.last.unitRef || '';
    }
    const unit = ref ? findUnit(state, ref) : null;
    if (ref && !unit) warnUnknown(ref);
    return { unit, scoped: true };
  }
  if (map.coversUnit !== undefined) {
    const ref = cellAt(row, map.coversUnit);
    const unit = ref ? findUnit(state, ref) : null;
    if (ref && !unit) warnUnknown(ref);
    return { unit, scoped: false };
  }
  return { unit: null, scoped: false };
}

function findAssessment(list, ref) {
  const number = parseRefNumber(ref);
  if (number !== null) {
    const hit = list.find(a => a.number === number);
    if (hit) return hit;
  }
  const key = normalizeKey(ref);
  return list.find(a => key && normalizeKey(a.title) === key) || null;
}

/** Course-level assessments (one Assessments & Rubrics list per course). */
function processAssessments(state) {
  const { ctx } = state;
  for (const row of state.rows.assessments) {
    const map = row.section.map;
    const numberCell = cellAt(row, map.assessmentNo);
    let title = text(cellAt(row, map.title), IMPORT_LIMITS.title);
    const typeCell = cellAt(row, map.type);
    const description = text(cellAt(row, map.description));
    const details = text(cellAt(row, map.details));
    const weightCell = cellAt(row, map.nominalWeight);
    const dueCell = cellAt(row, map.dueDate);
    const linkCell = linkCellAt(row, map.submissionLink);
    const rubricCell = cellAt(row, map.rubricSummary);
    if (!numberCell && !title && !typeCell && !description && !details && !weightCell && !dueCell && !linkCell && !rubricCell) continue;

    const { unit, scoped } = assessmentUnitForRow(state, row);
    const scope = scoped ? unit : null;
    let number = parseRefNumber(numberCell);
    if (numberCell && number === null && !title) title = text(numberCell, IMPORT_LIMITS.title);
    if (number !== null && state.assessments.some(a => a._scope === scope && a.number === number)) {
      const where = scope ? ` in unit ${scope.unitCode || scope.unitTitle || ''}` : '';
      ctx.warn(row.sheet, row.row, `Assessment ${number} appears twice${where} — this row was skipped.`);
      continue;
    }
    if (state.assessments.length >= IMPORT_LIMITS.assessments) {
      ctx.warn(row.sheet, row.row, `Only ${IMPORT_LIMITS.assessments} assessments per course are supported.`);
      continue;
    }

    const type = parseAssessmentType(typeCell);
    if (typeCell && !type) ctx.warn(row.sheet, row.row, `Type "${typeCell}" should be Formative or Summative.`);

    let weight = parsePercentCell(weightCell);
    if (Number.isNaN(weight)) {
      ctx.warn(row.sheet, row.row, `Weighting "${weightCell}" is not a number.`);
      weight = null;
    } else if (weight !== null && weight > 0 && weight < 1 && !weightCell.includes('%')) {
      weight = Math.round(weight * 10000) / 100; // 0.4 -> 40
    }
    if (weight !== null && (weight < 0 || weight > 100)) {
      ctx.warn(row.sheet, row.row, `Weighting ${weight} must be between 0 and 100.`);
      weight = null;
    }

    const dueDate = parseDateCell(dueCell);
    if (dueDate === undefined) ctx.warn(row.sheet, row.row, `Due Date "${dueCell}" was not understood — use YYYY-MM-DD.`);

    const links = [];
    for (const candidate of linkCell.split(/[\s,]+/).filter(Boolean)) {
      if (isHttpUrl(candidate)) links.push(candidate);
      else ctx.warn(row.sheet, row.row, `Submission link "${candidate.slice(0, 60)}" must start with https:// — it was skipped.`);
    }

    let fullDescription = description;
    if (details) fullDescription = [fullDescription, details].filter(Boolean).join('\n\n');
    let rubric = [];
    if (rubricCell) {
      const parsed = parseRubricSummary(rubricCell);
      if (parsed) rubric = parsed;
      else fullDescription = [fullDescription, `Marking criteria: ${rubricCell}`].filter(Boolean).join('\n\n');
    }

    const assessment = newAssessmentDraft({
      title,
      type,
      description: text(fullDescription),
      dueDate: dueDate || '',
      nominalWeight: weight,
      externalSubmissionLinks: links,
      number,
      rubric
    });
    assessment._seq = state.seq++;
    assessment._scope = scope;
    assessment._unit = unit;
    state.assessments.push(assessment);
  }
  // Unnumbered tasks take the next free number in their scope; row order is kept.
  for (const scope of new Set(state.assessments.map(a => a._scope))) {
    const items = state.assessments.filter(a => a._scope === scope);
    let next = items.reduce((max, a) => Math.max(max, a.number || 0), 0);
    for (const a of items) {
      if (a.number === null) a.number = ++next;
    }
  }
}

/** The course assessment a Rubrics row belongs to (older layouts match within the row's unit first). */
function assessmentForRow(state, row) {
  const { section } = row;
  const { unit, scoped } = assessmentUnitForRow(state, row);
  let ref = section.map.assessmentRef !== undefined ? cellAt(row, section.map.assessmentRef) : '';
  if (ref) section.last.assessmentRef = ref;
  else if (section.last.assessmentRef) ref = section.last.assessmentRef;
  const inScope = scoped ? state.assessments.filter(a => a._scope === unit) : [];

  if (!ref) {
    if (state.assessments.length === 0) {
      const assessment = newAssessmentDraft({ number: 1 });
      assessment._seq = state.seq++;
      assessment._scope = scoped ? unit : null;
      assessment._unit = unit;
      state.assessments.push(assessment);
      return assessment;
    }
    if (state.assessments.length > 1 && !section.warnedNoAssessment) {
      section.warnedNoAssessment = true;
      state.ctx.warn(row.sheet, row.row, 'No Assessment # given — criteria were added to the first assessment.');
    }
    return inScope[0] || state.assessments[0];
  }

  const existing = findAssessment(inScope, ref) || findAssessment(state.assessments, ref);
  if (existing) return existing;
  if (state.assessments.length >= IMPORT_LIMITS.assessments) return null;
  const number = parseRefNumber(ref);
  const scope = scoped ? unit : null;
  const assessment = newAssessmentDraft(number !== null
    ? { number }
    : { title: text(ref, IMPORT_LIMITS.title), number: state.assessments.filter(a => a._scope === scope).reduce((m, a) => Math.max(m, a.number || 0), 0) + 1 });
  assessment._seq = state.seq++;
  assessment._scope = scope;
  assessment._unit = unit;
  state.assessments.push(assessment);
  state.ctx.warn(row.sheet, row.row, `Assessment "${ref}" is not on the Assessments tab — it was added.`);
  return assessment;
}

function processRubrics(state) {
  // Group consecutive rows by section + target assessment.
  const groups = [];
  let current = null;
  for (const row of state.rows.rubrics) {
    const assessment = assessmentForRow(state, row);
    if (!assessment) continue;
    if (!current || current.assessment !== assessment || current.section !== row.section) {
      current = { assessment, section: row.section, rows: [] };
      groups.push(current);
    }
    current.rows.push(row);
  }

  const replaced = new Set();
  for (const group of groups) {
    const { criteria } = criteriaFromRows(group.rows, state.ctx);
    if (!criteria.length) continue;
    const target = group.assessment;
    // The Rubrics tab is more detailed than quick-entry criteria on the Assessments tab.
    if (!replaced.has(target)) {
      target.rubric = [];
      replaced.add(target);
    }
    const room = IMPORT_LIMITS.criteria - target.rubric.length;
    target.rubric.push(...criteria.slice(0, Math.max(0, room)));
  }
}

/** Assessments in course order: older per-unit layouts by unit, then by number; otherwise by number. */
function orderedAssessments(state) {
  const unitOrder = new Map(state.units.map((u, i) => [u, i]));
  return state.assessments.slice().sort((a, b) =>
    (unitOrder.get(a._scope) ?? -1) - (unitOrder.get(b._scope) ?? -1) || a.number - b.number || a._seq - b._seq);
}

// ---------- quiz questions (Quiz Questions tab) ----------

function newQuizBlockDraft(state, title) {
  return { type: 'quiz', title: text(title, IMPORT_LIMITS.title), content: '', fileName: '', order: null, quiz: { questions: [] }, _seq: state.seq++ };
}

/** The quiz a question row belongs to: by title (or "Quiz 2" = the 2nd quiz), else a new one at the end. */
function quizForRow(state, lesson, row) {
  const { section } = row;
  let ref = section.map.quizTitle !== undefined ? cellAt(row, section.map.quizTitle) : '';
  if (ref) section.last.quiz = { lesson, ref };
  else if (section.last.quiz?.lesson === lesson) ref = section.last.quiz.ref;
  const quizzes = lesson.blocks.filter(b => b.type === 'quiz');
  if (!ref && quizzes.length) return quizzes[0];
  const key = normalizeKey(ref);
  let hit = key ? quizzes.find(b => normalizeKey(b.title) === key) : null;
  const ordinal = /^quiz\s*#?\s*(\d{1,2})$/i.exec(String(ref).trim());
  if (!hit && ordinal) hit = quizzes[Number(ordinal[1]) - 1] || null;
  if (hit) return hit;
  if (lesson.blocks.length >= IMPORT_LIMITS.blocksPerLesson) {
    state.ctx.warn(row.sheet, row.row, `Only ${IMPORT_LIMITS.blocksPerLesson} blocks per lesson are supported — this quiz was not added.`);
    return null;
  }
  const block = newQuizBlockDraft(state, ref || 'Quiz');
  lesson.blocks.push(block);
  return block;
}

function buildImportedQuestion(state, row, cells) {
  const { ctx } = state;
  const where = [row.sheet, row.row];
  const options = parseOptionsCell(cells.options).slice(0, QUIZ_LIMITS.options);
  const inferred = options.length ? 'multiple_choice'
    : parseTrueFalse(cells.correct) !== null ? 'true_false'
      : cells.correct ? 'short_answer' : 'open';
  let type = inferred;
  if (cells.type) {
    const parsed = parseQuestionType(cells.type);
    if (parsed.recognized) type = parsed.type;
    else ctx.warn(...where, `Question Type "${cells.type.slice(0, 40)}" was not recognised — used ${QUESTION_TYPE_OPTIONS.find(o => o.type === inferred).label}.`);
  }
  const question = createQuizQuestion(type);
  question.prompt = text(cells.prompt, QUIZ_LIMITS.prompt);
  if (!question.prompt) ctx.warn(...where, 'This question has no text.');
  if (cells.points) {
    const points = Number(String(cells.points).replace(',', '.').replace(/[^\d.]/g, ''));
    if (Number.isFinite(points) && points >= 0 && points <= QUIZ_LIMITS.points && /\d/.test(cells.points)) question.points = points;
    else ctx.warn(...where, `Points "${cells.points}" should be a number from 0 to ${QUIZ_LIMITS.points}.`);
  }

  if (type === 'multiple_choice') {
    if (options.length < 2) ctx.warn(...where, 'Multiple choice questions need at least 2 options (one per line).');
    question.options = (options.length ? options : ['', '']).map(optionText => ({ id: generateEntityId('opt'), text: text(optionText, QUIZ_LIMITS.option) }));
    const { indexes, unmatched } = parseCorrectOptions(cells.correct, options);
    if (unmatched.length) ctx.warn(...where, `Correct Answer "${unmatched.join(', ').slice(0, 60)}" does not match an option — use the letter (A, B, C …).`);
    question.correctOptionIds = indexes.map(i => question.options[i].id);
    question.allowMultiple = indexes.length > 1;
    if (!indexes.length && !unmatched.length) ctx.warn(...where, 'No Correct Answer — this question will be marked by the teacher.');
  } else if (type === 'true_false') {
    const value = parseTrueFalse(cells.correct);
    if (value === null) {
      delete question.correctAnswer;
      ctx.warn(...where, cells.correct
        ? `Correct Answer "${cells.correct.slice(0, 30)}" should be True or False — this question will be marked by the teacher.`
        : 'No Correct Answer — this question will be marked by the teacher.');
    } else {
      question.correctAnswer = value;
    }
  } else if (type === 'short_answer') {
    question.acceptedAnswers = splitAnswerList(cells.correct).map(a => text(a, QUIZ_LIMITS.option)).slice(0, 20);
  } else {
    question.modelAnswer = text(cells.modelAnswer || cells.correct, QUIZ_LIMITS.answer);
  }
  return question;
}

function processQuizzes(state) {
  const touched = new Set();
  for (const row of state.rows.quizzes) {
    const map = row.section.map;
    const cells = {
      prompt: cellAt(row, map.prompt),
      type: cellAt(row, map.qType),
      options: cellAt(row, map.options),
      correct: cellAt(row, map.correct),
      points: cellAt(row, map.points),
      modelAnswer: cellAt(row, map.modelAnswer)
    };
    const hasQuestion = Object.values(cells).some(Boolean);
    if (!hasQuestion && !cellAt(row, map.quizTitle)) continue;

    const unit = unitForRow(state, row);
    if (!unit) continue;
    const lesson = lessonForRow(state, unit, row);
    if (!lesson) continue;
    const quizBlock = quizForRow(state, lesson, row);
    if (!quizBlock || !hasQuestion) continue;
    if (quizBlock.quiz.questions.length >= QUIZ_LIMITS.questions) {
      state.ctx.warn(row.sheet, row.row, `Only ${QUIZ_LIMITS.questions} questions per quiz are supported.`);
      continue;
    }
    const question = buildImportedQuestion(state, row, cells);
    question._order = parseIntegerInRange(cellAt(row, map.questionNo), 0, 100000, 'Question #').value ?? null;
    question._seq = state.seq++;
    quizBlock.quiz.questions.push(question);
    touched.add(quizBlock);
  }
  for (const block of touched) {
    block.quiz.questions.sort((a, b) => (a._order ?? Infinity) - (b._order ?? Infinity) || a._seq - b._seq);
    block.quiz.questions = block.quiz.questions.map(({ _order, _seq, ...question }) => question);
  }
}

function buildUnstructuredText(groups) {
  let out = '';
  for (const group of groups) {
    const lines = group.rows.map(cells => {
      const filled = cells.map(c => String(c ?? '').trim());
      while (filled.length && !filled[filled.length - 1]) filled.pop();
      return filled.join(' | ');
    }).filter(Boolean);
    if (!lines.length) continue;
    out += `### Sheet: ${group.sheet}\n${lines.join('\n')}\n\n`;
    if (out.length > IMPORT_LIMITS.unstructuredChars) return out.slice(0, IMPORT_LIMITS.unstructuredChars);
  }
  return out.trim();
}

function countStats(course, units, assessments = []) {
  const lessons = units.reduce((n, u) => n + u.lessons.length, 0);
  const allBlocks = units.flatMap(u => u.lessons.flatMap(l => l.blocks));
  const quizzes = allBlocks.filter(b => b.type === 'quiz');
  return {
    outcomes: course.learningOutcomes.length,
    units: units.length,
    lessons,
    blocks: allBlocks.length,
    quizzes: quizzes.length,
    questions: quizzes.reduce((n, b) => n + (b.quiz?.questions?.length || 0), 0),
    assessments: assessments.length,
    criteria: assessments.reduce((n, a) => n + a.rubric.length, 0)
  };
}

/**
 * Parses uploaded sheets (from spreadsheetReader) into a course draft.
 * @param {Array<{ name: string, rows: string[][], links?: object }>} sheets
 */
export function parseCourseSpreadsheet(sheets) {
  const ctx = createContext();
  const state = {
    ctx,
    course: emptyCourseFields(),
    units: [],
    unitByCode: new Map(),
    unitByTitle: new Map(),
    rows: { courseRow: [], outcomes: [], units: [], lessons: [], blocks: [], quizzes: [], assessments: [], rubrics: [] },
    assessments: [],
    unstructured: [],
    recognized: new Set(),
    sourceUrls: new Set(),
    seq: 0
  };

  const usable = (Array.isArray(sheets) ? sheets : []).filter(s => s && Array.isArray(s.rows));
  const skipped = [];
  for (const sheet of usable) {
    if (isInstructionsSheet(sheet)) {
      skipped.push(sheet.name);
      continue;
    }
    scanSheet(sheet, state);
  }

  processCourseRows(state);
  processOutcomes(state);
  processUnits(state);
  processLessons(state);
  processBlocks(state);
  appendLessonLinks(state);
  processQuizzes(state);
  processAssessments(state);
  processRubrics(state);

  const units = state.units.map(unit => ({
    unitCode: unit.unitCode,
    unitTitle: unit.unitTitle,
    nominalHours: unit.nominalHours,
    description: unit.description,
    learningOutcomes: unit.learningOutcomes,
    lessons: unit.lessons.map(lesson => ({
      title: lesson.title,
      estimatedMinutes: lesson.estimatedMinutes,
      blocks: lesson.blocks.map(b => ({
        type: b.type,
        title: b.title,
        content: b.content,
        fileName: b.fileName,
        ...(b.type === 'quiz' ? { quiz: { questions: b.quiz?.questions || [] } } : {})
      }))
    }))
  }));
  // One Assessments & Rubrics list for the course; unitIndex links a task to the unit it covers.
  const unitIndex = new Map(state.units.map((u, i) => [u, i]));
  const assessments = orderedAssessments(state).map(a => ({
    title: a.title,
    type: a.type,
    description: a.description,
    dueDate: a.dueDate,
    nominalWeight: a.nominalWeight,
    externalSubmissionLinks: a.externalSubmissionLinks,
    unitIndex: a._unit ? unitIndex.get(a._unit) ?? -1 : -1,
    rubric: a.rubric.map(c => ({
      criterionTitle: c.criterionTitle,
      weightPercentage: c.weightPercentage,
      levels: c.levels.map(l => ({ label: l.label, descriptor: l.descriptor }))
    }))
  }));

  const course = state.course;
  const recognizedSheets = Array.from(state.recognized);
  const unstructuredSheets = Array.from(new Set(state.unstructured.map(g => g.sheet)));
  for (const name of unstructuredSheets) {
    ctx.warn(name, null, recognizedSheets.includes(name)
      ? 'Some rows were not recognised. ✨ AI Assist can still use them.'
      : 'This sheet was not recognised as part of the template. ✨ AI Assist can still read it.');
  }

  return {
    draft: { course, units, assessments },
    warnings: ctx.warnings,
    warningsTruncated: ctx.truncated,
    stats: countStats(course, units, assessments),
    recognizedSheets,
    unstructuredSheets,
    skippedSheets: skipped,
    unstructuredText: buildUnstructuredText(state.unstructured),
    sourceUrls: Array.from(state.sourceUrls)
  };
}

/** True when the parse found anything usable (course details, units, or text for AI). */
export function hasSpreadsheetContent(parsed) {
  if (!parsed) return false;
  const c = parsed.draft?.course || {};
  const hasCourse = Boolean(c.title || c.code || c.description || c.learningOutcomes?.length || c.category || c.year);
  return hasCourse || (parsed.draft?.units?.length || 0) > 0 || (parsed.draft?.assessments?.length || 0) > 0 || (parsed.unstructuredText || '').length >= 15;
}

// ---------- finalisation ----------

function distributeWeights(weights) {
  const list = weights.map(w => (Number.isFinite(w) ? w : null));
  const missing = list.filter(w => w === null).length;
  if (!missing) return list;
  const given = list.reduce((sum, w) => sum + (w ?? 0), 0);
  const remaining = Math.max(0, 100 - given);
  const base = Math.floor(remaining / missing);
  let extra = Math.round(remaining - base * missing);
  return list.map(w => {
    if (w !== null) return w;
    const value = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    return value;
  });
}

function levelPointsFor(labels) {
  const points = defaultLevelPoints(labels.length);
  const firstNumbers = labels.map(l => {
    const m = /(\d+(?:\.\d+)?)/.exec(String(l));
    return m ? Number(m[1]) : null;
  });
  const descending = firstNumbers.length > 1 && firstNumbers.every(n => n !== null) &&
    firstNumbers.every((n, i) => i === 0 || n < firstNumbers[i - 1]);
  return descending ? points.slice().reverse() : points;
}

/** Criteria drafts -> Course Builder rubric rows (ids, labels, points, weights). */
export function finalizeRubricCriteria(criteria, { fallbackLabels = DEFAULT_RUBRIC_LEVEL_LABELS } = {}) {
  const list = (Array.isArray(criteria) ? criteria : []).filter(c => c && typeof c === 'object').slice(0, IMPORT_LIMITS.criteria);
  const weights = distributeWeights(list.map(c => c.weightPercentage));
  return list.map((c, index) => {
    const draftLevels = Array.isArray(c.levels) ? c.levels.slice(0, MAX_RUBRIC_LEVELS) : [];
    const labels = draftLevels.length
      ? draftLevels.map((l, i) => text(l?.label, 120) || `Level ${i + 1}`)
      : fallbackLabels.slice(0, MAX_RUBRIC_LEVELS);
    const points = levelPointsFor(labels);
    return {
      id: generateEntityId('rubric'),
      criterionTitle: text(c.criterionTitle, IMPORT_LIMITS.title) || `Criterion ${index + 1}`,
      weightPercentage: Math.round((weights[index] ?? 0) * 100) / 100,
      levels: labels.map((label, i) => ({ label, points: points[i], descriptor: text(draftLevels[i]?.descriptor, 4000) }))
    };
  });
}

function finalizeBlock(draft, index) {
  if (draft?.type === 'quiz') {
    // Quiz & Questions: the draft's text is the quiz instructions; questions keep their answer keys.
    const block = createBlankContentBlock('quiz', index);
    block.title = text(draft.title, IMPORT_LIMITS.title);
    block.quiz = normalizeQuiz({ instructions: text(draft.quiz?.instructions ?? draft.content, 5000), questions: draft.quiz?.questions });
    return block;
  }
  const type = LINK_BLOCK_METADATA_KEYS[draft.type] || draft.type === 'text_description' || draft.type === 'teacher_guide'
    ? draft.type
    : 'text_description';
  const block = createBlankContentBlock(type, index);
  block.title = text(draft.title, IMPORT_LIMITS.title);
  block.content = DANGEROUS_SCHEME.test(String(draft.content || '')) ? '' : text(draft.content);
  const metaKey = LINK_BLOCK_METADATA_KEYS[type];
  if (metaKey && isHttpUrl(block.content)) block.metadata[metaKey] = block.content;
  if (draft.fileName) block.metadata.fileName = text(draft.fileName, 200);
  return block;
}

function finalizeAssessment(draft, index) {
  const type = draft.type === 'summative' ? 'summative' : 'formative';
  const weight = Number(draft.nominalWeight);
  return {
    id: generateEntityId('asmt'),
    title: text(draft.title, IMPORT_LIMITS.title) || `Assessment Task ${index + 1}`,
    type,
    description: text(draft.description),
    dueDate: typeof draft.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate) ? draft.dueDate : '',
    nominalWeight: Number.isFinite(weight) && draft.nominalWeight !== null ? Math.min(100, Math.max(0, weight)) : (type === 'summative' ? 50 : 20),
    externalSubmissionLinks: (draft.externalSubmissionLinks || []).filter(isHttpUrl).slice(0, 5),
    tag: 'lms',
    rubric: draft.rubric?.length ? finalizeRubricCriteria(draft.rubric) : createDefaultRubric()
  };
}

function finalizeUnit(draft, index) {
  const hours = Number(draft.nominalHours);
  return {
    id: generateEntityId('unit'),
    unitCode: text(draft.unitCode, 100) || `UNIT-${index + 1}01`,
    unitTitle: text(draft.unitTitle, IMPORT_LIMITS.title) || `Unit ${index + 1}`,
    nominalHours: Number.isInteger(hours) && hours > 0 ? Math.min(2000, hours) : 40,
    description: text(draft.description),
    learningOutcomes: (draft.learningOutcomes || []).map(o => text(o, 2000)).filter(Boolean).slice(0, IMPORT_LIMITS.outcomes),
    tag: 'lms',
    lessons: (draft.lessons || []).slice(0, IMPORT_LIMITS.lessonsPerUnit).map((lesson, lIdx) => {
      const minutes = Number(lesson.estimatedMinutes);
      return {
        id: generateEntityId('lesson'),
        title: text(lesson.title, IMPORT_LIMITS.title) || `Lesson ${lIdx + 1}`,
        order: lIdx,
        estimatedMinutes: Number.isInteger(minutes) && minutes > 0 ? Math.min(1440, minutes) : 45,
        tag: 'lms',
        blocks: (lesson.blocks || []).slice(0, IMPORT_LIMITS.blocksPerLesson).map(finalizeBlock)
      };
    })
  };
}

/**
 * Course-level assessment drafts. Drafts in the older shape (assessments inside each unit) are lifted
 * up, remembering their unit, so every caller ends with one Assessments & Rubrics list.
 */
function draftAssessments(draft) {
  const list = Array.isArray(draft?.assessments) ? draft.assessments.filter(a => a && typeof a === 'object') : [];
  (Array.isArray(draft?.units) ? draft.units : []).forEach((unit, unitIndex) => {
    for (const a of Array.isArray(unit?.assessments) ? unit.assessments : []) {
      if (a && typeof a === 'object') list.push({ ...a, unitIndex: Number.isInteger(a.unitIndex) ? a.unitIndex : unitIndex });
    }
  });
  return list;
}

/**
 * Builds the Course Builder course. Course details left blank in the spreadsheet keep the
 * base course's values; when the spreadsheet has units they replace the base course's units.
 */
export function finalizeCourseDraft(draft, baseCourse = {}) {
  const c = draft?.course || {};
  const base = baseCourse && typeof baseCourse === 'object' ? baseCourse : {};
  const pick = (value, fallback) => (value !== undefined && value !== null && value !== '' ? value : fallback);
  const units = Array.isArray(draft?.units) ? draft.units : [];
  const finalUnits = units.length ? units.slice(0, IMPORT_LIMITS.units).map(finalizeUnit) : (Array.isArray(base.units) ? base.units : []);
  const unitIds = new Set(finalUnits.map(u => u?.id).filter(Boolean));
  const tasks = draftAssessments(draft);
  // Spreadsheet assessments replace the base course's; otherwise the base course keeps its own.
  const assessments = tasks.length
    ? tasks.slice(0, IMPORT_LIMITS.assessments).map((a, i) => ({
      ...finalizeAssessment(a, i),
      unitId: (units.length && Number.isInteger(a.unitIndex) && a.unitIndex >= 0 ? finalUnits[a.unitIndex]?.id : '') || ''
    }))
    : (Array.isArray(base.assessments) ? base.assessments : []).map(a => (a && a.unitId && !unitIds.has(a.unitId) ? { ...a, unitId: '' } : a));

  return {
    ...base,
    title: pick(c.title, base.title || 'Imported Course'),
    code: pick(c.code, base.code || ''),
    aqfLevel: Number.isInteger(c.aqfLevel) ? c.aqfLevel : (Number.isInteger(Number(base.aqfLevel)) ? Number(base.aqfLevel) : 0),
    category: pick(c.category, base.category || 'General Academic'),
    year: pick(c.year, base.year || ''),
    startDate: pick(c.startDate, base.startDate || ''),
    token_cost: Number.isInteger(c.token_cost) ? c.token_cost : (Number.isFinite(Number(base.token_cost)) ? Number(base.token_cost) : 10),
    description: pick(c.description, base.description || ''),
    knowledge: pick(c.knowledge, base.knowledge || ''),
    thumbnail: pick(c.thumbnail, base.thumbnail || ''),
    aqfEquivalenceNotes: pick(c.aqfEquivalenceNotes, base.aqfEquivalenceNotes || ''),
    curriculumStandards: Array.isArray(c.curriculumStandards)
      ? sanitizeStandardIds(c.curriculumStandards)
      : sanitizeStandardIds(base.curriculumStandards),
    learningOutcomes: c.learningOutcomes?.length
      ? c.learningOutcomes.slice(0, IMPORT_LIMITS.outcomes)
      : (Array.isArray(base.learningOutcomes) ? base.learningOutcomes : []),
    units: finalUnits,
    assessments,
    tag: 'lms',
    tags: Array.from(new Set([...(Array.isArray(base.tags) ? base.tags : []), 'lms'])),
    updatedAt: Date.now()
  };
}

/** Rough Firestore document size; each course is stored as one document (1 MiB limit). */
export function estimateCourseBytes(course) {
  try {
    return new TextEncoder().encode(JSON.stringify(course)).length;
  } catch {
    return 0;
  }
}

export const FIRESTORE_SAFE_COURSE_BYTES = 900 * 1024;

// ---------- standalone rubric upload ----------

export class RubricImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RubricImportError';
  }
}

/**
 * Reads a rubric matrix (Criterion | Weight % | one column per level, any number of rows).
 * A full course workbook also works: the rubric for `assessmentTitle` is picked from its Rubrics tab.
 * @returns {{ rubric: object[], levelLabels: string[], warnings: object[] }}
 */
export function parseRubricSpreadsheet(sheets, { assessmentTitle = '' } = {}) {
  const ctx = createContext();
  const rows = [];
  for (const sheet of (Array.isArray(sheets) ? sheets : [])) {
    if (!sheet || !Array.isArray(sheet.rows) || isInstructionsSheet(sheet)) continue;
    let section = null;
    sheet.rows.forEach((raw, r) => {
      const cells = raw.map(c => String(c ?? ''));
      if (!cells.some(c => c.trim())) return;
      const detected = detectHeaderRow(cells, { strict: Boolean(section) });
      if (detected) {
        section = detected.table === 'rubrics' ? openSection(detected, cells, r, sheet, ctx) : null;
        return;
      }
      if (section) rows.push({ sheet: sheet.name, row: r + 1, cells, links: {}, section });
    });
  }
  if (!rows.length) {
    throw new RubricImportError('No rubric was found. Use a header row with a "Criterion" column, an optional "Weight %" column, and one column per performance level.');
  }

  // Group by the assessment named in each row (fill-down), when the sheet has that column.
  const groups = new Map();
  for (const row of rows) {
    const { section } = row;
    let ref = section.map.assessmentRef !== undefined ? cellAt(row, section.map.assessmentRef) : '';
    let unit = section.map.unitRef !== undefined ? cellAt(row, section.map.unitRef) : '';
    if (unit) section.last.unitRef = unit;
    else unit = section.last.unitRef || '';
    if (ref) section.last.assessmentRef = ref;
    else ref = section.last.assessmentRef || '';
    const key = `${normalizeKey(unit)}|${normalizeKey(ref)}`;
    if (!groups.has(key)) groups.set(key, { unit, ref, rows: [] });
    groups.get(key).rows.push(row);
  }

  let chosen = null;
  if (groups.size === 1) {
    chosen = groups.values().next().value;
  } else {
    const wanted = normalizeKey(assessmentTitle);
    const matches = Array.from(groups.values()).filter(g => wanted && normalizeKey(g.ref) === wanted);
    if (matches.length === 1) chosen = matches[0];
    else {
      const names = Array.from(groups.values()).map(g => [g.unit, g.ref].filter(Boolean).join(' › ') || 'unnamed').slice(0, 8).join('; ');
      throw new RubricImportError(`This file contains ${groups.size} rubrics (${names}). Upload a file with a single rubric, or put this assessment's title in the Assessment column.`);
    }
  }

  // Rows of one rubric may span several header sections; build each section separately.
  const bySection = [];
  for (const row of chosen.rows) {
    const last = bySection[bySection.length - 1];
    if (last && last.section === row.section) last.rows.push(row);
    else bySection.push({ section: row.section, rows: [row] });
  }
  const criteria = [];
  let levelLabels = [];
  for (const part of bySection) {
    const built = criteriaFromRows(part.rows, ctx);
    if (!levelLabels.length) levelLabels = built.labels;
    criteria.push(...built.criteria);
  }
  if (!criteria.length) throw new RubricImportError('The rubric has a header row but no criteria rows.');

  const weightSum = criteria.reduce((sum, c) => sum + (Number(c.weightPercentage) || 0), 0);
  const allWeighted = criteria.every(c => c.weightPercentage !== null);
  if (allWeighted && Math.abs(weightSum - 100) > 0.01) {
    ctx.warn('', null, `Criterion weights add up to ${Math.round(weightSum * 100) / 100}%, not 100%.`);
  }

  return {
    rubric: finalizeRubricCriteria(criteria, { fallbackLabels: levelLabels.length ? levelLabels : DEFAULT_RUBRIC_LEVEL_LABELS }),
    levelLabels: levelLabels.length ? levelLabels : DEFAULT_RUBRIC_LEVEL_LABELS.slice(),
    warnings: ctx.warnings
  };
}

export { SHEET };
