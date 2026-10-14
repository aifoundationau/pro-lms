/**
 * Course Spreadsheet schema: the single source of truth for the A-to-Z course workbook.
 * Sheet names, column headers, header aliases (for teachers' own layouts), hover help,
 * examples, dropdown lists, and the cell-value parsers shared by the importer and template.
 * Pure module (no Firebase, no DOM).
 */

import { AQF_LEVELS, MAX_RUBRIC_LEVELS } from '../types/courseBuilderTypes.js';
import { CURRICULUM_STANDARDS } from './curriculumStandards.js';

export const SPREADSHEET_TEMPLATE_VERSION = 'OzEdu Course Spreadsheet v3';

export const SHEET = Object.freeze({
  instructions: 'Instructions',
  course: 'Course',
  outcomes: 'Learning Outcomes',
  units: 'Units',
  lessons: 'Lessons',
  blocks: 'Content Blocks',
  quizzes: 'Quiz Questions',
  assessments: 'Assessments',
  rubrics: 'Rubrics'
});

// ---------- normalisation helpers ----------

/** Header text -> comparable form: lowercase words, parentheticals dropped, "&" -> "and". */
export function normalizeHeader(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\u00a0/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[*:]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9#%]+/g, ' ')
    .trim();
}

/** Loose identity key for matching codes/titles: lowercase letters and digits only. */
export function normalizeKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function containsWords(haystack, needle) {
  return ` ${haystack} `.includes(` ${needle} `);
}

// ---------- block & assessment types ----------

/** Block types offered in the spreadsheet dropdown (file attachments are not offered yet). */
export const BLOCK_TYPE_OPTIONS = Object.freeze([
  { type: 'text_description', label: 'Content Description' },
  { type: 'teacher_guide', label: 'Teacher Guide' },
  { type: 'youtube_video', label: 'YouTube Video' },
  { type: 'google_drive_link', label: 'Google Drive Resource' },
  { type: 'notebook_link', label: 'Gemini Notebook' },
  { type: 'quiz', label: 'Quiz & Questions' }
]);

const BLOCK_TYPE_LABELS = {
  text_description: 'Content Description',
  teacher_guide: 'Teacher Guide',
  youtube_video: 'YouTube Video',
  google_drive_link: 'Google Drive Resource',
  file_upload: 'Direct File Attachment',
  notebook_link: 'Gemini Notebook',
  quiz: 'Quiz & Questions'
};

export function blockTypeLabel(type) {
  return BLOCK_TYPE_LABELS[type] || BLOCK_TYPE_LABELS.text_description;
}

// Checked in order: specific phrases before generic words ("teacher notes" before "notes").
const BLOCK_TYPE_KEYWORDS = [
  ['quiz', ['quiz & questions', 'quiz and questions', 'quiz', 'unit quiz', 'knowledge check', 'test', 'questions']],
  ['notebook_link', ['gemini notebook', 'notebook', 'notebooklm', 'notebook link', 'notebook_link']],
  ['teacher_guide', ['teacher guide', 'teacher_guide', 'teacher', 'educator', 'facilitator', 'facilitation', 'pedagogy', 'instructor', 'trainer']],
  ['youtube_video', ['youtube', 'youtube video', 'youtube_video', 'video']],
  ['google_drive_link', ['google drive', 'drive', 'google_drive_link', 'google doc', 'google docs', 'google slides', 'google sheet', 'google sheets', 'google drive resource']],
  ['file_upload', ['direct file attachment', 'file_upload', 'file', 'attachment', 'pdf', 'download', 'handout']],
  ['text_description', ['content description', 'text_description', 'text', 'content', 'description', 'reading', 'notes', 'theory', 'lesson content']]
];

/** @returns {{ type: string, recognized: boolean }} */
export function parseBlockType(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return { type: 'text_description', recognized: false };
  for (const [type, keywords] of BLOCK_TYPE_KEYWORDS) {
    if (keywords.includes(raw)) return { type, recognized: true };
  }
  const words = normalizeHeader(raw);
  for (const [type, keywords] of BLOCK_TYPE_KEYWORDS) {
    if (keywords.some(k => containsWords(words, normalizeHeader(k)))) return { type, recognized: true };
  }
  return { type: 'text_description', recognized: false };
}

export const ASSESSMENT_TYPE_OPTIONS = Object.freeze(['Formative', 'Summative']);

// ---------- quiz questions ----------

export const QUESTION_TYPE_OPTIONS = Object.freeze([
  { type: 'multiple_choice', label: 'Multiple choice' },
  { type: 'true_false', label: 'True / False' },
  { type: 'short_answer', label: 'Short answer' },
  { type: 'open', label: 'Open question' }
]);

const QUESTION_TYPE_WORDS = [
  ['true_false', ['true false', 'true or false', 't f', 'tf', 'yes no', 'boolean']],
  ['multiple_choice', ['multiple choice', 'multiple choices', 'mcq', 'mc', 'choice', 'multi choice', 'multiple answer', 'select']],
  ['short_answer', ['short answer', 'short', 'fill in the blank', 'fill in', 'one word', 'cloze', 'single word']],
  ['open', ['open question', 'open', 'essay', 'long answer', 'extended response', 'written response', 'discussion', 'long', 'open ended']]
];

/** @returns {{ type: string, recognized: boolean }} */
export function parseQuestionType(value) {
  const words = normalizeHeader(String(value ?? '').replace(/\//g, ' '));
  if (!words) return { type: '', recognized: false };
  for (const [type, keywords] of QUESTION_TYPE_WORDS) {
    if (keywords.includes(words)) return { type, recognized: true };
  }
  for (const [type, keywords] of QUESTION_TYPE_WORDS) {
    if (keywords.some(k => k.length > 2 && containsWords(words, k))) return { type, recognized: true };
  }
  return { type: '', recognized: false };
}

const OPTION_MARKER = /^\s*(?:\(?[A-Ja-j][.)]|\(?\d{1,2}[.)]|[-*•▪◦])\s+/u;

/** Options cell -> option texts: one per line ("A. Paris"), or "Paris | London" on one line. */
export function parseOptionsCell(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  let parts = raw.split(/\r?\n/);
  if (parts.length === 1 && /\s\|\s|;/.test(raw)) parts = raw.split(/\s\|\s|;/);
  return parts.map(p => p.replace(OPTION_MARKER, '').trim()).filter(Boolean);
}

/** "True" / "T" / "Yes" -> true, "False" / "F" / "No" -> false, otherwise null. */
export function parseTrueFalse(value) {
  const v = String(value ?? '').trim().toLowerCase().replace(/[.!]$/, '');
  if (['true', 't', 'yes', 'y', 'correct', '1', '✓'].includes(v)) return true;
  if (['false', 'f', 'no', 'n', 'incorrect', '0', '✗'].includes(v)) return false;
  return null;
}

/** Accepted answers: one per line, or separated by " | " or ";". */
export function splitAnswerList(value) {
  return String(value ?? '').split(/\r?\n|\s\|\s|;/).map(a => a.trim()).filter(Boolean);
}

/**
 * Correct option(s) for a multiple choice question: letters ("A", "A, C"), numbers ("2") or the
 * option text. @returns {{ indexes: number[], unmatched: string[] }}
 */
export function parseCorrectOptions(value, options) {
  const raw = String(value ?? '').trim();
  const texts = (options || []).map(o => normalizeKey(o));
  if (!raw) return { indexes: [], unmatched: [] };
  const whole = texts.indexOf(normalizeKey(raw));
  if (whole >= 0 && normalizeKey(raw)) return { indexes: [whole], unmatched: [] };
  const indexes = [];
  const unmatched = [];
  for (const token of raw.split(/[\n,;&]|\s+and\s+/i).map(t => t.trim().replace(/^\(|[.)]$/g, '').trim()).filter(Boolean)) {
    let index = -1;
    if (/^[A-Ja-j]$/.test(token)) index = token.toUpperCase().charCodeAt(0) - 65;
    else if (/^\d{1,2}$/.test(token)) index = Number(token) - 1;
    else index = texts.indexOf(normalizeKey(token));
    if (index >= 0 && index < texts.length) {
      if (!indexes.includes(index)) indexes.push(index);
    } else {
      unmatched.push(token);
    }
  }
  return { indexes, unmatched };
}

/** @returns {'formative' | 'summative' | ''} ('' = blank or not recognised) */
export function parseAssessmentType(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.startsWith('summ')) return 'summative';
  if (raw.startsWith('form')) return 'formative';
  if (/\b(final|exam|examination|capstone|major|project|portfolio|end of)\b/.test(raw)) return 'summative';
  if (/\b(quiz|check|practice|diagnostic|draft|minor|progress|knowledge check|weekly)\b/.test(raw)) return 'formative';
  return '';
}

// ---------- value parsers ----------

/** First number in a cell ("40 hrs" -> 40, "1,200" -> 1200). null = blank, NaN = not a number. */
export function parseNumberCell(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const match = /-?\d+(?:\.\d+)?/.exec(s.replace(/(\d),(\d{3})\b/g, '$1$2'));
  return match ? Number(match[0]) : NaN;
}

/** "40%", "40", "40.5 %" -> number; "0.4" stays 0.4 (callers decide if a group is fractional). */
export function parsePercentCell(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const match = /-?\d+(?:[.,]\d+)?/.exec(s);
  return match ? Number(match[0].replace(',', '.')) : NaN;
}

/** Whole number within [min, max]; returns { value } (null when blank) or { error }. */
export function parseIntegerInRange(value, min, max, label) {
  const n = parseNumberCell(value);
  if (n === null) return { value: null };
  if (!Number.isFinite(n)) return { error: `${label} "${value}" is not a number` };
  const rounded = Math.round(n);
  if (rounded < min || rounded > max) return { error: `${label} ${rounded} must be between ${min} and ${max}` };
  return { value: rounded };
}

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12
};

function isoFromParts(y, m, d) {
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null; // e.g. 30 Feb
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Dates -> "YYYY-MM-DD". Accepts ISO, D/M/YYYY (Australian day-first; M/D when unambiguous),
 * "2 March 2026", "March 2, 2026" and Excel serial numbers.
 * @returns {string|null|undefined} ISO string, null when blank, undefined when unreadable.
 */
export function parseDateCell(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return isoFromParts(m[1], m[2], m[3]) || undefined;

  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    let a = Number(m[1]);
    let b = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    if (b > 12 && a <= 12) [a, b] = [b, a]; // clearly month-first (US)
    return isoFromParts(year, b, a) || undefined; // day-first (Australian)
  }

  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})$/i.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return isoFromParts(m[3], MONTHS[m[2].toLowerCase()], m[1]) || undefined;

  m = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) return isoFromParts(m[3], MONTHS[m[1].toLowerCase()], m[2]) || undefined;

  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial > 20000 && serial < 80000) {
      const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return isoFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()) || undefined;
    }
  }
  return undefined;
}

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4 };

/** "4", "Level 5", "AQF 7", "Certificate IV", "Diploma", "International" -> 0–9. */
export function parseAqfLevel(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return { value: null };
  const num = /^(?:aqf|level|aqf level|level taxonomy)?\s*(\d{1,2})\b/.exec(s);
  if (num) {
    const n = Number(num[1]);
    return n >= 0 && n <= 9 ? { value: n } : { error: `Level "${value}" must be 0–9` };
  }
  if (/international|non-aqf|non aqf|unassigned|bespoke/.test(s)) return { value: 0 };
  const cert = /certificate\s+(iv|iii|ii|i|[1-4])\b/.exec(s);
  if (cert && !/graduate/.test(s)) return { value: ROMAN[cert[1]] || Number(cert[1]) };
  if (/masters?\b/.test(s)) return { value: 9 };
  if (/honours|graduate certificate|graduate diploma|grad cert|grad dip/.test(s)) return { value: 8 };
  if (/bachelor/.test(s)) return { value: 7 };
  if (/advanced diploma|associate degree/.test(s)) return { value: 6 };
  if (/diploma/.test(s)) return { value: 5 };
  const known = AQF_LEVELS.find(l => l.credential.toLowerCase() === s || l.shortTitle.toLowerCase() === s);
  return known ? { value: known.level } : { error: `Level "${value}" was not recognised (use 0–9)` };
}

const STANDARD_ALIASES = {
  aacsb: ['aacsb'],
  teqsa: ['teqsa', 'hesf'],
  acara: ['acara', 'australian curriculum'],
  uk_qaa: ['uk qaa', 'qaa', 'fheq', 'uk quality code', 'uk_qaa'],
  uk_ofsted: ['ofsted', 'uk ofsted', 'gcse', 'a level', 'uk_ofsted']
};

/**
 * "TEQSA, UK QAA / FHEQ" -> ['teqsa', 'uk_qaa']. "None" clears the selection.
 * @returns {{ ids: string[]|null, unknown: string[] }} ids null = blank cell
 */
export function parseStandards(value) {
  const s = String(value ?? '').trim();
  if (!s) return { ids: null, unknown: [] };
  if (/^(none|n\/a|na|-)$/i.test(s)) return { ids: [], unknown: [] };
  const ids = new Set();
  const unknown = [];
  for (const token of s.split(/[,;\n|]+/).map(t => t.trim()).filter(Boolean)) {
    const norm = normalizeHeader(token.replace(/_/g, ' '));
    const match = CURRICULUM_STANDARDS.find(std =>
      std.id === token.toLowerCase() ||
      normalizeHeader(std.label) === norm ||
      STANDARD_ALIASES[std.id].some(alias => containsWords(norm, normalizeHeader(alias.replace(/_/g, ' '))))
    );
    if (match) ids.add(match.id);
    else unknown.push(token);
  }
  return { ids: CURRICULUM_STANDARDS.filter(std => ids.has(std.id)).map(std => std.id), unknown };
}

export function standardsToLabels(ids) {
  return CURRICULUM_STANDARDS.filter(std => (ids || []).includes(std.id)).map(std => std.label).join(', ');
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]]+/gi;

/** True for an absolute http(s) URL (no javascript:, data:, etc.). */
export function isHttpUrl(value) {
  const s = String(value ?? '').trim();
  if (!/^https?:\/\//i.test(s) || /\s/.test(s)) return false;
  try {
    const url = new URL(s);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** Every http(s) URL in a block of text (used as the "links Gemini may use" allow-list). */
export function extractUrls(text) {
  return Array.from(String(text ?? '').matchAll(URL_PATTERN), m => m[0].replace(/[.,;:!?]+$/, ''));
}

/** Multi-line cell -> list items, stripping bullets and "1." / "a)" numbering. */
export function splitListCell(value) {
  return String(value ?? '')
    .split(/\n+/)
    .map(line => line.replace(/^\s*(?:[-*•▪◦]|\(?\d{1,2}[.)]|\(?[a-z][.)])\s+/i, '').trim())
    .filter(Boolean);
}

// ---------- sheet definitions ----------

function col(key, header, aliases, extra = {}) {
  const normAliases = Array.from(new Set([header, ...aliases].map(normalizeHeader).filter(Boolean)));
  return Object.freeze({ key, header, aliases, normAliases, aliasSet: new Set(normAliases), ...extra });
}

const UNIT_REF_ALIASES = ['unit code', 'unit', 'unit #', 'unit no', 'unit number', 'unit id', 'unit title', 'unit name', 'module code', 'module', 'subject code', 'competency code'];

/** Course details (vertical Field | Value | Help layout on the Course tab). */
export const COURSE_FIELDS = Object.freeze([
  col('title', 'Course Title', ['course name', 'title of course', 'qualification title', 'qualification name', 'title', 'name'], {
    help: 'Full course or qualification name.', example: 'Diploma of Sustainable Business Practice', signature: true
  }),
  col('code', 'Course Code', ['qualification code', 'course id', 'code'], {
    help: 'Your course code or national qualification code.', example: 'OZ-SBP5', signature: true
  }),
  col('aqfLevel', 'Level Taxonomy (AQF 0-9)', ['level taxonomy', 'aqf level', 'aqf', 'level', 'qualification level', 'aqf level taxonomy'], {
    help: '0 = International / Non-AQF. 1–9 = AQF levels: 4 = Certificate IV, 5 = Diploma, 7 = Bachelor, 9 = Masters.',
    example: '5', list: AQF_LEVELS.map(l => String(l.level)), signature: true
  }),
  col('category', 'Category', ['subject area', 'subject', 'discipline', 'field of education', 'industry'], {
    help: 'Subject area shown on course cards and in Global Search.', example: 'Business & Sustainability'
  }),
  col('year', 'Year / Semester', ['year', 'semester', 'term', 'intake', 'study period', 'year level'], {
    help: 'When the course runs.', example: '2026 Semester 1'
  }),
  col('startDate', 'Start Date', ['course start date', 'commencement date', 'start', 'starts'], {
    help: 'YYYY-MM-DD.', example: '2026-02-09', signature: true
  }),
  col('description', 'Course Description', ['description', 'overview', 'course overview', 'summary'], {
    help: 'Who the course is for, what it covers and where it leads.', example: 'A practical diploma for team leaders who want to embed sustainability into everyday operations.', signature: true
  }),
  col('knowledge', 'Assumed Knowledge / Prerequisites', ['assumed knowledge', 'prerequisites', 'prerequisite', 'entry requirements', 'prior knowledge'], {
    help: 'What learners should already know.', example: 'Year 12 English or equivalent workplace experience.', signature: true
  }),
  col('curriculumStandards', 'Curriculum Standards', ['standards', 'frameworks', 'accreditation', 'curriculum standard'], {
    help: `Comma-separated, or "None": ${CURRICULUM_STANDARDS.map(s => s.label).join(', ')}.`, example: 'TEQSA', signature: true
  }),
  col('aqfEquivalenceNotes', 'Level Equivalence Notes', ['aqf equivalence notes', 'aqf equivalence', 'equivalence notes', 'international equivalence'], {
    help: 'How the course maps to AQF or international frameworks.', example: 'Equivalent to a UK Level 5 HND.'
  }),
  col('thumbnail', 'Cover Image URL', ['cover image', 'thumbnail', 'image url', 'banner image', 'thumbnail url'], {
    help: 'https:// link to a cover image.', example: 'https://example.com/cover.jpg'
  }),
  col('learningOutcomes', 'Course Learning Outcomes', ['learning outcomes', 'outcomes', 'course outcomes'], {
    help: 'One per line. The Learning Outcomes tab is easier for long lists.', inTemplate: false
  })
]);

export const TABLES = Object.freeze({
  outcomes: Object.freeze({
    sheet: SHEET.outcomes,
    minScore: 2,
    signatures: ['learning outcome', 'learning outcomes', 'course learning outcome', 'outcome'],
    columns: [
      col('order', 'Outcome #', ['outcome no', 'outcome number', '#', 'no', 'number', 'lo #', 'clo #', 'order'], { exactOnly: true, width: 11, help: 'Order (optional).', example: '1' }),
      col('text', 'Learning Outcome', ['learning outcomes', 'course learning outcome', 'outcome', 'outcomes', 'clo', 'lo', 'statement'], {
        width: 100, style: 'wrap', help: 'One measurable course outcome per row (start with a verb).', example: 'Evaluate the environmental impact of business operations using recognised frameworks.'
      })
    ]
  }),
  units: Object.freeze({
    sheet: SHEET.units,
    minScore: 4,
    signatures: ['unit title', 'unit name', 'nominal hours', 'unit description performance criteria', 'unit description', 'unit learning outcomes', 'module title'],
    columns: [
      col('order', 'Unit #', ['unit no', 'unit number', 'unit order', '#', 'no', 'order', 'sequence'], { exactOnly: true, width: 8, help: 'Order of the unit (optional).', example: '1' }),
      col('unitCode', 'Unit Code', ['code', 'unit id', 'module code', 'subject code', 'competency code'], {
        width: 14, style: 'text', help: 'Unique code. Other tabs use it to link rows to this unit.', example: 'SBP501'
      }),
      col('unitTitle', 'Unit Title', ['unit name', 'title', 'name', 'module title', 'module name', 'subject title', 'competency title'], {
        width: 40, style: 'wrap', help: 'Unit name.', example: 'Sustainability Foundations & Systems Thinking'
      }),
      col('nominalHours', 'Nominal Hours', ['hours', 'nominal guided hours', 'guided learning hours', 'duration', 'study hours'], {
        width: 10, help: 'Guided learning hours (whole number).', example: '40'
      }),
      col('description', 'Unit Description / Performance Criteria', ['unit description', 'description', 'performance criteria', 'unit overview', 'overview', 'summary'], {
        width: 60, style: 'wrap', help: 'Scope and performance criteria.', example: 'Explains sustainability principles and applies systems thinking to workplace decisions.'
      }),
      col('learningOutcomes', 'Unit Learning Outcomes', ['learning outcomes', 'outcomes', 'elements', 'unit outcomes'], {
        width: 60, style: 'wrap', help: 'One outcome per line (Alt+Enter in Excel, Ctrl+Enter in Google Sheets).', example: 'Explain the triple bottom line\nMap a workplace system'
      })
    ]
  }),
  lessons: Object.freeze({
    sheet: SHEET.lessons,
    minScore: 4,
    signatures: ['lesson title', 'lesson name', 'lesson topic', 'duration', 'estimated minutes', 'minutes', 'youtube video links', 'google drive resource links', 'gemini notebook links'],
    columns: [
      col('unitRef', 'Unit Code', UNIT_REF_ALIASES, { exactOnly: true, width: 14, style: 'text', help: 'Unit Code from the Units tab (or the unit number). Blank = same as the row above.', example: 'SBP501' }),
      col('lessonNo', 'Lesson #', ['lesson no', 'lesson number', 'lesson', 'session #', 'session', 'week #', 'week', 'week no', '#', 'no', 'order'], { exactOnly: true, width: 10, help: 'Lesson number within the unit.', example: '1' }),
      col('title', 'Lesson Title', ['lesson name', 'lesson topic', 'topic', 'session title', 'title', 'name'], { width: 50, style: 'wrap', help: 'Lesson title.', example: 'What is sustainability?' }),
      col('estimatedMinutes', 'Duration (minutes)', ['duration', 'minutes', 'estimated minutes', 'length', 'time', 'mins'], { width: 12, help: 'Lesson length in minutes.', example: '60' }),
      col('youtubeLinks', 'YouTube Video Links', ['youtube videos', 'youtube video', 'youtube links', 'youtube', 'videos', 'video links', 'video'], {
        width: 46, style: 'wrap', linkType: 'youtube_video',
        help: 'As many YouTube links as you need, one per line (Alt+Enter in Excel, Ctrl+Enter in Google Sheets). Add a title with "Title | link".',
        example: 'Intro video | https://www.youtube.com/watch?v=VIDEO_ID'
      }),
      col('driveLinks', 'Google Drive Resource Links', ['google drive resources', 'google drive resource', 'google drive links', 'google drive', 'drive links', 'drive resources', 'resources', 'resource links'], {
        width: 46, style: 'wrap', linkType: 'google_drive_link',
        help: 'As many Google Drive / Docs / Slides links as you need, one per line. Share them as "Anyone with the link can view". Add a title with "Title | link".',
        example: 'Worksheet | https://drive.google.com/file/d/FILE_ID/view'
      }),
      col('notebookLinks', 'Gemini Notebook Links', ['gemini notebooks', 'gemini notebook', 'notebook links', 'notebooks', 'notebook', 'notebooklm links', 'notebooklm'], {
        width: 46, style: 'wrap', linkType: 'notebook_link',
        help: 'As many Gemini Notebook (or NotebookLM) share links as you need, one per line. Add a title with "Title | link".',
        example: 'Study notebook | https://notebooklm.google.com/notebook/NOTEBOOK_ID'
      })
    ]
  }),
  blocks: Object.freeze({
    sheet: SHEET.blocks,
    minScore: 4,
    signatures: ['block type', 'block title', 'block #', 'content or link url', 'content type'],
    columns: [
      col('unitRef', 'Unit Code', UNIT_REF_ALIASES, { exactOnly: true, width: 14, style: 'text', help: 'Unit Code (blank = same as the row above).', example: 'SBP501' }),
      col('lessonRef', 'Lesson #', ['lesson no', 'lesson number', 'lesson', 'lesson title', 'week', 'week #', 'session'], { exactOnly: true, width: 10, help: 'Lesson number from the Lessons tab (blank = same as the row above).', example: '1' }),
      col('order', 'Block #', ['block no', 'block number', 'block order', 'order', '#'], { exactOnly: true, width: 9, help: 'Order inside the lesson (optional).', example: '1' }),
      col('type', 'Block Type', ['type', 'content type', 'resource type', 'kind'], {
        width: 24, list: BLOCK_TYPE_OPTIONS.map(o => o.label),
        help: 'Content Description, Teacher Guide (hidden from students), YouTube Video, Google Drive Resource or Gemini Notebook. Add one row per block — as many of each as you need.', example: 'Content Description'
      }),
      col('title', 'Block Title', ['heading', 'section heading', 'title', 'name'], { width: 34, style: 'wrap', help: 'Heading shown above the block.', example: 'Key ideas' }),
      col('content', 'Text', ['text content', 'content or link url', 'content', 'text', 'body', 'notes', 'content text'], {
        width: 70, style: 'wrap', help: 'Lesson text for Content Description and Teacher Guide blocks.', example: 'Sustainability balances environmental, social and economic outcomes...'
      }),
      col('linkUrl', 'Link URL', ['link url', 'link', 'url', 'resource link', 'video link', 'resource url'], {
        width: 46, help: 'The https:// link for YouTube Video, Google Drive Resource and Gemini Notebook blocks.', example: 'https://www.youtube.com/watch?v=VIDEO_ID'
      }),
      col('fileName', 'File Name', ['filename', 'attachment name'], { width: 20, help: 'Optional display name for a linked file.', example: '' })
    ]
  }),
  quizzes: Object.freeze({
    sheet: SHEET.quizzes,
    minScore: 6,
    signatures: ['question type', 'quiz title', 'correct answer', 'question', 'quiz', 'options', 'quiz question'],
    columns: [
      col('unitRef', 'Unit Code', UNIT_REF_ALIASES, { exactOnly: true, width: 14, style: 'text', help: 'Unit Code (blank = same as the row above).', example: 'SBP501' }),
      col('lessonRef', 'Lesson #', ['lesson no', 'lesson number', 'lesson', 'lesson title', 'week', 'week #', 'session'], { exactOnly: true, width: 10, help: 'Lesson number from the Lessons tab (blank = same as the row above).', example: '1' }),
      col('quizTitle', 'Quiz Title', ['quiz', 'quiz name', 'quiz block', 'test title'], { width: 26, style: 'wrap', help: 'Which quiz in the lesson (its block title). Blank = same as the row above. A new title adds a quiz at the end of the lesson.', example: 'Check your understanding' }),
      col('questionNo', 'Question #', ['question no', 'question number', 'q #', 'q', 'no', '#'], { exactOnly: true, width: 11, help: 'Order inside the quiz (optional).', example: '1' }),
      col('qType', 'Question Type', ['type', 'question kind', 'kind', 'format'], {
        width: 18, list: QUESTION_TYPE_OPTIONS.map(o => o.label),
        help: 'Multiple choice, True / False, Short answer (marked automatically) or Open question (marked by the teacher).', example: 'Multiple choice'
      }),
      col('prompt', 'Question', ['question text', 'prompt', 'item', 'stem'], { width: 50, style: 'wrap', help: 'The question students see.', example: 'Which pillar is NOT part of the triple bottom line?' }),
      col('options', 'Options', ['answer options', 'choices', 'answers', 'options one per line'], { width: 40, style: 'wrap', help: 'Multiple choice only: one option per line (Alt+Enter in Excel, Ctrl+Enter in Google Sheets), e.g. "A. People".', example: 'A. People\nB. Planet\nC. Profit\nD. Politics' }),
      col('correct', 'Correct Answer', ['correct', 'answer', 'answer key', 'correct option', 'correct answers', 'solution'], { width: 24, style: 'wrap', help: 'Multiple choice: letter(s), e.g. D or A, C. True / False: True or False. Short answer: accepted answers, one per line. Never shown to students.', example: 'D' }),
      col('points', 'Points', ['marks', 'score', 'pts', 'mark'], { width: 9, help: 'Points for this question (default 1; open questions 5).', example: '1' }),
      col('modelAnswer', 'Model Answer / Marking Guide', ['model answer', 'marking guide', 'marking notes', 'sample answer', 'expected answer'], { width: 46, style: 'wrap', help: 'Open questions: what a good answer includes (teachers only).', example: '' })
    ]
  }),
  assessments: Object.freeze({
    sheet: SHEET.assessments,
    minScore: 4,
    signatures: ['assessment title', 'assessment name', 'assessment type', 'weighting %', 'task description brief', 'external submission link', 'task title'],
    columns: [
      // Older layouts started with a Unit Code (filling down); still imported, not in the template.
      col('unitRef', 'Unit Code', UNIT_REF_ALIASES, { exactOnly: true, inTemplate: false }),
      col('assessmentNo', 'Assessment #', ['assessment no', 'assessment number', 'task #', 'task no', 'at #', '#', 'no', 'order'], { exactOnly: true, width: 12, help: 'Number in the course (1, 2, 3 …). The Rubrics tab uses it.', example: '1' }),
      col('title', 'Assessment Title', ['assessment name', 'task title', 'task name', 'assessment', 'title', 'name', 'task'], { width: 36, style: 'wrap', help: 'Assessment task name.', example: 'Workplace Sustainability Audit' }),
      col('type', 'Type', ['assessment type', 'task type', 'formative summative', 'category', 'kind'], { width: 13, list: ASSESSMENT_TYPE_OPTIONS, help: 'Formative (practice) or Summative (graded).', example: 'Summative' }),
      col('nominalWeight', 'Weighting %', ['weighting', 'assessment weighting', '% of grade', 'grade weight', 'weighting percent', 'percentage of unit', 'percentage of course'], { width: 12, help: 'Share of the course grade, e.g. 40. All tasks together should add up to 100.', example: '60' }),
      col('dueDate', 'Due Date', ['due', 'deadline', 'submission date', 'date due'], { width: 14, style: 'text', help: 'YYYY-MM-DD.', example: '2026-04-10' }),
      col('description', 'Task Description / Brief', ['task description', 'description', 'brief', 'task brief', 'instructions', 'assessment description', 'requirements'], {
        width: 70, style: 'wrap', help: 'What students do and submit.', example: 'Audit one workplace process and recommend three improvements (1,500 words).'
      }),
      col('submissionLink', 'External Submission Link', ['submission link', 'submission url', 'submit link', 'link', 'url', 'google form', 'form link'], { width: 40, help: 'Optional https:// link (Google Form, Teams, Canvas).', example: '' }),
      col('coversUnit', 'Covers Unit', ['covers unit', 'covers', 'unit covered', 'units covered', 'for unit', 'assesses unit'], { exactOnly: true, width: 14, style: 'text', help: 'Optional: the Unit Code this task assesses. Blank = the whole course.', example: 'SBP501' }),
      col('rubricSummary', 'Rubric Criteria', ['rubric', 'rubric criteria', 'marking criteria', 'grading criteria', 'marking guide', 'criteria'], { inTemplate: false }),
      col('details', 'Questions or Details', ['questions or details', 'questions', 'task details', 'exam questions', 'quiz questions'], { inTemplate: false })
    ]
  }),
  rubrics: Object.freeze({
    sheet: SHEET.rubrics,
    minScore: 4,
    signatures: ['criterion', 'criteria', 'criterion title', 'criterion and weight', 'performance criterion'],
    columns: [
      col('unitRef', 'Unit Code', UNIT_REF_ALIASES, { exactOnly: true, inTemplate: false }),
      col('assessmentRef', 'Assessment #', ['assessment no', 'assessment number', 'assessment', 'assessment title', 'task', 'task #', 'task title', 'at #'], { exactOnly: true, width: 12, help: 'Assessment number (or title) from the Assessments tab. Blank = same as the row above.', example: '1' }),
      col('criterion', 'Criterion', ['criteria', 'criterion title', 'criterion and weight', 'performance criterion', 'criterion name', 'assessment criterion'], { width: 34, style: 'wrap', help: 'One criterion per row — add as many rows as you need.', example: 'Analysis of current practice' }),
      col('weight', 'Weight %', ['weight', 'weighting %', 'weighting', 'criterion weight', '%', 'weight percent'], { width: 10, help: 'Criterion weight. Each rubric should add up to 100.', example: '40' })
    ]
  }),
  courseRow: Object.freeze({
    sheet: SHEET.course,
    minScore: 6,
    signatures: COURSE_FIELDS.filter(f => f.signature).flatMap(f => f.normAliases.filter(a => a.split(' ').length > 1)),
    columns: COURSE_FIELDS
  })
});

/** Detection priority when two layouts score equally. */
export const TABLE_PRIORITY = ['rubrics', 'quizzes', 'blocks', 'assessments', 'lessons', 'units', 'outcomes', 'courseRow'];

/** Rubric sheet columns that are never performance levels. */
export const RUBRIC_IGNORED_HEADERS = new Set(['notes', 'note', 'comments', 'comment', 'feedback', 'points', 'marks', 'max points', 'max marks', 'total', 'score', 'id', 'row']);

export const MAX_LEVELS = MAX_RUBRIC_LEVELS;

/**
 * Maps one header row onto a column set: exact alias matches first, then whole-word
 * "contains" matches (longest alias wins).
 * @returns {{ map: Object<string, number>, exact: number, partial: number, used: Set<number>, score: number }}
 */
export function matchHeaderRow(cells, columns) {
  const normalized = cells.map(normalizeHeader);
  const map = {};
  const used = new Set();
  const exactKeys = new Set();
  let exact = 0;
  let partial = 0;

  for (const column of columns) {
    for (let i = 0; i < normalized.length; i++) {
      if (used.has(i) || !normalized[i]) continue;
      if (column.aliasSet.has(normalized[i])) {
        map[column.key] = i;
        used.add(i);
        exactKeys.add(column.key);
        exact++;
        break;
      }
    }
  }

  for (const column of columns) {
    if (map[column.key] !== undefined || column.exactOnly) continue;
    let best = -1;
    let bestLength = 0;
    for (let i = 0; i < normalized.length; i++) {
      if (used.has(i) || !normalized[i]) continue;
      for (const alias of column.normAliases) {
        if (alias.length >= 4 && alias.length > bestLength && containsWords(normalized[i], alias)) {
          best = i;
          bestLength = alias.length;
        }
      }
    }
    if (best >= 0) {
      map[column.key] = best;
      used.add(best);
      partial++;
    }
  }

  return { map, exact, partial, used, exactKeys, score: exact * 2 + partial };
}

/**
 * Decides whether a row is a header for one of the known tables.
 * @param {boolean} strict require a stronger match (used once a table is already open in the sheet)
 * @returns {null | { table: string, match: object }}
 */
export function detectHeaderRow(cells, { strict = false } = {}) {
  const normalized = cells.map(normalizeHeader).filter(Boolean);
  if (normalized.length === 0) return null;
  let best = null;
  for (const name of TABLE_PRIORITY) {
    const table = TABLES[name];
    if (!normalized.some(h => table.signatures.includes(h))) continue;
    const match = matchHeaderRow(cells, table.columns);
    const minScore = strict ? Math.max(4, table.minScore) : table.minScore;
    // A rubric matrix may be just "Criterion & Weight | level | level ..." (the builder's own layout).
    const rubricMatrix = !strict && name === 'rubrics' && match.exactKeys.has('criterion') &&
      cells.filter((c, i) => !match.used.has(i) && String(c ?? '').trim()).length >= 2;
    if (match.score < minScore && !rubricMatrix) continue;
    if (!best || match.score > best.match.score) best = { table: name, match };
  }
  return best;
}

/** Matches a vertical "Label | Value" row on the Course tab. */
/**
 * Course rows from older templates that are no longer used (courses have no enrolment cost).
 * Rows with these labels are skipped quietly instead of being reported as unrecognised.
 */
const RETIRED_COURSE_LABELS = new Set(['enrolment cost', 'enrollment cost', 'enrolment cost (tokens)', 'enrollment cost (tokens)', 'token cost', 'course token pricing'].map(normalizeHeader));

export function isRetiredCourseLabel(label) {
  const norm = normalizeHeader(label);
  return Boolean(norm) && RETIRED_COURSE_LABELS.has(norm);
}

export function matchCourseFieldLabel(label) {
  const norm = normalizeHeader(label);
  if (!norm) return null;
  return COURSE_FIELDS.find(field => field.aliasSet.has(norm)) || null;
}
