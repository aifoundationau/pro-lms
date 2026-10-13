/**
 * Course Spreadsheet & ✨ AI Assist (Gemini) verification suite.
 * Run: node tests/courseSpreadsheet.test.js
 */

import assert from 'node:assert';
import * as XLSX from 'xlsx';
import { buildXlsxWorkbook, crc32, columnLetter } from '../src/services/xlsxWriter.js';
import { readSpreadsheetBytes, SpreadsheetReadError } from '../src/services/spreadsheetReader.js';
import {
  parseCourseSpreadsheet,
  finalizeCourseDraft,
  parseRubricSpreadsheet,
  finalizeRubricCriteria,
  hasSpreadsheetContent,
  RubricImportError,
  formatImportWarning
} from '../src/services/courseSpreadsheetImport.js';
import { buildCourseWorkbookSheets, buildRubricWorkbookSheets, createExampleCourse } from '../src/services/courseSpreadsheetTemplate.js';
import { parseDateCell, parseAqfLevel, parseStandards, parseBlockType, parseAssessmentType, detectHeaderRow } from '../src/services/courseSpreadsheetSchema.js';
import { mergeUnit, mergeRubric, mergeBlocks, buildCourseFromSpreadsheetWithAI } from '../src/services/courseSpreadsheetAiService.js';
import { sanitizeAiUnit, createUrlPolicy, normalizeRubricWeights, checkAiAssistBalance } from '../src/services/aiCourseShared.js';
import { generateGeminiJson, parseJsonFromModelText, GEMINI_ERROR } from '../src/services/geminiClient.js';
import { formatTokenBalance, resolvePrivileges, MAX_SUPERADMIN_GRANT } from '../src/services/rolePrivileges.js';
import { SAMPLE_SHEET_CSV } from '../src/services/geminiCourseService.js';
import { isGoogleNotebookUrl, CONTENT_BLOCK_TYPES } from '../src/types/courseBuilderTypes.js';

/** Reads CSV text the same way the browser upload does. */
function csvSheets(text, name = 'sheet.csv') {
  return readSpreadsheetBytes(XLSX, { name, bytes: new TextEncoder().encode(text) }).sheets;
}

function workbookSheets(sheetDefs, name = 'book.xlsx') {
  return readSpreadsheetBytes(XLSX, { name, bytes: buildXlsxWorkbook(sheetDefs) }).sheets;
}

function stripIds(value) {
  return JSON.parse(JSON.stringify(value, (key, v) => (key === 'id' || key === 'updatedAt' ? undefined : v)));
}

/** Fake Gemini REST endpoint: `respond(prompt, url)` returns the model JSON (or a Response-like object). */
function fakeGemini(respond) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const prompt = body.contents[0].parts[0].text;
    calls.push({ url, body, prompt });
    const out = await respond(prompt, url, body);
    if (out && out.__raw) return out.__raw;
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] }, finishReason: 'STOP' }] })
    };
  };
  return { fetchImpl, calls };
}

const httpError = (status, message, reason) => ({
  __raw: { ok: false, status, json: async () => ({ error: { code: status, message, details: reason ? [{ reason }] : [] } }) }
});

async function run() {
  console.log('🧪 Course Spreadsheet & ✨ AI Assist Test Suite\n');

  // 1. Writer produces a valid stored ZIP that SheetJS reads back
  const bytes = buildXlsxWorkbook([{ name: 'T', rows: [['a', 1, true], ['Café & <b>', '', 'line1\nline2']] }]);
  assert.deepStrictEqual(Array.from(bytes.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04], 'zip signature');
  assert.strictEqual(crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'CRC-32 check value');
  assert.strictEqual(columnLetter(0) + columnLetter(25) + columnLetter(26) + columnLetter(701), 'AZAAZZ');
  const back = workbookSheets([{ name: 'T', rows: [['a', 1], ['Café & <b>', 'line1\nline2']] }]);
  assert.deepStrictEqual(back[0].rows, [['a', '1'], ['Café & <b>', 'line1\nline2']]);
  console.log('✅ Test 1 Passed: dependency-free XLSX writer output is valid and readable.');

  // 2. A-to-Z round trip: every category of the worked example survives template -> upload
  const example = createExampleCourse();
  const roundSheets = workbookSheets(buildCourseWorkbookSheets(example), 'example.xlsx');
  const parsed = parseCourseSpreadsheet(roundSheets);
  assert.strictEqual(parsed.warnings.length, 0, parsed.warnings.map(formatImportWarning).join('\n'));
  assert.deepStrictEqual(parsed.skippedSheets, ['Instructions']);
  const rebuilt = finalizeCourseDraft(parsed.draft, {});
  const a = stripIds(example);
  const b = stripIds(rebuilt);
  for (const field of ['title', 'code', 'aqfLevel', 'category', 'year', 'startDate', 'token_cost', 'description', 'knowledge', 'curriculumStandards', 'aqfEquivalenceNotes', 'learningOutcomes', 'units']) {
    assert.deepStrictEqual(b[field], a[field], `round trip changed ${field}`);
  }
  const bands = rebuilt.units[1].assessments[0].rubric[0].levels.map(l => l.label);
  assert.strictEqual(bands.length, 5, '5-level rubric survives (repeated header row)');
  assert(rebuilt.units[0].lessons[0].blocks.some(blk => blk.type === 'notebook_link' && blk.metadata.notebookUrl.startsWith('https://notebooklm.google.com/')));
  console.log('✅ Test 2 Passed: worked example round-trips every course category A to Z.');

  // 3. Blank template has no content; export of a blank course is still valid
  const blank = parseCourseSpreadsheet(workbookSheets(buildCourseWorkbookSheets(null)));
  assert.strictEqual(hasSpreadsheetContent(blank), false);
  assert.strictEqual(blank.stats.units, 0);
  console.log('✅ Test 3 Passed: blank template imports as empty (nothing overwritten).');

  // 4. Rubric upload: unlimited criteria, % weights, 5 levels, trailing empty level trimmed
  const criteriaRows = Array.from({ length: 12 }, (_, i) => `"Criterion ${i + 1}",${i < 2 ? '15%' : '7%'},F${i},P${i},C${i},D${i},HD${i},`);
  const rubricCsv = ['Assessment Rubric — Essay', 'Criterion,Weight %,Fail,Pass,Credit,Distinction,High Distinction,Spare Level', ...criteriaRows].join('\n');
  const rubric12 = parseRubricSpreadsheet(csvSheets(rubricCsv, 'rubric.csv'));
  assert.strictEqual(rubric12.rubric.length, 12, 'any number of criterion rows');
  assert.deepStrictEqual(rubric12.levelLabels, ['Fail', 'Pass', 'Credit', 'Distinction', 'High Distinction'], 'unused trailing level dropped');
  assert.strictEqual(rubric12.rubric[0].weightPercentage, 15);
  assert.strictEqual(rubric12.rubric[0].levels[4].descriptor, 'HD0');
  assert.strictEqual(rubric12.rubric.reduce((s, c) => s + c.weightPercentage, 0), 100);
  console.log('✅ Test 4 Passed: rubric upload accepts unlimited Criterion & Weight rows.');

  // 5. Rubric variants: combined "Criterion & Weight", fractional weights, descending levels, blank weights
  const combined = parseRubricSpreadsheet(csvSheets('Criterion & Weight,Advanced (90-100%),Novice (0-49%)\nResearch quality (30%),Excellent,Weak\nAnalysis - 70%,Deep,Shallow'));
  assert.deepStrictEqual(combined.rubric.map(c => [c.criterionTitle, c.weightPercentage]), [['Research quality', 30], ['Analysis', 70]]);
  assert(combined.rubric[0].levels[0].points > combined.rubric[0].levels[1].points, 'descending labels get descending points');
  const fractional = parseRubricSpreadsheet(csvSheets('Criterion,Weight\nA,0.25\nB,0.75'));
  assert.deepStrictEqual(fractional.rubric.map(c => c.weightPercentage), [25, 75]);
  const unweighted = finalizeRubricCriteria([{ criterionTitle: 'A' }, { criterionTitle: 'B' }, { criterionTitle: 'C' }]);
  assert.deepStrictEqual(unweighted.map(c => c.weightPercentage), [34, 33, 33], 'blank weights share 100');
  assert.throws(() => parseRubricSpreadsheet(csvSheets('Name,Email\nA,a@b.c')), RubricImportError);
  const twoRubrics = 'Unit Code,Assessment #,Criterion,Weight %,Low,High\nU1,Essay,Thesis,50,x,y\n,,Evidence,50,x,y\nU1,Quiz,Accuracy,100,x,y';
  assert.throws(() => parseRubricSpreadsheet(csvSheets(twoRubrics)), RubricImportError, 'ambiguous multi-rubric file');
  assert.strictEqual(parseRubricSpreadsheet(csvSheets(twoRubrics), { assessmentTitle: 'Essay' }).rubric.length, 2, 'picks rubric by assessment title');
  console.log('✅ Test 5 Passed: rubric variants (combined column, fractions, level order, blanks, multi-rubric files).');

  // 6. Legacy single-CSV layout (several tables in one tab) still imports
  const legacy = parseCourseSpreadsheet(csvSheets(SAMPLE_SHEET_CSV, 'Marine.csv'));
  assert.strictEqual(legacy.draft.course.title, 'Marine Biology & Ocean Conservation');
  assert.strictEqual(legacy.draft.course.startDate, '2026-03-02');
  assert.strictEqual(legacy.draft.course.learningOutcomes.length, 3);
  assert.strictEqual(legacy.stats.assessments, 3);
  const legacyCriteria = legacy.draft.units[0].assessments[0].rubric.map(c => [c.criterionTitle, c.weightPercentage]);
  assert.deepStrictEqual(legacyCriteria, [['Clarity of data', 30], ['Ecological analysis', 40], ['Conservation recommendations', 30]]);
  assert(legacy.unstructuredText.includes('Week 1: Ocean Chemistry'), 'weekly rows are kept for ✨ AI Assist');
  assert(hasSpreadsheetContent(legacy));
  console.log('✅ Test 6 Passed: legacy one-tab CSV layout imports, unmapped rows go to AI Assist.');

  // 7. Teacher layouts: fill-down, auto-created units, duplicates, unsafe links, hyperlinks, dates
  const custom = parseCourseSpreadsheet([
    { name: 'Course', rows: [['Course Title', 'Bio 101'], ['Level', 'Diploma'], ['Start Date', '9/2/2026'], ['Curriculum Standards', 'TEQSA, Klingon'], ['Enrolment Cost', 'Free']] },
    { name: 'Units', rows: [['Unit Code', 'Unit Title', 'Hours'], ['B1', 'Cells', '20'], ['B1', 'Duplicate', '5'], ['B2', 'Genes', 'lots']] },
    { name: 'Lessons', rows: [['Unit Code', 'Lesson #', 'Lesson Title', 'Duration'], ['B1', '1', 'Cell walls', '60'], ['', '2', 'Membranes', '45'], ['B9', '1', 'Orphan', '30']] },
    {
      name: 'Content Blocks',
      rows: [
        ['Unit Code', 'Lesson #', 'Block Type', 'Block Title', 'Content or Link URL'],
        ['B1', '1', 'Content Description', 'Intro', 'Cells are...'],
        ['B1', '', 'YouTube Video', 'Watch', 'Watch this video'],
        ['B1', '2', 'Google Drive Resource', 'Bad', 'javascript:alert(1)'],
        ['B1', '2', 'Notebook', 'Notes', 'https://notebooklm.google.com/notebook/abc']
      ],
      links: { '2,4': 'https://www.youtube.com/watch?v=xyz123' }
    }
  ]);
  const c7 = custom.draft.course;
  assert.strictEqual(c7.aqfLevel, 5);
  assert.strictEqual(c7.startDate, '2026-02-09', 'Australian day-first dates');
  assert.deepStrictEqual(c7.curriculumStandards, ['teqsa']);
  assert.strictEqual(c7.token_cost, 0);
  const warnText = custom.warnings.map(formatImportWarning).join('\n');
  assert(warnText.includes('Klingon'), 'unknown standard warned');
  assert(warnText.includes('used more than once'), 'duplicate unit code warned');
  assert(warnText.includes('Nominal Hours "lots"'), 'bad hours warned');
  assert(warnText.includes('Unit "B9" is not on the Units tab'), 'missing unit auto-created');
  assert(warnText.includes('unsafe scheme'), 'javascript: link removed');
  const b1 = custom.draft.units.find(u => u.unitCode === 'B1');
  assert.deepStrictEqual(b1.lessons.map(l => l.title), ['Cell walls', 'Membranes'], 'blank unit reference fills down');
  assert.strictEqual(b1.lessons[0].blocks[1].content, 'https://www.youtube.com/watch?v=xyz123', 'hyperlink target used for link blocks; lesson # fills down');
  assert.strictEqual(b1.lessons[1].blocks[0].content, '', 'unsafe link stripped');
  const finalCustom = finalizeCourseDraft(custom.draft, { title: 'Old', units: [{ id: 'keep' }], authorId: 'me' });
  assert.strictEqual(finalCustom.authorId, 'me', 'identity of the base course is kept');
  assert.strictEqual(finalCustom.units.length, 3);
  assert.strictEqual(finalCustom.units[0].lessons[0].blocks[1].metadata.youtubeUrl, 'https://www.youtube.com/watch?v=xyz123');
  console.log('✅ Test 7 Passed: fill-down, auto-created units, warnings, unsafe-link removal, hyperlinks, AU dates.');

  // 8. Value parsers & header detection
  assert.strictEqual(parseDateCell('2026-02-30'), undefined, 'impossible date rejected');
  assert.strictEqual(parseDateCell('3 March 2026'), '2026-03-03');
  assert.strictEqual(parseDateCell('March 3, 2026'), '2026-03-03');
  assert.strictEqual(parseDateCell('12/31/2026'), '2026-12-31', 'unambiguous US date');
  assert.strictEqual(parseDateCell('46083'), '2026-03-02', 'Excel serial');
  assert.strictEqual(parseAqfLevel('Certificate IV').value, 4);
  assert.strictEqual(parseAqfLevel('Graduate Diploma').value, 8);
  assert.strictEqual(parseAqfLevel('Level 12').error !== undefined, true);
  assert.deepStrictEqual(parseStandards('None').ids, []);
  assert.deepStrictEqual(parseStandards('UK QAA / FHEQ; aacsb').ids, ['aacsb', 'uk_qaa']);
  assert.strictEqual(parseBlockType('Teacher notes').type, 'teacher_guide');
  assert.strictEqual(parseBlockType('NotebookLM').type, 'notebook_link');
  assert.strictEqual(parseAssessmentType('Final exam'), 'summative');
  assert.strictEqual(detectHeaderRow(['Name', 'Email']), null, 'a roster header is not a course table');
  assert.strictEqual(detectHeaderRow(['Unit Code', 'Assessment #', 'Criterion', 'Weight %', 'Task Not Attempted']).match.map.assessmentRef, 1);
  console.log('✅ Test 8 Passed: date, level, standards, type parsers and header detection.');

  // 9. Notebook block & disabled file attachments
  assert(isGoogleNotebookUrl('https://notebooklm.google.com/notebook/1'));
  assert(isGoogleNotebookUrl('https://notebook.google.com/x'));
  assert(!isGoogleNotebookUrl('http://notebooklm.google.com/notebook/1'), 'https only');
  assert(!isGoogleNotebookUrl('https://evil.example.com/notebooklm.google.com'));
  assert.strictEqual(CONTENT_BLOCK_TYPES.find(t => t.type === 'file_upload').disabled, true);
  assert.strictEqual(CONTENT_BLOCK_TYPES.find(t => t.type === 'notebook_link').label, 'Gemini Notebook');
  assert.strictEqual(parseBlockType('Gemini Notebook').type, 'notebook_link');
  console.log('✅ Test 9 Passed: Gemini Notebook block validates links; Direct File Attachment disabled.');

  // 10. Merge rules: teacher values win, blanks are filled, invented links never survive
  const policy = createUrlPolicy(['https://youtu.be/teacher']);
  const teacherUnit = {
    unitCode: 'B1', unitTitle: 'Cells', nominalHours: null, description: '', learningOutcomes: [],
    lessons: [{ title: 'Cell walls', estimatedMinutes: null, blocks: [{ type: 'youtube_video', title: '', content: 'https://youtu.be/teacher' }] }],
    assessments: [{ title: 'Quiz', type: '', description: '', dueDate: '', nominalWeight: 40, externalSubmissionLinks: [], rubric: [
      { criterionTitle: 'Accuracy', weightPercentage: 60, levels: [{ label: 'Low', descriptor: 'Teacher low' }, { label: 'High', descriptor: '' }] }
    ] }]
  };
  const aiUnit = sanitizeAiUnit({
    unitCode: 'CHANGED', unitTitle: 'Changed title', nominalHours: 30, description: 'AI description',
    learningOutcomes: ['Explain cells'],
    lessons: [
      { title: 'AI renamed', estimatedMinutes: 50, blocks: [
        { type: 'youtube_video', title: 'AI video', content: 'https://youtu.be/teacher' },
        { type: 'youtube_video', title: 'Invented', content: 'https://youtube.com/watch?v=invented' },
        { type: 'text_description', title: 'Reading', content: 'Read https://made-up.example.com/deep/link today.' },
        { type: 'teacher_guide', title: 'Guide', content: 'Discuss.' }
      ] },
      { title: 'Extra AI lesson', estimatedMinutes: 30, blocks: [] }
    ],
    assessments: [{ title: 'Quiz', type: 'formative', description: 'AI brief', dueDate: '2026-13-01', nominalWeight: 99, rubric: [
      { criterionTitle: 'Accuracy', weightPercentage: 10, levels: [{ label: 'Low', descriptor: 'AI low' }, { label: 'High', descriptor: 'AI high' }] }
    ] }]
  }, { isUrlAllowed: policy });
  const merged = mergeUnit(teacherUnit, aiUnit);
  assert.strictEqual(merged.unitCode, 'B1');
  assert.strictEqual(merged.unitTitle, 'Cells');
  assert.strictEqual(merged.nominalHours, 30);
  assert.strictEqual(merged.description, 'AI description');
  assert.strictEqual(merged.lessons.length, 1, 'teacher lesson structure kept (no extra AI lessons)');
  assert.strictEqual(merged.lessons[0].title, 'Cell walls');
  assert.strictEqual(merged.lessons[0].blocks[0].title, 'AI video', 'blank block title filled');
  assert(!JSON.stringify(merged).includes('invented'), 'invented YouTube link dropped');
  assert(!JSON.stringify(merged).includes('https://made-up.example.com'), 'invented deep link removed from text');
  assert.deepStrictEqual(merged.lessons[0].blocks.map(x => x.type), ['youtube_video', 'text_description', 'teacher_guide'], 'missing block types added once');
  const mergedQuiz = merged.assessments[0];
  assert.strictEqual(mergedQuiz.nominalWeight, 40);
  assert.strictEqual(mergedQuiz.type, 'formative');
  assert.strictEqual(mergedQuiz.dueDate, '', 'invalid AI date rejected');
  assert.deepStrictEqual(mergedQuiz.rubric[0].levels.map(l => l.descriptor), ['Teacher low', 'AI high']);
  assert.strictEqual(mergedQuiz.rubric[0].weightPercentage, 60);
  assert.deepStrictEqual(mergeBlocks([], [{ type: 'text_description', title: 'a', content: 'x' }, { type: 'text_description', title: 'b', content: 'y' }]).length, 2);
  assert.deepStrictEqual(normalizeRubricWeights([{ weightPercentage: 1 }, { weightPercentage: 1 }, { weightPercentage: 1 }]).map(c => c.weightPercentage), [34, 33, 33]);
  assert.strictEqual(mergeRubric([], [{ criterionTitle: 'X', weightPercentage: 50, levels: [] }])[0].weightPercentage, 100);
  console.log('✅ Test 10 Passed: Gemini merge keeps teacher values & structure; invented links never survive.');

  // 11. Gemini client: fallback chain, schema simplification, fatal key errors, truncation, fences, abort
  assert.deepStrictEqual(parseJsonFromModelText('```json\n{"a":1}\n```'), { a: 1 });
  const models = [{ id: 'm1', thinking: { thinkingLevel: 'low' } }, { id: 'm2', thinking: null }];
  let fg = fakeGemini((prompt, url) => (url.includes('/m1:') ? httpError(404, 'model not found') : { ok: 1 }));
  let res = await generateGeminiJson({ prompt: 'p', apiKey: 'k', models, fetchImpl: fg.fetchImpl, retryDelayMs: 1 });
  assert.strictEqual(res.model, 'm2', '404 falls back to the next model');
  fg = fakeGemini((prompt, url, body) => (body.generationConfig.responseJsonSchema ? httpError(400, 'Invalid JSON schema') : { ok: 2 }));
  res = await generateGeminiJson({ prompt: 'p', apiKey: 'k', models, responseJsonSchema: { type: 'object' }, fetchImpl: fg.fetchImpl, retryDelayMs: 1 });
  assert.strictEqual(res.model, 'm1');
  assert.strictEqual(fg.calls.length, 2, '400 retried once without schema/thinking');
  assert.strictEqual(fg.calls[0].body.generationConfig.thinkingConfig.thinkingLevel, 'low');
  assert.strictEqual(fg.calls[0].body.generationConfig.temperature, undefined, 'no deprecated sampling params');
  fg = fakeGemini(() => httpError(400, 'API key not valid. Please pass a valid API key.', 'API_KEY_INVALID'));
  await assert.rejects(generateGeminiJson({ prompt: 'p', apiKey: 'bad', models, fetchImpl: fg.fetchImpl, retryDelayMs: 1 }), e => e.code === GEMINI_ERROR.AUTH);
  assert.strictEqual(fg.calls.length, 1, 'invalid key fails fast');
  fg = fakeGemini((prompt, url) => (url.includes('/m1:')
    ? { __raw: { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"cut": "of' }] }, finishReason: 'MAX_TOKENS' }] }) } }
    : { whole: true }));
  res = await generateGeminiJson({ prompt: 'p', apiKey: 'k', models, fetchImpl: fg.fetchImpl, retryDelayMs: 1 });
  assert.deepStrictEqual(res.data, { whole: true }, 'truncated JSON falls back to the next model');
  await assert.rejects(generateGeminiJson({ prompt: 'p', apiKey: '', models }), e => e.code === GEMINI_ERROR.NO_KEY);
  const controller = new AbortController();
  fg = fakeGemini(() => new Promise(() => {}));
  const pending = generateGeminiJson({ prompt: 'p', apiKey: 'k', models, fetchImpl: (u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))), signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, e => e.code === GEMINI_ERROR.ABORTED);
  console.log('✅ Test 11 Passed: Gemini client fallback, retry, fail-fast, truncation and cancellation.');

  // 12. Full ✨ AI Assist build from spreadsheets (stubbed Gemini; Super Admin = UNL, no charge)
  const superadmin = { uid: 'sa', email: 'support@aifoundation.net.au', role: 'Superadmin' };
  assert.strictEqual((await checkAiAssistBalance({ currentUser: { uid: 'sa' }, userProfile: superadmin, costTokens: 10 })).cost, 0);
  const aiSheets = csvSheets(SAMPLE_SHEET_CSV, 'Marine.csv');
  const aiParsed = parseCourseSpreadsheet(aiSheets);
  const progress = [];
  fg = fakeGemini((prompt) => {
    if (prompt.includes('Plan the course outline')) {
      return { title: 'IGNORED', code: 'MAR-AI', category: 'Science', description: 'IGNORED', aqfEquivalenceNotes: 'Equivalent notes', learningOutcomes: ['ignored'], units: [] };
    }
    assert(prompt.includes('Build out ONE unit'));
    assert(prompt.includes('Week 1: Ocean Chemistry'), 'unmapped weekly rows reach the unit prompt');
    return {
      unitCode: 'MAR1', unitTitle: 'Ocean Systems', nominalHours: 40, description: 'Ocean chemistry, reefs and deep sea.', learningOutcomes: ['Explain ocean chemistry'],
      lessons: [{ title: 'Week 1: Ocean Chemistry & Currents', estimatedMinutes: 60, blocks: [
        { type: 'text_description', title: 'Salinity', content: 'Seawater averages 3.5% salinity.' },
        { type: 'google_drive_link', title: 'Slides', content: 'https://slides.example.com/week1' },
        { type: 'youtube_video', title: 'Made up', content: 'https://www.youtube.com/watch?v=fake' }
      ] }],
      assessments: [
        { title: 'Field Investigation Report', type: 'summative', description: 'AI brief', dueDate: '', nominalWeight: 50, rubric: [] },
        { title: 'Mid-Semester Marine Quiz', type: 'formative', description: '', dueDate: '', nominalWeight: 25, rubric: [{ criterionTitle: 'Accuracy', weightPercentage: 100, levels: [{ label: 'Novice (0-49%)', descriptor: 'n' }, { label: 'Advanced (90-100%)', descriptor: 'a' }] }] },
        { title: 'Policy Brief Short Answers', type: 'formative', description: '', dueDate: '', nominalWeight: 25, rubric: [] }
      ]
    };
  });
  const built = await buildCourseFromSpreadsheetWithAI({
    currentUser: { uid: 'sa', displayName: 'Admin' },
    userProfile: superadmin,
    parsed: aiParsed,
    baseCourse: { id: 'course_1', authorId: 'sa', units: [] },
    targetAqfLevel: 4,
    apiKey: 'test-key',
    models: [{ id: 'test-model', thinking: null }],
    fetchImpl: fg.fetchImpl,
    onProgress: p => progress.push(p.stage)
  });
  assert.strictEqual(built.tokensCharged, 0);
  assert.strictEqual(built.superadminPass, true);
  assert(built.message.includes('Super Admin (UNL)'));
  assert.strictEqual(built.course.id, 'course_1');
  assert.strictEqual(built.course.title, 'Marine Biology & Ocean Conservation', 'teacher title kept over AI');
  assert.strictEqual(built.course.code, 'MAR-AI', 'blank code filled by AI');
  assert.strictEqual(built.course.units.length, 1);
  const builtUnit = built.course.units[0];
  assert.strictEqual(builtUnit.unitTitle, 'Ocean Systems', 'auto-created unit filled by AI');
  assert(builtUnit.lessons[0].blocks.some(x => x.type === 'google_drive_link' && x.metadata.driveUrl === 'https://slides.example.com/week1'), 'link from the spreadsheet allowed');
  assert(!JSON.stringify(built.course).includes('watch?v=fake'), 'invented video dropped');
  const fieldReport = builtUnit.assessments.find(x => x.title === 'Field Investigation Report');
  assert.deepStrictEqual(fieldReport.rubric.map(c => c.criterionTitle), ['Clarity of data', 'Ecological analysis', 'Conservation recommendations'], 'teacher rubric criteria kept');
  assert.strictEqual(fieldReport.dueDate, '2026-04-10', 'teacher due date kept');
  assert(progress.includes('outline') && progress.includes('units') && progress.includes('finalizing'));
  console.log('✅ Test 12 Passed: Gemini builds the whole course from spreadsheets; teacher data and links protected.');

  // 13. Gemini down -> clear error, nothing charged; Super Admin shows UNL tokens
  fg = fakeGemini(() => httpError(503, 'overloaded'));
  await assert.rejects(buildCourseFromSpreadsheetWithAI({
    currentUser: { uid: 'sa' }, userProfile: superadmin, parsed: aiParsed, apiKey: 'k',
    models: [{ id: 'm', thinking: null }], fetchImpl: fg.fetchImpl
  }), e => e.code === 'AI_ASSIST_UNAVAILABLE' && /No tokens were charged/.test(e.message));
  assert.strictEqual(formatTokenBalance(5, superadmin), 'UNL');
  assert.strictEqual(formatTokenBalance(42.9, { role: 'teacher' }), '42');
  assert.strictEqual(resolvePrivileges({ email: 'SUPPORT@aifoundation.net.au' }).isSuperadmin, true);
  assert.strictEqual(MAX_SUPERADMIN_GRANT, 999);
  console.log('✅ Test 13 Passed: AI outage stops cleanly with no charge; Super Admin balance shows UNL.');

  // 14. Reader rejects non-spreadsheets with clear messages
  assert.throws(() => readSpreadsheetBytes(XLSX, { name: 'x.xlsx', bytes: new TextEncoder().encode('not a zip') }), SpreadsheetReadError);
  assert.throws(() => readSpreadsheetBytes(XLSX, { name: 'x.pdf', bytes: new Uint8Array([37, 80, 68, 70]) }), SpreadsheetReadError);
  const win1252 = readSpreadsheetBytes(XLSX, { name: 'w.csv', bytes: new Uint8Array([0x43, 0x61, 0x66, 0xe9]) }).sheets[0].rows[0][0];
  assert.strictEqual(win1252, 'Café', 'Windows-1252 CSV decoded');
  const rubricBook = workbookSheets(buildRubricWorkbookSheets(example.units[1].assessments[0].rubric, { assessmentTitle: 'ESG' }));
  assert.strictEqual(parseRubricSpreadsheet(rubricBook).rubric.length, 3, 'downloaded rubric re-uploads');
  console.log('✅ Test 14 Passed: reader validation, encodings, and rubric download/upload round trip.');

  // 15. Lessons tab: any number of YouTube / Google Drive / Gemini Notebook links per lesson
  const linkSheets = [
    { name: 'Units', rows: [['Unit Code', 'Unit Title', 'Nominal Hours'], ['L1', 'Links unit', '10']] },
    {
      name: 'Lessons',
      rows: [
        ['Unit Code', 'Lesson #', 'Lesson Title', 'Duration (minutes)', 'YouTube Video Links', 'Google Drive Resource Links', 'Gemini Notebook Links'],
        ['L1', '1', 'First', '60',
          'Intro | https://www.youtube.com/watch?v=aaaaaaaaaaa\nhttps://youtu.be/bbbbbbbbbbb',
          'Slides - https://docs.google.com/presentation/d/s1/view\nWorksheet: https://drive.google.com/file/d/w1/view',
          'Study notebook | https://notebooklm.google.com/notebook/n1\nhttps://notebooklm.google.com/notebook/n2'],
        ['', '', '', '', 'Extra video | https://youtu.be/ccccccccccc', '', ''],
        ['L1', '1', '', '', '', '', 'Third notebook | https://notebooklm.google.com/notebook/n3'],
        ['L1', '2', 'Second', '45', 'not a link', 'Week 2 pack', 'https://example.com/fake-notebook']
      ],
      links: { '4,5': 'https://drive.google.com/drive/folders/f2' }
    },
    {
      name: 'Content Blocks',
      rows: [
        ['Unit Code', 'Lesson #', 'Block #', 'Block Type', 'Block Title', 'Text', 'Link URL'],
        ['L1', '1', '1', 'Content Description', 'Overview', 'Read this first.', ''],
        ['L1', '1', '2', 'YouTube Video', 'Welcome', '', 'https://youtu.be/ddddddddddd'],
        ['L1', '2', '1', '', 'Auto typed', '', 'https://notebooklm.google.com/notebook/n4'],
        ['L1', '2', '2', 'Google Drive Resource', '', '', 'A | https://drive.google.com/file/d/a/view\nB | https://drive.google.com/file/d/b/view'],
        ['L1', '2', '3', 'YouTube Video', 'With notes', 'Watch before class.', 'https://youtu.be/eeeeeeeeeee'],
        ['L1', '2', '4', 'Content Description', 'Text + link', 'See also', 'https://example.org/page']
      ]
    }
  ];
  const linked = parseCourseSpreadsheet(linkSheets);
  const [first, second] = linked.draft.units[0].lessons;
  assert.strictEqual(linked.draft.units[0].lessons.length, 2, 'continuation rows do not create lessons');
  assert.deepStrictEqual(first.blocks.map(x => [x.type, x.title, x.content]), [
    ['text_description', 'Overview', 'Read this first.'],
    ['youtube_video', 'Welcome', 'https://youtu.be/ddddddddddd'],
    ['youtube_video', 'Intro', 'https://www.youtube.com/watch?v=aaaaaaaaaaa'],
    ['youtube_video', '', 'https://youtu.be/bbbbbbbbbbb'],
    ['youtube_video', 'Extra video', 'https://youtu.be/ccccccccccc'],
    ['google_drive_link', 'Slides', 'https://docs.google.com/presentation/d/s1/view'],
    ['google_drive_link', 'Worksheet', 'https://drive.google.com/file/d/w1/view'],
    ['notebook_link', 'Study notebook', 'https://notebooklm.google.com/notebook/n1'],
    ['notebook_link', '', 'https://notebooklm.google.com/notebook/n2'],
    ['notebook_link', 'Third notebook', 'https://notebooklm.google.com/notebook/n3']
  ], 'Content Blocks rows first, then every lesson link as its own block (videos, Drive, notebooks)');
  assert.deepStrictEqual(second.blocks.map(x => [x.type, x.title, x.content]), [
    ['notebook_link', 'Auto typed', 'https://notebooklm.google.com/notebook/n4'],
    ['google_drive_link', 'A', 'https://drive.google.com/file/d/a/view'],
    ['google_drive_link', 'B', 'https://drive.google.com/file/d/b/view'],
    ['text_description', 'With notes', 'Watch before class.'],
    ['youtube_video', 'With notes', 'https://youtu.be/eeeeeeeeeee'],
    ['text_description', 'Text + link', 'See also\nhttps://example.org/page'],
    ['google_drive_link', 'Week 2 pack', 'https://drive.google.com/drive/folders/f2'],
    ['notebook_link', '', 'https://example.com/fake-notebook']
  ], 'blank Block Type inferred, several links in one Link URL cell, text beside a link kept, hyperlinked cell used');
  const linkWarnings = linked.warnings.map(formatImportWarning).join('\n');
  assert(linkWarnings.includes('Lessons row 5: "not a link" in YouTube Video Links has no https:// link'), linkWarnings);
  assert(linkWarnings.includes('does not look like a Gemini Notebook link'), linkWarnings);
  assert(linkWarnings.includes('was added as a Content Description block above it'), linkWarnings);
  assert(linkWarnings.includes('Content Description blocks do not use Link URL'), linkWarnings);
  assert(!linkWarnings.includes('appears twice'), 'repeating a Lesson # to add links is not a duplicate');
  const linkedCourse = finalizeCourseDraft(linked.draft, {});
  const finalFirst = linkedCourse.units[0].lessons[0].blocks;
  assert.strictEqual(finalFirst.filter(x => x.type === 'youtube_video').length, 4);
  assert.strictEqual(finalFirst[3].metadata.youtubeUrl, 'https://youtu.be/bbbbbbbbbbb', 'each link block keeps its own URL');
  assert.strictEqual(new Set(linkedCourse.units[0].lessons.flatMap(l => l.blocks.map(x => x.id))).size, 18, 'every imported block has a unique id');
  assert(['https://youtu.be/ccccccccccc', 'https://drive.google.com/drive/folders/f2'].every(u => linked.sourceUrls.includes(u)), 'lesson links reach the ✨ AI link allow-list');
  // Limit: 40 blocks per lesson, extra links are reported
  const manyLinks = Array.from({ length: 45 }, (_, i) => `https://youtu.be/v${String(i).padStart(10, '0')}`).join('\n');
  const capped = parseCourseSpreadsheet([{ name: 'Lessons', rows: [linkSheets[1].rows[0], ['L1', '1', 'Many', '30', manyLinks, '', '']] }]);
  assert.strictEqual(capped.draft.units[0].lessons[0].blocks.length, 40);
  assert(capped.warnings.some(w => /link\(s\) were not added/.test(w.message)), 'over-limit links are reported');
  console.log('✅ Test 15 Passed: several YouTube / Google Drive / Gemini Notebook links per lesson, each its own block.');

  // 16. Exports keep every link and its position; CSV uploads with multi-line link cells work
  const tricky = finalizeCourseDraft({
    course: { title: 'Links', learningOutcomes: [] },
    units: [{
      unitCode: 'X1', unitTitle: 'Unit', nominalHours: 5, description: '', learningOutcomes: [], assessments: [],
      lessons: [{
        title: 'Mixed', estimatedMinutes: 30, blocks: [
          { type: 'youtube_video', title: 'A | B', content: 'https://youtu.be/aaaaaaaaaaa' },
          { type: 'text_description', title: 'Between', content: 'https://example.com/plain-text-url' },
          { type: 'google_drive_link', title: '', content: 'https://drive.google.com/file/d/1/view' },
          { type: 'youtube_video', title: '1. Numbered', content: 'https://youtu.be/bbbbbbbbbbb' },
          { type: 'notebook_link', title: 'Notebook', content: 'https://notebooklm.google.com/notebook/1' },
          { type: 'youtube_video', title: 'Tail video', content: 'https://en.wikipedia.org/wiki/Coral_(film)' },
          { type: 'google_drive_link', title: 'Tail drive', content: 'https://docs.google.com/document/d/2/edit.' },
          { type: 'notebook_link', title: '', content: 'https://notebooklm.google.com/notebook/2' },
          { type: 'notebook_link', title: 'Last', content: 'https://notebooklm.google.com/notebook/3' }
        ]
      }]
    }]
  });
  const trickyBook = buildCourseWorkbookSheets(tricky);
  const lessonCells = trickyBook.find(s => s.name === 'Lessons').rows[1];
  assert.deepStrictEqual(lessonCells.slice(4), [
    'Tail video | https://en.wikipedia.org/wiki/Coral_(film)',
    'Tail drive | https://docs.google.com/document/d/2/edit.',
    'https://notebooklm.google.com/notebook/2\nLast | https://notebooklm.google.com/notebook/3'
  ], 'trailing links go to the Lessons link columns, exactly as typed');
  assert.strictEqual(trickyBook.find(s => s.name === 'Content Blocks').rows.length, 6, 'the other 5 blocks stay on Content Blocks');
  const trickyBack = finalizeCourseDraft(parseCourseSpreadsheet(workbookSheets(trickyBook)).draft, {});
  assert.deepStrictEqual(stripIds(trickyBack.units), stripIds(tricky.units), 'export -> upload keeps every block, title, link and position');
  const csvUpload = parseCourseSpreadsheet(csvSheets([
    'Unit Code,Lesson #,Lesson Title,Duration (minutes),YouTube Video Links,Google Drive Resource Links,Gemini Notebook Links',
    'C1,1,From CSV,30,"Part 1 | https://youtu.be/aaaaaaaaaaa',
    'Part 2 | https://youtu.be/bbbbbbbbbbb",https://drive.google.com/file/d/c/view,"https://notebooklm.google.com/notebook/c1',
    'https://notebooklm.google.com/notebook/c2"'
  ].join('\r\n'), 'Lessons.csv'));
  assert.deepStrictEqual(csvUpload.draft.units[0].lessons[0].blocks.map(x => x.title || x.type), ['Part 1', 'Part 2', 'google_drive_link', 'notebook_link', 'notebook_link']);
  console.log('✅ Test 16 Passed: exports keep every link in place; CSV multi-line link cells import.');

  // 17. ✨ AI merge with several links of one type: each teacher link keeps its own URL and only its own title
  const twoVideos = mergeBlocks(
    [{ type: 'youtube_video', title: '', content: 'https://youtu.be/one' }, { type: 'youtube_video', title: '', content: 'https://youtu.be/two' }],
    [{ type: 'youtube_video', title: 'Second video', content: 'https://youtu.be/two' }, { type: 'youtube_video', title: 'First video', content: 'https://youtu.be/one/' }]
  );
  assert.deepStrictEqual(twoVideos.map(x => [x.title, x.content]), [['First video', 'https://youtu.be/one'], ['Second video', 'https://youtu.be/two']]);
  const unmatched = mergeBlocks([{ type: 'google_drive_link', title: '', content: 'https://drive.google.com/file/d/mine/view' }], [{ type: 'google_drive_link', title: 'Other file', content: 'https://drive.google.com/file/d/other/view' }]);
  assert.deepStrictEqual(unmatched.map(x => [x.title, x.content]), [['', 'https://drive.google.com/file/d/mine/view']], 'no title from a different link');
  console.log('✅ Test 17 Passed: ✨ AI merge pairs link blocks by URL, so multiple links keep the right titles.');

  console.log('\n🎉 All Course Spreadsheet & ✨ AI Assist tests passed (17/17).');
}

run().then(() => process.exit(0)).catch(err => {
  console.error('❌ Test failure:', err);
  process.exit(1);
});
