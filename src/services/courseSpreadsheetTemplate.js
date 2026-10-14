/**
 * Course Spreadsheet templates & exports.
 *
 * - buildCourseWorkbookSheets(course?) -> the A-to-Z workbook (blank when no course is given)
 * - createExampleCourse()              -> a complete worked example course
 * - buildRubricWorkbookSheets(rubric)  -> a single Assessment Rubric Matrix sheet
 * - download* helpers (browser only)    -> .xlsx downloads built with the dependency-free writer
 */

import {
  DEFAULT_RUBRIC_LEVEL_LABELS,
  LINK_BLOCK_METADATA_KEYS,
  moveUnitAssessmentsToCourse,
  createQuizQuestion,
  generateEntityId
} from '../types/courseBuilderTypes.js';
import { isQuizBlock } from './quizModel.js';
import { buildXlsxWorkbook, downloadFile, safeFileStem, columnLetter, XLSX_STYLE } from './xlsxWriter.js';
import {
  SPREADSHEET_TEMPLATE_VERSION,
  SHEET,
  TABLES,
  COURSE_FIELDS,
  blockTypeLabel,
  standardsToLabels,
  isHttpUrl,
  normalizeKey,
  QUESTION_TYPE_OPTIONS
} from './courseSpreadsheetSchema.js';
import { finalizeCourseDraft, parseLinkCell, formatLinkLine } from './courseSpreadsheetImport.js';

const TAB_COLOR = 'FF1F4E79';
const MIN_VALIDATION_ROWS = 1000;

function styleFor(column) {
  if (column.style === 'text') return XLSX_STYLE.TEXT;
  if (column.style === 'wrap') return XLSX_STYLE.WRAP;
  return undefined;
}

function hintFor(column) {
  return [column.help, column.example ? `Example: ${String(column.example).replace(/\n/g, ' / ')}` : '']
    .filter(Boolean)
    .join(' ');
}

/** One table sheet: frozen bold header, widths, dropdowns and hover hints. */
function tableSheet(tableKey, dataRows, { extraHeaders = [], extraWidth = 40 } = {}) {
  const table = TABLES[tableKey];
  const columns = table.columns.filter(c => c.inTemplate !== false);
  const header = [...columns.map(c => ({ v: c.header, s: XLSX_STYLE.HEADER })), ...extraHeaders.map(h => ({ v: h, s: XLSX_STYLE.HEADER }))];
  const lastRow = Math.max(MIN_VALIDATION_ROWS, dataRows.length + 200);

  const validations = columns.map((column, i) => {
    const range = `${columnLetter(i)}2:${columnLetter(i)}${lastRow}`;
    const prompt = hintFor(column);
    if (Array.isArray(column.list) && column.list.length) {
      return { range, list: column.list, promptTitle: column.header, prompt };
    }
    return prompt ? { range, promptTitle: column.header, prompt } : null;
  }).filter(Boolean);

  return {
    name: table.sheet,
    tabColor: TAB_COLOR,
    freezeRows: 1,
    rowHeights: { 0: 32 },
    columns: [
      ...columns.map(c => ({ width: c.width || 16, style: styleFor(c) })),
      ...extraHeaders.map(() => ({ width: extraWidth, style: XLSX_STYLE.WRAP }))
    ],
    rows: [header, ...dataRows],
    validations
  };
}

function instructionsSheet() {
  const rows = [];
  const add = (a, b = '', styleA, styleB) => rows.push([
    styleA !== undefined ? { v: a, s: styleA } : a,
    styleB !== undefined ? { v: b, s: styleB } : b
  ]);
  const section = (title) => {
    rows.push([]);
    rows.push([{ v: title, s: XLSX_STYLE.SECTION }]);
  };

  rows.push([{ v: 'OzEdu Course Spreadsheet — every part of your course, A to Z', s: XLSX_STYLE.TITLE }]);
  add('Template version', SPREADSHEET_TEMPLATE_VERSION, XLSX_STYLE.LABEL);

  section('How to use');
  add('1. Fill in', 'Work through the tabs: Course → Learning Outcomes → Units → Lessons → Content Blocks → Quiz Questions → Assessments → Rubrics. Every tab is optional — leave out anything you do not need.', XLSX_STYLE.LABEL);
  add('2. Link rows', 'Rows on the Lessons, Content Blocks and Quiz Questions tabs belong to a unit through its Unit Code (or unit number); Content Blocks and Quiz Questions also give their Lesson #. Assessments belong to the whole course (Covers Unit is optional), and Rubrics give their Assessment #. A blank Unit Code, Lesson #, Quiz Title or Assessment # repeats the value from the row above.', XLSX_STYLE.LABEL);
  add('3. Upload', 'Course Builder → 📊 Spreadsheet → upload the file → Import into Course Builder (free), or ✨ Build out with Gemini AI. ✨ AI Assist → Spreadsheets accepts the same file.', XLSX_STYLE.LABEL);
  add('Google Sheets', 'Use File → Import to open this file in Google Sheets. To upload it back, use File → Download → Microsoft Excel (.xlsx), which keeps every tab — or download each tab as .csv and upload them all together.', XLSX_STYLE.LABEL);

  section('Tabs');
  add(SHEET.course, 'One value per row: title, code, level, category, dates, enrolment cost, description, prerequisites, curriculum standards.', XLSX_STYLE.LABEL);
  add(SHEET.outcomes, 'One course learning outcome per row — add as many rows as you need.', XLSX_STYLE.LABEL);
  add(SHEET.units, 'One row per unit of study / unit of competency.', XLSX_STYLE.LABEL);
  add(SHEET.lessons, 'One row per lesson: Unit Code, Lesson #, title and duration, plus the lesson\'s links in the YouTube Video Links, Google Drive Resource Links and Gemini Notebook Links columns — as many as you need, one per line.', XLSX_STYLE.LABEL);
  add(SHEET.blocks, 'One row per block inside a lesson. Types: Content Description, Teacher Guide (hidden from students), YouTube Video, Google Drive Resource, Gemini Notebook, Quiz & Questions. Text goes in the Text column and links in the Link URL column. A Quiz & Questions row places a quiz between blocks (its Text is the quiz instructions). Add as many rows of each type as you need.', XLSX_STYLE.LABEL);
  add(SHEET.quizzes, 'Unit quizzes: one row per question. Rows with the same Unit Code, Lesson # and Quiz Title form one quiz. Multiple choice, True / False and Short answer questions are marked automatically; Open questions are marked by the teacher (in bulk, in 📥 Submissions → ❓ Unit quizzes). A quiz without a Content Blocks row is added at the end of its lesson.', XLSX_STYLE.LABEL);
  add(SHEET.assessments, 'The course\'s one Assessments & Rubrics list: one row per task with its type, weighting (share of the course grade — all tasks should add up to 100), due date, task brief, an optional external submission link and, optionally, the unit it covers.', XLSX_STYLE.LABEL);
  add(SHEET.rubrics, 'The Assessment Rubric Matrix: one row per criterion with its Assessment #, Weight % and a descriptor for each performance level — add as many criteria as you need. The level headings (e.g. "Novice (0-49%)") become the level names: rename them, or add or remove level columns (2–10 levels).', XLSX_STYLE.LABEL);

  section('Rules');
  add('Dates', 'YYYY-MM-DD, for example 2026-03-02.', XLSX_STYLE.LABEL);
  add('Weights', 'Type 40 or 40%. Criterion weights in each rubric should add up to 100.', XLSX_STYLE.LABEL);
  add('Links', 'Links must start with https://. Share Google Drive files as "Anyone with the link can view". Gemini Notebook blocks take a notebook share link, e.g. https://notebooklm.google.com/notebook/….', XLSX_STYLE.LABEL);
  add('More than one link', 'Put as many links as you need in one cell, one per line (Alt+Enter in Excel, Ctrl+Enter in Google Sheets). Give a link a title with "Title | link", e.g. Intro video | https://www.youtube.com/watch?v=VIDEO_ID. Each link becomes its own block. You can also repeat the Lesson # on another row to list more links.', XLSX_STYLE.LABEL);
  add('Link order', 'Links from the Lessons tab are added after the lesson\'s Content Blocks rows: YouTube videos first, then Google Drive resources, then Gemini Notebooks. To place a link between other blocks, add it as a row on the Content Blocks tab instead.', XLSX_STYLE.LABEL);
  add('Quiz answers', 'Multiple choice: put each option on its own line (A. …, B. …) and write the correct letter(s) in Correct Answer, e.g. B or A, C. True / False: True or False. Short answer: the accepted answers, one per line (not case-sensitive). Correct answers and model answers are kept for teachers only — students never see them.', XLSX_STYLE.LABEL);
  add('Different level names', 'To give one rubric its own level names, repeat the Rubrics header row (Assessment #, Criterion, Weight %, …) directly above that rubric with its own level headings.', XLSX_STYLE.LABEL);
  add('File attachments', 'Direct file attachments are coming soon. Use a Google Drive Resource block for files for now.', XLSX_STYLE.LABEL);

  section('✨ AI Assist (Gemini)');
  add('Your values win', 'Gemini keeps every value you typed exactly as written and only fills blank cells: lesson content, teacher guides, assessment briefs, rubric descriptors and more.', XLSX_STYLE.LABEL);
  add('No invented links', 'Gemini never invents links. It only uses links that are already in your spreadsheet.', XLSX_STYLE.LABEL);
  add('Fee', 'Importing without AI is free. The AI Assist fee is charged only after Gemini returns content.', XLSX_STYLE.LABEL);

  section('Column guide');
  for (const field of COURSE_FIELDS.filter(f => f.inTemplate !== false)) {
    add(`${SHEET.course} › ${field.header}`, hintFor(field), XLSX_STYLE.LABEL);
  }
  for (const key of ['outcomes', 'units', 'lessons', 'blocks', 'quizzes', 'assessments', 'rubrics']) {
    const table = TABLES[key];
    for (const column of table.columns.filter(c => c.inTemplate !== false)) {
      add(`${table.sheet} › ${column.header}`, hintFor(column), XLSX_STYLE.LABEL);
    }
  }
  add(`${SHEET.rubrics} › level columns`, 'One column per performance level, lowest first or highest first. Each cell describes what that level looks like for the criterion.', XLSX_STYLE.LABEL);

  return {
    name: SHEET.instructions,
    tabColor: 'FF7F6000',
    columns: [{ width: 34, style: XLSX_STYLE.WRAP }, { width: 120, style: XLSX_STYLE.WRAP }],
    rows
  };
}

function courseFieldValue(course, key) {
  if (!course) return '';
  const value = course[key];
  switch (key) {
    case 'aqfLevel':
    case 'token_cost':
      return Number.isFinite(Number(value)) && value !== '' && value !== null && value !== undefined ? Number(value) : '';
    case 'curriculumStandards':
      return Array.isArray(value) ? (value.length ? standardsToLabels(value) : 'None') : '';
    default:
      return typeof value === 'string' ? value : '';
  }
}

function courseSheet(course) {
  const fields = COURSE_FIELDS.filter(f => f.inTemplate !== false);
  const rows = [[
    { v: 'Field', s: XLSX_STYLE.HEADER },
    { v: 'Value', s: XLSX_STYLE.HEADER },
    { v: 'Help & Examples', s: XLSX_STYLE.HEADER }
  ]];
  const validations = [];
  fields.forEach((field, i) => {
    const rowNumber = i + 2;
    rows.push([{ v: field.header, s: XLSX_STYLE.LABEL }, courseFieldValue(course, field.key), hintFor(field)]);
    validations.push(Array.isArray(field.list)
      ? { range: `B${rowNumber}`, list: field.list, promptTitle: field.header, prompt: field.help }
      : { range: `B${rowNumber}`, promptTitle: field.header, prompt: hintFor(field) });
  });
  return {
    name: SHEET.course,
    tabColor: TAB_COLOR,
    freezeRows: 1,
    rowHeights: { 0: 24 },
    columns: [{ width: 34 }, { width: 70, style: XLSX_STYLE.WRAP }, { width: 70, style: XLSX_STYLE.WRAP }],
    rows,
    validations
  };
}

/** Unit references: the unit code when present and unique, otherwise the unit number. */
function unitReferences(units) {
  const counts = new Map();
  for (const unit of units) {
    const key = String(unit.unitCode || '').trim().toLowerCase();
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return units.map((unit, i) => {
    const code = String(unit.unitCode || '').trim();
    return code && counts.get(code.toLowerCase()) === 1 ? code : i + 1;
  });
}

function blockContent(block) {
  const metaKey = LINK_BLOCK_METADATA_KEYS[block.type];
  return (metaKey && block.metadata?.[metaKey]) || block.content || '';
}

const LESSON_LINK_COLUMNS = TABLES.lessons.columns.filter(c => c.linkType);
const LINK_COLUMN_RANK = new Map(LESSON_LINK_COLUMNS.map((c, i) => [c.linkType, i]));

/** True when a link block can be written as one "Title | link" line and reads back identically. */
function fitsLinkColumn(block) {
  const url = blockContent(block);
  if (!isHttpUrl(url) || block.metadata?.fileName) return false;
  const title = String(block.title || '').trim();
  const { links, skipped } = parseLinkCell(formatLinkLine(title, url));
  return links.length === 1 && skipped.length === 0 && links[0].url === url && links[0].title === title;
}

/**
 * Index where a lesson's trailing link blocks start: the tail that the Lessons-tab link columns can
 * hold (videos, then Drive resources, then notebooks — the order the importer adds them back in).
 * Blocks before it go on the Content Blocks tab, so an export re-imports with the same block order.
 */
function lessonLinkTailStart(blocks) {
  let start = blocks.length;
  let rank = Infinity;
  while (start > 0) {
    const block = blocks[start - 1];
    const blockRank = LINK_COLUMN_RANK.get(block?.type);
    if (blockRank === undefined || blockRank > rank || !fitsLinkColumn(block)) break;
    rank = blockRank;
    start--;
  }
  return start;
}

function contentBlockRow(ref, lessonNumber, blockNumber, block) {
  const isLink = Boolean(LINK_BLOCK_METADATA_KEYS[block.type]);
  return [
    ref,
    lessonNumber,
    blockNumber,
    blockTypeLabel(block.type),
    block.title || '',
    block.type === 'quiz' ? block.quiz?.instructions || '' : isLink ? '' : block.content || '',
    isLink ? blockContent(block) : '',
    block.metadata?.fileName || ''
  ];
}

function rubricLabels(rubric) {
  let best = [];
  for (const criterion of Array.isArray(rubric) ? rubric : []) {
    const labels = (criterion.levels || []).map((l, i) => String(l?.label || `Level ${i + 1}`));
    if (labels.length > best.length) best = labels;
  }
  return best;
}

const LETTERS = 'ABCDEFGHIJ';

/** "Quiz Title" used on the Quiz Questions tab: the block title, or "Quiz 2" when blank or repeated. */
function quizReferences(blocks) {
  const quizzes = blocks.filter(isQuizBlock);
  const counts = new Map();
  for (const b of quizzes) {
    const key = normalizeKey(b.title);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return new Map(quizzes.map((b, i) => {
    const title = String(b.title || '').trim();
    return [b, title && counts.get(normalizeKey(title)) === 1 ? title : `Quiz ${i + 1}`];
  }));
}

/** One Quiz Questions row per question (answer keys included: this is the teacher's workbook). */
function quizQuestionRows(unitRef, lessonNumber, quizRef, block) {
  const questions = Array.isArray(block.quiz?.questions) ? block.quiz.questions : [];
  return questions.filter(q => q && typeof q === 'object').map((q, i) => {
    const options = (Array.isArray(q.options) ? q.options : []).filter(o => String(o?.text || '').trim());
    const correctIds = new Set(Array.isArray(q.correctOptionIds) ? q.correctOptionIds : []);
    let correct = '';
    if (q.type === 'multiple_choice') correct = options.map((o, oi) => (correctIds.has(o.id) ? LETTERS[oi] : '')).filter(Boolean).join(', ');
    else if (q.type === 'true_false') correct = q.correctAnswer === true ? 'True' : q.correctAnswer === false ? 'False' : '';
    else if (q.type === 'short_answer') correct = (q.acceptedAnswers || []).join('\n');
    return [
      unitRef,
      lessonNumber,
      quizRef,
      i + 1,
      QUESTION_TYPE_OPTIONS.find(t => t.type === q.type)?.label || 'Open question',
      q.prompt || '',
      q.type === 'multiple_choice' ? options.map((o, oi) => `${LETTERS[oi]}. ${o.text}`).join('\n') : '',
      correct,
      Number.isFinite(Number(q.points)) ? Number(q.points) : '',
      q.type === 'open' ? q.modelAnswer || '' : ''
    ];
  });
}

/**
 * Builds the A-to-Z workbook. With a course, every tab is filled in (export / worked example);
 * without one, the tabs contain headers only.
 */
export function buildCourseWorkbookSheets(course = null) {
  const structured = course ? moveUnitAssessmentsToCourse(course) : null;
  const units = Array.isArray(structured?.units) ? structured.units : [];
  const refs = unitReferences(units);
  const unitRefById = new Map(units.map((u, i) => [u?.id, refs[i]]));

  const outcomeRows = (structured?.learningOutcomes || []).filter(Boolean).map((o, i) => [i + 1, o]);
  const unitRows = units.map((u, i) => [
    i + 1,
    u.unitCode || '',
    u.unitTitle || '',
    Number(u.nominalHours) || '',
    u.description || '',
    (u.learningOutcomes || []).filter(Boolean).join('\n')
  ]);
  const lessonRows = [];
  const blockRows = [];
  const quizRows = [];
  units.forEach((unit, uIdx) => {
    (unit.lessons || []).forEach((lesson, lIdx) => {
      const blocks = (Array.isArray(lesson.blocks) ? lesson.blocks : []).filter(b => b && typeof b === 'object');
      const tailStart = lessonLinkTailStart(blocks);
      const tail = blocks.slice(tailStart);
      lessonRows.push([
        refs[uIdx],
        lIdx + 1,
        lesson.title || '',
        Number(lesson.estimatedMinutes) || '',
        // One cell per link type, one "Title | link" per line.
        ...LESSON_LINK_COLUMNS.map(column => tail
          .filter(b => b.type === column.linkType)
          .map(b => formatLinkLine(String(b.title || '').trim(), blockContent(b)))
          .join('\n'))
      ]);
      blocks.slice(0, tailStart).forEach((block, bIdx) => {
        blockRows.push(contentBlockRow(refs[uIdx], lIdx + 1, bIdx + 1, block));
      });
      const quizRefs = quizReferences(blocks);
      for (const [block, ref] of quizRefs) quizRows.push(...quizQuestionRows(refs[uIdx], lIdx + 1, ref, block));
    });
  });

  // One Assessments & Rubrics list for the course; "Covers Unit" links a task to a unit (optional).
  const tasks = (Array.isArray(structured?.assessments) ? structured.assessments : []).filter(a => a && typeof a === 'object');
  const assessmentRows = tasks.map((a, aIdx) => [
    aIdx + 1,
    a.title || '',
    a.type === 'summative' ? 'Summative' : 'Formative',
    Number.isFinite(Number(a.nominalWeight)) && a.nominalWeight !== null && a.nominalWeight !== '' ? Number(a.nominalWeight) : '',
    a.dueDate || '',
    a.description || '',
    (a.externalSubmissionLinks || []).filter(Boolean).join('\n'),
    a.unitId && unitRefById.has(a.unitId) ? unitRefById.get(a.unitId) : ''
  ]);

  // Rubrics: a header row is repeated whenever a rubric uses different level names.
  const rubricColumns = TABLES.rubrics.columns.filter(c => c.inTemplate !== false);
  let headerLabels = null;
  const rubricBody = [];
  tasks.forEach((a, aIdx) => {
    const rubric = Array.isArray(a.rubric) ? a.rubric : [];
    if (!rubric.length) return;
    const labels = rubricLabels(rubric);
    if (headerLabels === null) {
      headerLabels = labels;
    } else if (JSON.stringify(labels) !== JSON.stringify(headerLabels)) {
      headerLabels = labels;
      rubricBody.push([...rubricColumns.map(c => ({ v: c.header, s: XLSX_STYLE.HEADER })), ...labels.map(l => ({ v: l, s: XLSX_STYLE.HEADER }))]);
    }
    for (const criterion of rubric) {
      rubricBody.push([
        aIdx + 1,
        criterion.criterionTitle || '',
        Number.isFinite(Number(criterion.weightPercentage)) ? Number(criterion.weightPercentage) : '',
        ...labels.map((_, i) => criterion.levels?.[i]?.descriptor || '')
      ]);
    }
  });
  const firstLabels = tasks.find(a => Array.isArray(a.rubric) && a.rubric.length)
    ? rubricLabels(tasks.find(a => Array.isArray(a.rubric) && a.rubric.length).rubric)
    : DEFAULT_RUBRIC_LEVEL_LABELS;

  return [
    instructionsSheet(),
    courseSheet(structured),
    tableSheet('outcomes', outcomeRows),
    tableSheet('units', unitRows),
    tableSheet('lessons', lessonRows),
    tableSheet('blocks', blockRows),
    tableSheet('quizzes', quizRows),
    tableSheet('assessments', assessmentRows),
    tableSheet('rubrics', rubricBody, { extraHeaders: firstLabels, extraWidth: 42 })
  ];
}

/** A single-rubric workbook (Criterion | Weight % | levels…), pre-filled with `rubric`. */
export function buildRubricWorkbookSheets(rubric = [], { assessmentTitle = '' } = {}) {
  const list = Array.isArray(rubric) ? rubric : [];
  const labels = rubricLabels(list).length ? rubricLabels(list) : DEFAULT_RUBRIC_LEVEL_LABELS;
  const header = [
    { v: 'Criterion', s: XLSX_STYLE.HEADER },
    { v: 'Weight %', s: XLSX_STYLE.HEADER },
    ...labels.map(l => ({ v: l, s: XLSX_STYLE.HEADER }))
  ];
  const rows = list.map(c => [
    c.criterionTitle || '',
    Number.isFinite(Number(c.weightPercentage)) ? Number(c.weightPercentage) : '',
    ...labels.map((_, i) => c.levels?.[i]?.descriptor || '')
  ]);
  const help = {
    name: 'How to use',
    columns: [{ width: 110, style: XLSX_STYLE.WRAP }],
    rows: [
      [{ v: `Assessment Rubric Matrix${assessmentTitle ? ` — ${assessmentTitle}` : ''}`, s: XLSX_STYLE.TITLE }],
      ['One row per criterion — add as many criterion rows as you need.'],
      ['Weight %: each criterion\'s share of the mark. The weights should add up to 100.'],
      ['Level columns: the headings are the level names. Rename them, or add/remove level columns (2–10 levels).'],
      ['Upload this file with ⬆ Upload Rubric on the assessment in Course Builder. You can choose to replace the rubric or add the rows to it.']
    ]
  };
  return [{
    name: 'Rubric',
    tabColor: TAB_COLOR,
    freezeRows: 1,
    rowHeights: { 0: 32 },
    columns: [{ width: 34, style: XLSX_STYLE.WRAP }, { width: 10 }, ...labels.map(() => ({ width: 40, style: XLSX_STYLE.WRAP }))],
    rows: [header, ...rows],
    validations: [
      { range: 'A2:A500', promptTitle: 'Criterion', prompt: 'What is assessed. Add as many rows as you need.' },
      { range: 'B2:B500', promptTitle: 'Weight %', prompt: 'Share of the mark, e.g. 40. Weights should add up to 100.' }
    ]
  }, help];
}

// ---------- worked example ----------

const FOUR_LEVELS = DEFAULT_RUBRIC_LEVEL_LABELS;
const BANDS = ['Fail (0-49%)', 'Pass (50-64%)', 'Credit (65-74%)', 'Distinction (75-84%)', 'High Distinction (85-100%)'];

function criterion(title, weight, labels, descriptors) {
  return { criterionTitle: title, weightPercentage: weight, levels: labels.map((label, i) => ({ label, descriptor: descriptors[i] || '' })) };
}

function choiceQuestion(prompt, options, correctIndexes, points = 1) {
  const q = createQuizQuestion('multiple_choice');
  q.prompt = prompt;
  q.points = points;
  q.options = options.map(text => ({ id: generateEntityId('opt'), text }));
  q.correctOptionIds = correctIndexes.map(i => q.options[i].id);
  q.allowMultiple = correctIndexes.length > 1;
  return q;
}

function trueFalseQuestion(prompt, answer) {
  return { ...createQuizQuestion('true_false'), prompt, correctAnswer: answer };
}

function shortAnswerQuestion(prompt, acceptedAnswers) {
  return { ...createQuizQuestion('short_answer'), prompt, acceptedAnswers };
}

function openQuestion(prompt, modelAnswer, points = 5) {
  return { ...createQuizQuestion('open'), prompt, modelAnswer, points };
}

/** A complete two-unit course that shows every tab filled in. */
export function createExampleCourse() {
  const draft = {
    course: {
      title: 'Diploma of Sustainable Business Practice',
      code: 'OZ-SBP5',
      aqfLevel: 5,
      category: 'Business & Sustainability',
      year: '2026 Semester 1',
      startDate: '2026-02-09',
      token_cost: 10,
      description: 'A practical diploma for team leaders who want to embed sustainability into everyday operations: measuring environmental impact, engaging stakeholders and reporting progress with recognised frameworks.',
      knowledge: 'Year 12 English or equivalent workplace experience.',
      curriculumStandards: [],
      aqfEquivalenceNotes: 'Comparable to a UK Level 5 Higher National Diploma (HND).',
      thumbnail: '',
      learningOutcomes: [
        'Explain core sustainability principles and the triple bottom line.',
        'Apply systems thinking to identify sustainability risks and opportunities in a workplace.',
        'Measure and interpret an organisation\'s environmental footprint.',
        'Communicate sustainability performance using recognised reporting frameworks.'
      ]
    },
    units: [
      {
        unitCode: 'SBP501',
        unitTitle: 'Sustainability Foundations & Systems Thinking',
        nominalHours: 40,
        description: 'Introduces sustainability principles and uses systems thinking to analyse how workplace decisions affect people, planet and profit.',
        learningOutcomes: ['Explain the triple bottom line', 'Map a workplace system and its feedback loops'],
        lessons: [
          {
            title: 'What is sustainability?',
            estimatedMinutes: 60,
            blocks: [
              { type: 'text_description', title: 'Key ideas', content: 'Sustainability means meeting today\'s needs without compromising the ability of future generations to meet theirs. Businesses apply it through the triple bottom line: environmental, social and economic performance.' },
              { type: 'teacher_guide', title: 'Facilitation notes', content: 'Open with a 10-minute discussion: "What does a sustainable business look like?" Capture answers under People / Planet / Profit. Common misconception: sustainability is only about the environment.' },
              {
                type: 'quiz',
                title: 'Check your understanding',
                content: 'Answer every question. You can resubmit until your teacher releases results.',
                quiz: {
                  questions: [
                    choiceQuestion('Which of these is NOT part of the triple bottom line?', ['People', 'Planet', 'Profit', 'Politics'], [3]),
                    trueFalseQuestion('Sustainability is only about the environment.', false),
                    shortAnswerQuestion('What does TBL stand for?', ['Triple bottom line', 'The triple bottom line']),
                    openQuestion('Describe one change your workplace could make to reduce its environmental impact.', 'Names a specific practice (e.g. switching to LED lighting), explains its environmental benefit and says how the result would be measured.')
                  ]
                }
              },
              { type: 'youtube_video', title: 'Introductory video', content: 'https://www.youtube.com/watch?v=REPLACE_WITH_VIDEO_ID_1' },
              { type: 'youtube_video', title: 'The triple bottom line explained', content: 'https://www.youtube.com/watch?v=REPLACE_WITH_VIDEO_ID_2' },
              { type: 'google_drive_link', title: 'Lesson slides', content: 'https://docs.google.com/presentation/d/REPLACE_WITH_SLIDES_ID/view' },
              { type: 'notebook_link', title: 'Study notebook', content: 'https://notebooklm.google.com/notebook/REPLACE_WITH_NOTEBOOK_ID_1' }
            ]
          },
          {
            title: 'Systems thinking at work',
            estimatedMinutes: 90,
            blocks: [
              { type: 'text_description', title: 'Seeing the whole system', content: 'Systems thinking looks at how parts of an organisation interact. Map inputs, processes, outputs and feedback loops to find leverage points where small changes create large improvements.' },
              { type: 'google_drive_link', title: 'System mapping worksheet', content: 'https://drive.google.com/drive/folders/REPLACE_WITH_FOLDER_ID' },
              { type: 'google_drive_link', title: 'Case study pack', content: 'https://drive.google.com/file/d/REPLACE_WITH_FILE_ID/view' },
              { type: 'notebook_link', title: 'Systems thinking notebook', content: 'https://notebooklm.google.com/notebook/REPLACE_WITH_NOTEBOOK_ID_2' },
              { type: 'notebook_link', title: 'Revision notebook', content: 'https://notebooklm.google.com/notebook/REPLACE_WITH_NOTEBOOK_ID_3' }
            ]
          }
        ]
      },
      {
        unitCode: 'SBP502',
        unitTitle: 'Measuring & Reporting Environmental Impact',
        nominalHours: 50,
        description: 'Measures carbon and resource footprints and reports performance using ESG frameworks.',
        learningOutcomes: ['Calculate a basic carbon footprint', 'Prepare an ESG summary report'],
        lessons: [
          {
            title: 'Carbon footprint basics',
            estimatedMinutes: 60,
            blocks: [
              { type: 'text_description', title: 'Scopes 1, 2 and 3', content: 'Scope 1 covers direct emissions, Scope 2 purchased energy, and Scope 3 the wider value chain. Start with the data you can measure reliably, then expand.' },
              // A video between two blocks goes on the Content Blocks tab (Link URL column).
              { type: 'youtube_video', title: 'Emission scopes in 5 minutes', content: 'https://www.youtube.com/watch?v=REPLACE_WITH_VIDEO_ID_3' },
              { type: 'teacher_guide', title: 'Activity', content: 'Give each group one month of utility bills and have them calculate Scope 2 emissions using the current emission factors.' },
              {
                type: 'quiz',
                title: 'Emission scopes quiz',
                content: '',
                quiz: {
                  questions: [
                    choiceQuestion('Which of these are Scope 1 emissions? Select all that apply.', ['Fuel used in company vehicles', 'Purchased electricity', 'Gas burned in on-site boilers', 'Employee commuting'], [0, 2], 2),
                    trueFalseQuestion('Scope 3 covers the wider value chain.', true)
                  ]
                }
              },
              { type: 'google_drive_link', title: 'Utility bill dataset', content: 'https://docs.google.com/spreadsheets/d/REPLACE_WITH_SHEET_ID/view' }
            ]
          },
          {
            title: 'ESG reporting frameworks',
            estimatedMinutes: 60,
            blocks: [
              { type: 'text_description', title: 'Choosing a framework', content: 'Compare GRI, ISSB (IFRS S1/S2) and the Australian Sustainability Reporting Standards. Choose based on audience, mandatory requirements and data maturity.' }
            ]
          }
        ]
      }
    ],
    // One Assessments & Rubrics list for the whole course; unitIndex = the unit each task covers.
    assessments: [
      {
        title: 'Concepts Check',
        type: 'formative',
        description: 'Ten short questions on sustainability principles and the triple bottom line. Feedback only.',
        dueDate: '2026-02-27',
        nominalWeight: 10,
        externalSubmissionLinks: [],
        unitIndex: 0,
        rubric: [
          criterion('Understanding of key concepts', 50, FOUR_LEVELS, ['Defines few terms correctly.', 'Defines most terms correctly.', 'Defines and explains all terms.', 'Explains terms with insightful workplace examples.']),
          criterion('Application to examples', 30, FOUR_LEVELS, ['Examples are missing or incorrect.', 'Examples are relevant but brief.', 'Examples are relevant and explained.', 'Examples are original and well analysed.']),
          criterion('Written communication', 20, FOUR_LEVELS, ['Hard to follow.', 'Clear with some errors.', 'Clear and well organised.', 'Concise, precise and professional.'])
        ]
      },
      {
        title: 'Workplace Sustainability Audit',
        type: 'summative',
        description: 'Audit one process in your workplace (or a case study) and recommend three improvements with expected impact. 1,500 words plus a one-page system map.',
        dueDate: '2026-03-27',
        nominalWeight: 40,
        externalSubmissionLinks: [],
        unitIndex: 0,
        rubric: [
          criterion('Analysis of current practice', 40, FOUR_LEVELS, ['Describes the process with little analysis.', 'Identifies main impacts.', 'Analyses impacts using systems thinking.', 'Insightful analysis of root causes and feedback loops.']),
          criterion('Quality of recommendations', 30, FOUR_LEVELS, ['Recommendations are vague.', 'Recommendations are relevant.', 'Recommendations are specific and justified.', 'Recommendations are innovative, costed and prioritised.']),
          criterion('Use of evidence', 20, FOUR_LEVELS, ['Little evidence.', 'Some relevant evidence.', 'Well-chosen, cited evidence.', 'Comprehensive, critically evaluated evidence.']),
          criterion('Communication & system map', 10, FOUR_LEVELS, ['Unclear structure and map.', 'Clear structure; basic map.', 'Well structured; accurate map.', 'Professional report; insightful map.'])
        ]
      },
      {
        title: 'ESG Impact Report',
        type: 'summative',
        description: 'Prepare a 2,000-word ESG summary report for a real or case-study organisation, including a Scope 1 and 2 footprint and three targets.',
        dueDate: '2026-05-15',
        nominalWeight: 50,
        externalSubmissionLinks: [],
        unitIndex: 1,
        rubric: [
          criterion('Footprint calculation', 40, BANDS, ['Major errors.', 'Mostly correct with gaps.', 'Correct for Scopes 1 and 2.', 'Correct and well documented.', 'Correct, documented and sensitivity-tested.']),
          criterion('Framework alignment', 30, BANDS, ['No framework used.', 'Framework named but loosely applied.', 'Framework applied to most sections.', 'Framework applied consistently.', 'Framework applied with critical commentary.']),
          criterion('Targets & recommendations', 30, BANDS, ['No targets.', 'Targets are vague.', 'Targets are measurable.', 'Targets are measurable and time-bound.', 'Targets are SMART and linked to strategy.'])
        ]
      }
    ]
  };
  return finalizeCourseDraft(draft, { authorId: 'example', authorName: 'OzEdu', isDraft: true, status: 'draft' });
}

// ---------- downloads (browser only) ----------

export function downloadCourseTemplate() {
  return downloadFile(buildXlsxWorkbook(buildCourseWorkbookSheets(null)), 'OzEdu_Course_Template.xlsx');
}

export function downloadCourseExample() {
  return downloadFile(buildXlsxWorkbook(buildCourseWorkbookSheets(createExampleCourse())), 'OzEdu_Course_Example.xlsx');
}

export function downloadCourseExport(course) {
  return downloadFile(buildXlsxWorkbook(buildCourseWorkbookSheets(course)), `${safeFileStem(course?.title, 'OzEdu_Course')}_course.xlsx`);
}

export function downloadRubricWorkbook(assessment) {
  const sheets = buildRubricWorkbookSheets(assessment?.rubric || [], { assessmentTitle: assessment?.title || '' });
  return downloadFile(buildXlsxWorkbook(sheets), `${safeFileStem(assessment?.title, 'Assessment')}_rubric.xlsx`);
}
