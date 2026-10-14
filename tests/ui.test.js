/**
 * UI interaction tests: real React components in jsdom, loaded through Vite (JSX, ?raw imports).
 * Firebase is replaced by an offline stub, so every screen also proves its graceful-degradation
 * path, and no .env keys are loaded (no network calls to Gemini or Firestore).
 * Run: node tests/ui.test.js
 */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

// ---------- browser globals (before React DOM loads) ----------
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
for (const key of ['HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'Node', 'Element', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'sessionStorage', 'MutationObserver', 'DOMParser', 'Image']) {
  if (window[key] !== undefined) globalThis[key] = window[key];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.HTMLElement.prototype.scrollIntoView = () => {};
window.confirm = () => true;
window.alert = () => {};

const { createServer } = await import('vite');
const react = (await import('@vitejs/plugin-react')).default;
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');

const root = fileURLToPath(new URL('..', import.meta.url));
const servers = [];
async function makeServer(extraAliases = []) {
  const server = await createServer({
    root,
    configFile: false,
    envDir: fileURLToPath(new URL('./fixtures/', import.meta.url)), // no .env => no real keys
    logLevel: 'error',
    appType: 'custom',
    cacheDir: join(tmpdir(), 'ozedu-ui-test-vite'), // never touch the dev server's cache
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    plugins: [react()],
    resolve: {
      alias: [
        { find: /^(\.\.?\/)+firebase(\.js)?$/, replacement: fileURLToPath(new URL('./fixtures/firebaseStub.js', import.meta.url)) },
        ...extraAliases
      ]
    }
  });
  servers.push(server);
  return server;
}
const vite = await makeServer();
const load = async (path) => (await vite.ssrLoadModule(path));

// ---------- helpers ----------
async function render(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const reactRoot = createRoot(container);
  await act(async () => reactRoot.render(element));
  return {
    container,
    rerender: async (el) => act(async () => reactRoot.render(el)),
    unmount: async () => {
      await act(async () => reactRoot.unmount());
      container.remove();
    }
  };
}

async function click(el) {
  assert(el, 'element to click exists');
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function type(el, value) {
  assert(el, 'element to type into exists');
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype
    : el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
}

async function submit(form) {
  await act(async () => {
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  });
}

async function upload(input, files) {
  assert(input, 'file input exists');
  await act(async () => {
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}

async function waitFor(check, label, timeout = 8000) {
  const start = Date.now();
  for (;;) {
    let value;
    try {
      value = check();
    } catch {
      value = null;
    }
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for: ${label}`);
    await act(async () => {
      await new Promise(r => setTimeout(r, 30));
    });
  }
}

const buttons = (scope) => Array.from(scope.querySelectorAll('button'));
const buttonWith = (scope, text) => buttons(scope).find(b => b.textContent.includes(text));
const textOf = (scope) => scope.textContent.replace(/\s+/g, ' ');

// ---------- CSS helpers (jsdom does not evaluate media queries) ----------
/** Bodies of every `@media …` block that starts with `prelude`. */
function mediaBlocks(css, prelude) {
  const blocks = [];
  for (let at = css.indexOf(prelude); at >= 0; at = css.indexOf(prelude, at + 1)) {
    const open = css.indexOf('{', at);
    let depth = 1;
    let i = open + 1;
    for (; i < css.length && depth; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
    }
    blocks.push(css.slice(open + 1, i - 1));
  }
  return blocks;
}

/** The stylesheet with every @media block removed (the rules that apply at all widths). */
function stripMediaBlocks(css) {
  let out = css;
  for (const body of mediaBlocks(css, '@media')) out = out.replace(body, '');
  return out;
}

/** Declarations of the rule whose selector list is exactly `selector` (whitespace-insensitive). */
function ruleBody(css, selector) {
  const pattern = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const match = new RegExp(`(?:^|[;{}\\s])${pattern}\\s*\\{([^}]*)\\}`).exec(css);
  return match ? match[1] : null;
}

/** Clicks every "Expand …" toggle until none are left (opening a section reveals its units' toggles). */
async function expandAll(scope) {
  for (let round = 0; round < 10; round++) {
    const closed = Array.from(scope.querySelectorAll('button[aria-label^="Expand "]'));
    if (!closed.length) return;
    for (const button of closed) await click(button);
  }
  throw new Error('panels kept appearing collapsed');
}

let passed = 0;
async function test(label, fn) {
  try {
    await fn();
    passed++;
    console.log(`✅ ${label}`);
  } catch (err) {
    console.error(`❌ ${label}`);
    throw err;
  }
}

async function run() {
  console.log('🧪 UI Interaction Test Suite (jsdom + Vite, Firebase offline)\n');
  const types = await load('/src/types/courseBuilderTypes.js');
  const template = await load('/src/services/courseSpreadsheetTemplate.js');
  const writer = await load('/src/services/xlsxWriter.js');
  const { default: AQFCourseBuilder } = await load('/src/components/courseBuilder/AQFCourseBuilder.jsx');
  const teacher = { uid: 't1', email: 'teacher@school.edu', displayName: 'Ms T' };
  const teacherProfile = { role: 'teacher', email: teacher.email };

  await test('Course Builder: Level Taxonomy label, standards kept, Gemini Notebook block, several links of each type, file attachments disabled', async () => {
    const course = { ...types.createBlankCourse('t1', 'Ms T'), id: 'course_ui_1' };
    const view = await render(React.createElement(AQFCourseBuilder, { course, onSaveCourse: async () => {}, onBack: () => {}, currentUser: teacher, userProfile: teacherProfile, userTokenBalance: 25 }));
    // On entry every panel is collapsed and the Quick Navigator is hidden.
    assert.deepStrictEqual(Array.from(view.container.querySelectorAll('button[aria-label^="Expand "]')).map(b => b.getAttribute('aria-label')),
      ['Expand Course Specifications', 'Expand Course Assessments', 'Expand Units of Study']);
    assert(!view.container.querySelector('#spec-title') && !view.container.querySelector('.assessment-card') && !view.container.querySelector('.unit-editor-header'), 'nothing open on entry');
    assert(!view.container.querySelector('.builder-sidebar') && !textOf(view.container).includes('Quick Navigator'), 'Quick Navigator hidden');
    assert(view.container.querySelector('.builder-workspace-grid.no-sidebar'), 'full-width layout');
    // Collapsed panels sit tight: the page box ends just below the Units of Study panel.
    const builderUnitsHeader = view.container.querySelector('#builder-units-panel > div');
    assert(['0', '0px'].includes(builderUnitsHeader.style.marginBottom), 'no gap under the collapsed Units header');
    const builderCss = Array.from(view.container.querySelectorAll('style')).map(st => st.textContent).join('\n');
    assert(!/\.builder-main-panel\s*\{[^}]*min-height/.test(builderCss), 'no minimum height on the builder box');
    assert(!buttonWith(view.container, 'Add People').textContent.includes('🪙'), 'adding people shows no cost');
    await expandAll(view.container);
    assert.strictEqual(builderUnitsHeader.style.marginBottom, '10px', 'spacing returns when the panel is open');
    const labels = Array.from(view.container.querySelectorAll('label.field-label')).map(l => l.textContent.trim());
    assert(labels.includes('Level Taxonomy'), 'renamed label');
    assert(!labels.includes('AQF Level Taxonomy'));
    assert.strictEqual(view.container.querySelectorAll('.standard-chip input[type=checkbox]').length, 5, 'all Curriculum Standards tick boxes kept');
    const specs = view.container.querySelector('#builder-specs-panel');
    assert(specs, 'Course Specifications panel');
    assert(specs.compareDocumentPosition(view.container.querySelector('#builder-assessments-panel')) & window.Node.DOCUMENT_POSITION_FOLLOWING, 'specifications sit above Course Assessments');
    assert.deepStrictEqual(Array.from(specs.querySelectorAll('label.field-label')).map(l => l.textContent.trim()), [
      'Course Title', 'Course Code', 'Level Taxonomy', 'Curriculum Standards (AI Alignment)', 'Course Description', 'Category',
      'Year / Semester', 'Start Date', 'Course Learning Outcomes (one per line)', 'Assumed Knowledge / Prerequisites', 'Level Equivalence Notes', 'Cover Image URL'
    ], 'every specification in one panel');
    assert(!textOf(view.container).includes('Token Cost'), 'token cost field removed');
    assert(!view.container.querySelector('.builder-sidebar input'), 'no specification fields left in the sidebar');
    await type(specs.querySelector('#spec-title'), 'Marine Science');
    assert(textOf(view.container).includes('Course Builder: Marine Science'));
    await click(specs.querySelector('button[aria-label="Collapse Course Specifications"]'));
    assert(!view.container.querySelector('#spec-title') && textOf(specs).includes('Marine Science'), 'collapsed panel shows a summary');
    await click(specs.querySelector('button[aria-label="Expand Course Specifications"]'));
    assert(view.container.querySelector('#spec-title'));
    // Units of Study starts with no units: click "+ Add Unit" to start.
    assert(textOf(view.container).includes('No units added yet'), 'starts with no default units');
    await click(buttonWith(view.container.querySelector('#builder-units-panel'), '+ Add Unit'));
    assert(textOf(view.container).includes('CRS-100-1'), 'unit code automated as Course Code + 1');
    const pcLabel = Array.from(view.container.querySelectorAll('.unit-editor-header label')).find(l => l.textContent.trim() === 'Performance Criteria');
    assert(pcLabel, 'unit box below Unit Code / Title / Nominal Hours is titled Performance Criteria');
    assert.strictEqual(document.getElementById(pcLabel.htmlFor)?.tagName, 'TEXTAREA', 'label is linked to its box');
    // A unit: Unit Code, Unit Title, Nominal Hours, 📝 Unit Description (above Performance Criteria),
    // Performance Criteria, Unit Learning Outcomes, Unit Content — then its blocks. No lessons.
    const unitHeader = view.container.querySelector('.unit-editor-header');
    assert.deepStrictEqual(Array.from(unitHeader.querySelectorAll('label')).map(l => l.textContent.trim()), [
      'Unit Code', 'Unit Title', 'Nominal Hours', 'Unit Description', 'Performance Criteria', 'Unit Learning Outcomes (one per line)', 'Unit Content'
    ], 'unit fields in order');
    assert(Array.from(unitHeader.querySelectorAll('label')).every(l => l.classList.contains('unit-field-label') && !l.style.color), 'every unit label uses one style (the Unit Description colour)');
    assert(/\.unit-field-label\s*\{[^}]*color:\s*var\(--text-secondary\)[^}]*text-transform:\s*none/.test(builderCss), 'shared colour, not capitalised');
    for (const label of unitHeader.querySelectorAll('label[for]')) assert(document.getElementById(label.htmlFor), `${label.textContent.trim()} is linked to its box`);
    assert(!view.container.querySelector('.lesson-card, .lessons-container, .unit-tabs-row'), 'no lesson cards or tabs');
    assert(!/Modular Lesson Stack|Lessons & Blocks|Add Lesson/.test(textOf(view.container)), 'no lessons anywhere');
    const toolbar = view.container.querySelector('.add-block-toolbar');
    assert.deepStrictEqual(Array.from(toolbar.querySelectorAll('.add-block-btn')).map(b => b.textContent.replace('Soon', '').trim()), [
      '📝Unit Description', '🧑‍🏫Teacher Guide', '▶️YouTube Video', '📁Google Drive Resource', '📎Direct File Attachment', '📓Gemini Notebook', '❓Quiz & Questions'
    ], 'Add Block offers every block type');
    const fileBtn = buttonWith(toolbar, 'Direct File Attachment');
    assert.strictEqual(fileBtn.disabled, true, 'Direct File Attachment cannot be clicked');
    const before = view.container.querySelectorAll('.content-block-item').length;
    await click(fileBtn);
    assert.strictEqual(view.container.querySelectorAll('.content-block-item').length, before, 'clicking the disabled button adds nothing');
    assert(!buttonWith(toolbar, 'Add Notebook'), 'renamed to Gemini Notebook');
    await click(buttonWith(toolbar, 'Gemini Notebook'));
    const notebook = view.container.querySelector('.content-block-item.type-notebook_link input[type=url]');
    assert(notebook, 'Gemini Notebook block added');
    assert(notebook.getAttribute('placeholder').includes('Gemini Notebook'));
    await type(notebook, 'https://example.com/notes');
    assert(textOf(view.container).includes('This does not look like a Gemini Notebook link'));
    await type(notebook, 'https://notebooklm.google.com/notebook/abc123');
    assert(textOf(view.container).includes('Gemini Notebook link ready'));
    // More than one of each link type, each with its own link.
    const linkInputs = (blockType) => Array.from(view.container.querySelectorAll(`.content-block-item.type-${blockType} input.form-input:not(.block-title-input)`));
    const counts = () => ['youtube_video', 'google_drive_link', 'notebook_link'].map(t => linkInputs(t).length);
    const [videosBefore, drivesBefore] = counts();
    for (const label of ['YouTube Video', 'YouTube Video', 'Google Drive Resource', 'Google Drive Resource', 'Gemini Notebook']) {
      await click(buttonWith(toolbar, label));
    }
    assert.deepStrictEqual(counts(), [videosBefore + 2, drivesBefore + 2, 2]);
    const videoUrls = ['https://www.youtube.com/watch?v=aaaaaaaaaaa', 'https://youtu.be/bbbbbbbbbbb'];
    const videos = linkInputs('youtube_video').slice(-2);
    await type(videos[0], videoUrls[0]);
    await type(videos[1], videoUrls[1]);
    await type(linkInputs('notebook_link')[1], 'https://notebooklm.google.com/notebook/second');
    assert.deepStrictEqual(linkInputs('youtube_video').slice(-2).map(i => i.value), videoUrls, 'each video keeps its own link');
    assert.deepStrictEqual(linkInputs('notebook_link').map(i => i.value), ['https://notebooklm.google.com/notebook/abc123', 'https://notebooklm.google.com/notebook/second']);
    assert.strictEqual(view.container.querySelectorAll('.content-block-item.type-youtube_video .video-preview-badge').length, videosBefore + 2, 'youtu.be and watch links are both recognised');
    await view.unmount();
  });

  await test('Course Builder: unit quiz block (every question type, correct answers saved) and one course Assessments & Rubrics section', async () => {
    const saved = [];
    const course = { ...types.createBlankCourse('t1', 'Ms T'), id: 'course_ui_quiz' };
    const view = await render(React.createElement(AQFCourseBuilder, { course, onSaveCourse: async (c) => { saved.push(c); }, onBack: () => {}, currentUser: teacher, userProfile: teacherProfile, userTokenBalance: 25 }));
    await expandAll(view.container);
    // Click "+ Add Unit" to start and automate Unit Code as CRS-100-1
    await click(buttonWith(view.container.querySelector('#builder-units-panel'), '+ Add Unit'));
    assert(textOf(view.container).includes('CRS-100-1'), 'unit code automated as Course Code + 1');
    // A unit holds its Unit Description, Performance Criteria, outcomes, Unit Content and blocks.
    assert(!view.container.querySelector('.unit-tabs-row, .lesson-card'), 'no lessons');
    const unitPanel = view.container.querySelector('[id^="unit-panel-"]');
    const descriptionBoxes = () => Array.from(unitPanel.querySelectorAll('.unit-description-field textarea'));
    assert.strictEqual(descriptionBoxes().length, 1, 'every unit shows a Unit Description box');
    await type(descriptionBoxes()[0], 'Coral reefs, from polyp to ecosystem.');
    await type(unitPanel.querySelector('textarea[id^="unit-content-"]'), 'Polyps are tiny animals.\n\nThey host algae.');
    const toolbar = view.container.querySelector('.add-block-toolbar');
    await click(buttonWith(toolbar, 'Unit Description'));
    assert.strictEqual(descriptionBoxes().length, 2, 'Add Block → Unit Description adds a box above Performance Criteria');
    const pcBox = unitPanel.querySelector('textarea[id^="unit-performance-criteria-"]');
    assert(descriptionBoxes().every(box => box.compareDocumentPosition(pcBox) & window.Node.DOCUMENT_POSITION_FOLLOWING), 'Unit Description sits above Performance Criteria');
    assert(!unitPanel.querySelector('.blocks-stack .type-text_description'), 'not repeated in the blocks below');
    await click(unitPanel.querySelectorAll('button[aria-label="Remove Unit Description"]')[1]);
    assert.strictEqual(descriptionBoxes().length, 1);
    await click(buttonWith(toolbar, 'Quiz & Questions'));
    const quiz = () => view.container.querySelector('.content-block-item.type-quiz');
    assert(quiz(), 'quiz block added');
    assert(textOf(quiz()).includes('Answers hidden from students'));
    const q1 = () => quiz().querySelectorAll('.qb-question')[0];
    await type(q1().querySelector('textarea[aria-label="Question 1"]'), 'Which is a prime number?');
    const optionInputs = () => q1().querySelectorAll('.qb-option input[type=text]');
    for (const [i, text] of ['4', '6', '7', '9'].entries()) await type(optionInputs()[i], text);
    await click(q1().querySelectorAll('.qb-option input[type=radio]')[2]);
    await click(buttonWith(quiz(), '+ True / False'));
    await click(quiz().querySelectorAll('.qb-question')[1].querySelectorAll('.qb-tf input[type=radio]')[1]);
    await click(buttonWith(quiz(), '+ Short answer'));
    await type(quiz().querySelector('textarea[aria-label="Question 3 accepted answers"]'), 'Canberra\ncanberra city');
    await click(buttonWith(quiz(), '+ Open question'));
    await type(quiz().querySelector('textarea[aria-label="Question 4 model answer"]'), 'Mentions evidence.');
    assert(textOf(quiz()).includes('4 questions • 8 points • 3 marked automatically'), textOf(quiz()).slice(0, 200));
    // Course assessments: no default task — the teacher adds each one, and it starts with the sample
    // rubric for its type (formative or summative).
    assert.strictEqual(view.container.querySelectorAll('.assessment-card').length, 0, 'no default assessment (no "Knowledge Check 1")');
    assert(textOf(view.container).includes('No assessment tasks yet'));
    const criteriaOf = card => Array.from(card.querySelectorAll('.matrix-crit-input')).map(i => i.value);
    await click(buttonWith(view.container.querySelector('.assessments-container'), '+ Formative Task'));
    await click(buttonWith(view.container.querySelector('.assessments-container'), '+ Summative Task'));
    const taskCards = () => view.container.querySelectorAll('.assessment-card');
    assert.strictEqual(taskCards().length, 2);
    assert.deepStrictEqual(criteriaOf(taskCards()[0]), ['Understanding of Key Concepts', 'Application in Practice Activities', 'Reflection & Next Steps'], 'formative sample rubric preloaded');
    assert.deepStrictEqual(criteriaOf(taskCards()[1]), ['Knowledge Application & Conceptual Understanding', 'Practical Execution & Evidence of Skills', 'Communication & Documentation'], 'summative sample rubric preloaded');
    // Switching an untouched task's type swaps in the other sample; a rubric the teacher edited is kept.
    await type(taskCards()[0].querySelector('select[aria-label="Assessment type"]'), 'summative');
    assert.deepStrictEqual(criteriaOf(taskCards()[0]), ['Knowledge Application & Conceptual Understanding', 'Practical Execution & Evidence of Skills', 'Communication & Documentation'], 'sample follows the type');
    await type(taskCards()[0].querySelectorAll('.matrix-crit-input')[0], 'My own criterion');
    await type(taskCards()[0].querySelector('select[aria-label="Assessment type"]'), 'formative');
    assert.strictEqual(criteriaOf(taskCards()[0])[0], 'My own criterion', 'an edited rubric is never replaced');
    assert(textOf(view.container).includes('should add up to 100%'), 'weighting total is checked across the course');
    await click(buttonWith(view.container, 'Save Draft'));
    const savedUnit = saved[0].units[0];
    assert(!('lessons' in savedUnit), 'saved without lessons');
    assert.strictEqual(savedUnit.content, 'Polyps are tiny animals.\n\nThey host algae.', 'Unit Content saved');
    assert.deepStrictEqual(savedUnit.blocks.map(b => b.type), ['text_description', 'quiz'], 'Unit Description first, then the quiz');
    assert.strictEqual(savedUnit.blocks[0].content, 'Coral reefs, from polyp to ecosystem.');
    const savedQuiz = savedUnit.blocks.find(b => b.type === 'quiz').quiz;
    const [mc, tf, sa, open] = savedQuiz.questions;
    assert.deepStrictEqual(mc.options.map(o => o.text), ['4', '6', '7', '9']);
    assert.deepStrictEqual(mc.correctOptionIds, [mc.options[2].id], 'correct option saved for the answer key');
    assert.strictEqual(tf.correctAnswer, false);
    assert.deepStrictEqual(sa.acceptedAnswers, ['Canberra', 'canberra city']);
    assert.strictEqual(open.modelAnswer, 'Mentions evidence.');
    assert.strictEqual(saved[0].assessments.length, 2);
    assert(saved[0].units.every(u => !('assessments' in u)));
    await view.unmount();
  });

  await test('Course Builder: 📊 Spreadsheet import fills every category; save errors are shown', async () => {
    const saved = [];
    let failSave = false;
    const course = { ...types.createBlankCourse('t1', 'Ms T'), id: 'course_ui_2' };
    const view = await render(React.createElement(AQFCourseBuilder, {
      course,
      onSaveCourse: async (c) => {
        if (failSave) throw Object.assign(new Error('offline'), { code: 'unavailable' });
        saved.push(c);
      },
      onBack: () => {},
      currentUser: teacher,
      userProfile: teacherProfile,
      userTokenBalance: 25
    }));
    await click(buttonWith(view.container, 'Spreadsheet'));
    assert(textOf(view.container).includes('1. Get the spreadsheet'));
    const bytes = writer.buildXlsxWorkbook(template.buildCourseWorkbookSheets(template.createExampleCourse()));
    const file = new File([bytes], 'OzEdu_Course_Example.xlsx', { type: writer.XLSX_MIME_TYPE });
    await upload(view.container.querySelector('.ssp input[type=file]'), [file]);
    await waitFor(() => textOf(view.container).includes('3. Check and build'), 'parsed summary');
    const summary = textOf(view.container.querySelector('.ssp-summary'));
    assert(summary.includes('Diploma of Sustainable Business Practice'));
    assert(summary.includes('2 units') && summary.includes('15 content blocks') && summary.includes('10 rubric criteria') && !summary.includes('lessons'), summary);
    await click(buttonWith(view.container, 'Import into Course Builder (free)'));
    assert(!view.container.querySelector('.ssp'), 'window closes after import');
    assert(textOf(view.container).includes('Course Builder: Diploma of Sustainable Business Practice'));
    assert(textOf(view.container).includes('Imported "Diploma of Sustainable Business Practice"'));
    await expandAll(view.container);
    const unitCodes = Array.from(view.container.querySelectorAll('[id^="unit-panel-"] .sl-code')).map(n => n.textContent.trim());
    assert.deepStrictEqual(unitCodes, ['SBP501', 'SBP502']);
    // Units tab: Unit Description, Unit Content and several YouTube / Google Drive / Gemini Notebook links per unit.
    const unitPanels = view.container.querySelectorAll('[id^="unit-panel-"]');
    const linksIn = (card, blockType) => Array.from(card.querySelectorAll(`.content-block-item.type-${blockType} input.form-input:not(.block-title-input)`)).map(i => i.value);
    assert.deepStrictEqual(linksIn(unitPanels[0], 'youtube_video'), ['https://www.youtube.com/watch?v=REPLACE_WITH_VIDEO_ID_1', 'https://www.youtube.com/watch?v=REPLACE_WITH_VIDEO_ID_2']);
    assert.strictEqual(linksIn(unitPanels[0], 'google_drive_link').length, 3, 'three Drive resources');
    assert.strictEqual(linksIn(unitPanels[0], 'notebook_link').length, 3, 'three Gemini Notebooks');
    assert.deepStrictEqual(linksIn(unitPanels[1], 'youtube_video'), ['https://www.youtube.com/watch?v=REPLACE_WITH_VIDEO_ID_3']);
    const unitOneTitles = Array.from(unitPanels[0].querySelectorAll('.content-block-item .block-title-input')).map(i => i.value);
    assert.deepStrictEqual(unitOneTitles, ['Facilitation notes', 'Check your understanding', 'Introductory video', 'The triple bottom line explained', 'Unit slides', 'System mapping worksheet', 'Case study pack', 'Study notebook', 'Systems thinking notebook', 'Revision notebook']);
    assert(unitPanels[0].querySelector('.unit-description-field textarea').value.startsWith('Key terms'), 'Unit Description shown above Performance Criteria');
    assert(unitPanels[0].querySelector('textarea[id^="unit-content-"]').value.startsWith('What is sustainability?'), 'Unit Content imported');
    // Unit quiz imported from the Quiz Questions tab, answer keys included (teacher view).
    const quizEditor = unitPanels[0].querySelector('.content-block-item.type-quiz');
    assert.strictEqual(quizEditor.querySelectorAll('.qb-question').length, 4);
    assert.deepStrictEqual(Array.from(quizEditor.querySelectorAll('.qb-type')).map(s => s.value), ['multiple_choice', 'true_false', 'short_answer', 'open']);
    const firstOptions = quizEditor.querySelectorAll('.qb-question')[0].querySelectorAll('.qb-option');
    assert.deepStrictEqual(Array.from(firstOptions).map(o => o.querySelector('input[type=radio]').checked), [false, false, false, true], 'correct answer D is ticked');
    // Units hold their content & blocks only; the course has one Assessments & Rubrics section.
    assert(!view.container.querySelector('.unit-tabs-row'), 'no per-unit tabs');
    const cards = view.container.querySelectorAll('.assessment-card');
    assert.strictEqual(cards.length, 3);
    assert(textOf(view.container).includes('Σ 100%'), 'course weightings add up to 100%');
    const lastHeaders = Array.from(cards[2].querySelectorAll('.rubric-matrix-table th')).map(th => th.textContent);
    assert.deepStrictEqual(lastHeaders, ['Criterion & Weight', 'Fail (0-49%)', 'Pass (50-64%)', 'Credit (65-74%)', 'Distinction (75-84%)', 'High Distinction (85-100%)'], '5-band rubric');
    assert.deepStrictEqual(Array.from(view.container.querySelectorAll('.asmt-meta-grid input[type=date]')).map(i => i.value), ['2026-02-27', '2026-03-27', '2026-05-15']);
    assert.deepStrictEqual(Array.from(view.container.querySelectorAll('select[aria-label="Units covered"]')).map(s => s.selectedOptions[0].textContent.split(' — ')[0]), ['SBP501', 'SBP501', 'SBP502']);
    await click(buttonWith(view.container, 'Save Draft'));
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved[0].units.length, 2);
    assert.strictEqual(saved[0].learningOutcomes.length, 4);
    assert.strictEqual(saved[0].assessments.length, 3, 'one course-level assessment list is saved');
    assert(saved[0].units.every(u => !('assessments' in u)));
    failSave = true;
    await click(buttonWith(view.container, 'Save Draft'));
    assert(textOf(view.container).includes('NOT saved to the cloud'), 'save failures are never reported as success');
    await view.unmount();
  });

  await test('Rubric Matrix: upload any number of criteria, preview, replace, add & delete rows', async () => {
    const course = { ...types.createBlankCourse('t1', 'Ms T'), id: 'course_ui_3' };
    const view = await render(React.createElement(AQFCourseBuilder, { course, onSaveCourse: async () => {}, onBack: () => {}, currentUser: teacher, userProfile: teacherProfile, userTokenBalance: 25 }));
    await expandAll(view.container);
    await click(buttonWith(view.container, 'Add Formative Task'));
    assert.strictEqual(view.container.querySelectorAll('.rubric-matrix-table tbody tr').length, 3, 'the new task starts with the 3-criterion formative sample');
    const csv = ['Criterion,Weight %,Fail,Pass,Credit,Distinction,High Distinction', ...Array.from({ length: 7 }, (_, i) => `Criterion ${i + 1},${i < 2 ? 20 : 12},f${i},p${i},c${i},d${i},hd${i}`)].join('\n');
    const input = view.container.querySelector('.rsi-actions input[type=file]');
    await upload(input, [new File([csv], 'rubric.csv', { type: 'text/csv' })]);
    await waitFor(() => view.container.querySelector('.rsi-dialog'), 'rubric preview');
    const preview = textOf(view.container.querySelector('.rsi-dialog'));
    assert(preview.includes('7 criteria') && preview.includes('5 performance levels') && preview.includes('Σ 100%'), preview);
    await click(buttonWith(view.container.querySelector('.rsi-dialog'), 'Replace rubric'));
    const rows = () => view.container.querySelectorAll('.rubric-matrix-table tbody tr');
    assert.strictEqual(rows().length, 7, 'seven criterion rows');
    assert.strictEqual(view.container.querySelectorAll('.rubric-matrix-table thead th').length, 6);
    await click(buttonWith(view.container, 'Add Criterion Row'));
    assert.strictEqual(rows().length, 8);
    assert.strictEqual(rows()[7].querySelectorAll('textarea.matrix-desc-input').length, 5, 'new row copies the 5-level structure');
    await click(rows()[0].querySelector('.delete-icon-btn'));
    assert.strictEqual(rows().length, 7, 'criterion rows can be removed');
    await view.unmount();
  });

  await test('✨ AI Assist: Spreadsheets tab; offline/insufficient-token paths fail safely', async () => {
    const course = { ...types.createBlankCourse('t1', 'Ms T'), id: 'course_ui_4' };
    const csv = (await load('/src/services/geminiCourseService.js')).SAMPLE_SHEET_CSV;
    // Teacher with no tokens -> clear insufficient-token message (balance read is offline => 0)
    let view = await render(React.createElement(AQFCourseBuilder, { course, onSaveCourse: async () => {}, onBack: () => {}, currentUser: teacher, userProfile: teacherProfile, userTokenBalance: 0 }));
    await click(buttonWith(view.container, 'AI Assist'));
    await click(buttonWith(view.container, 'Spreadsheets'));
    await upload(view.container.querySelector('.ssp input[type=file]'), [new File([csv], 'Marine.csv', { type: 'text/csv' })]);
    await waitFor(() => buttonWith(view.container, 'Build out with Gemini AI'), 'AI build button');
    await click(buttonWith(view.container, 'Build out with Gemini AI'));
    await waitFor(() => textOf(view.container).includes('Insufficient tokens'), 'insufficient token message');
    assert(textOf(view.container).includes('Ask the Super Admin for tokens'));
    await view.unmount();

    // Super Admin: free (UNL), but Gemini has no key in tests -> friendly configuration error, nothing applied
    const admin = { uid: 'a1', email: 'support@aifoundation.net.au', displayName: 'Admin' };
    view = await render(React.createElement(AQFCourseBuilder, { course, onSaveCourse: async () => {}, onBack: () => {}, currentUser: admin, userProfile: { role: 'Superadmin', email: admin.email }, userTokenBalance: 0 }));
    assert(textOf(view.container).includes('🪙 UNL Tokens'), 'Super Admin token pill shows UNL');
    await click(buttonWith(view.container, 'AI Assist'));
    assert(textOf(view.container).includes('Super Admin — UNL tokens'));
    await click(buttonWith(view.container, 'Spreadsheets'));
    await upload(view.container.querySelector('.ssp input[type=file]'), [new File([csv], 'Marine.csv', { type: 'text/csv' })]);
    await waitFor(() => buttonWith(view.container, 'Build out with Gemini AI (0 tokens)'), 'free AI build for Super Admin');
    await click(buttonWith(view.container, 'Build out with Gemini AI'));
    await waitFor(() => textOf(view.container).includes('Gemini AI is not configured'), 'configuration error');
    assert(textOf(view.container).includes('Course Builder: New Course'), 'nothing applied when AI fails');
    await view.unmount();
  });

  await test('Token Fund: sponsor & emergency fund panels behind the signed-in button', async () => {
    const { default: TokenFundModal } = await load('/src/components/TokenFundModal.jsx');
    let donationOpened = false;
    const view = await render(React.createElement(TokenFundModal, { isOpen: true, currentUser: teacher, onClose: () => {}, onOpenDonation: () => { donationOpened = true; } }));
    const text = textOf(view.container);
    for (const phrase of ["Donate to fund a specific student's access for a year.", 'Fund Account', 'Emergency Token Fund', 'Contribute to our token pool for disadvantaged students around the world.', 'Donate to Token Fund']) {
      assert(text.includes(phrase), `shows: ${phrase}`);
    }
    assert.strictEqual(view.container.querySelector('input[type=email]').placeholder, "Student's Email Address");
    assert(!text.includes('$'), 'no prices are shown');
    await type(view.container.querySelector('input[type=email]'), 'not-an-email');
    await submit(view.container.querySelector('form'));
    assert(textOf(view.container).includes("Enter the student's email address"));
    await click(buttonWith(view.container, 'Donate to Token Fund'));
    assert.strictEqual(donationOpened, true);
    await view.unmount();
  });

  await test('Front page (signed out): donation panels removed, no Token Fund button', async () => {
    const { default: App } = await load('/src/App.jsx');
    const view = await render(React.createElement(App));
    await waitFor(() => buttonWith(view.container, 'Sign in with Google'), 'sign-in button');
    const text = textOf(view.container);
    assert(!text.includes('Sponsor a Student'), 'sponsor panel removed from the public page');
    assert(!text.includes('Emergency Token Fund'), 'emergency fund panel removed from the public page');
    assert(!buttonWith(view.container, 'Token Fund'), 'Token Fund only after sign-in');
    assert(text.includes('Transforming Education Through AI & Community'));
    // Contact: register with Google -> Supporter -> message the Super Admin (or email support).
    await click(buttonWith(view.container.querySelector('nav.header-nav'), 'Contact'));
    const modal = view.container.querySelector('.contact-steps');
    assert(modal, 'contact guide shown');
    const contactText = textOf(modal);
    assert(contactText.includes('register with Google first') && contactText.includes('Supporters') && contactText.includes('Super Admin'), contactText);
    assert(buttonWith(modal, 'Register with Google'), 'register button');
    assert(modal.querySelector('a[href="mailto:support@aifoundation.net.au"]'), 'support email link');
    assert(!view.container.querySelector('.contact-form, .math-verification'), 'the old anonymous form is gone');
    await click(view.container.querySelector('.close-btn'));

    // About David: button in footer opens centered modal with image and bio
    const aboutBtn = buttonWith(view.container.querySelector('footer.footer'), 'About David');
    assert(aboutBtn, 'About David button exists in footer');
    await click(aboutBtn);
    await waitFor(() => textOf(view.container).includes('Griffith University'), 'About David modal opens');
    assert(textOf(view.container).includes('doctoral studies at Griffith University'));
    assert(textOf(view.container).includes('AI Foundation Australia'));
    assert(view.container.querySelector('img[src="/david-photo.jpg"]'), 'David image is rendered');
    await click(view.container.querySelector('.close-btn'));

    // Front page 4 postcards: click flips card over to show paragraph text, click again flips back
    const frontCards = view.container.querySelectorAll('.front-card');
    assert.strictEqual(frontCards.length, 4, '4 postcards rendered on front page');
    assert(!frontCards[0].classList.contains('is-flipped'), 'card 0 initially unflipped');
    assert(frontCards[0].querySelector('.front-card-desc-mobile').textContent.includes('OzEdu bridges'), 'back contains paragraph text');
    await click(frontCards[0]);
    assert(frontCards[0].classList.contains('is-flipped'), 'card 0 flips on click');
    assert.strictEqual(frontCards[0].getAttribute('aria-expanded'), 'true');
    await click(frontCards[0]);
    assert(!frontCards[0].classList.contains('is-flipped'), 'card 0 flips back on second click');
    assert.strictEqual(frontCards[0].getAttribute('aria-expanded'), 'false');

    await view.unmount();
  });

  await test('Phone header (signed out): Sign in with Google replaces the 3-bar menu; Contact moves to the footer', async () => {
    const { default: App } = await load('/src/App.jsx');
    const view = await render(React.createElement(App));
    const header = await waitFor(() => view.container.querySelector('header.header'), 'header');
    const signIn = await waitFor(() => {
      const button = Array.from(header.children).find(el => el.classList.contains('mobile-signin-btn'));
      return button && !button.disabled ? button : null;
    }, 'phone Sign in with Google button');
    assert(!view.container.querySelector('.mobile-menu-toggle, .hamburger-line'), 'the 3-bar menu is gone');
    assert.strictEqual(signIn.textContent.trim(), 'Sign in with Google');
    assert(signIn.querySelector('svg'), 'Google "G" icon');
    assert(header.firstElementChild.classList.contains('logo-btn') && signIn.previousElementSibling === header.firstElementChild,
      'logo on the left, then the Google button (top right of the header)');
    assert(!header.querySelector('.mobile-account-btn, .mobile-role-status'), 'no account menu before sign-in');
    assert(!view.container.querySelector('.mobile-nav-backdrop, nav.header-nav.mobile-open'), 'nothing to open while signed out');
    // The phone button runs the real Google sign-in (offline here, so its error is shown).
    await click(signIn);
    await waitFor(() => textOf(view.container).includes('Firebase Auth is not initialized'), 'sign-in attempted');
    // Contact used to live in the 3-bar menu; on phones it is in the footer.
    await click(view.container.querySelector('footer .mobile-footer-contact'));
    assert(view.container.querySelector('.contact-steps'), 'Contact opens from the footer');
    await view.unmount();
  });

  await test('Message dock: colour legend, compose rules, offline send error, imperative compose', async () => {
    const { default: MessageDock } = await load('/src/components/messaging/MessageDock.jsx');
    const dockRef = React.createRef();
    const view = await render(React.createElement(MessageDock, { ref: dockRef, currentUser: teacher, userProfile: teacherProfile, teachingCourses: [], enrolledCourses: [] }));
    const bar = view.container.querySelector('.md-bar');
    assert(textOf(bar).includes('Messages'));
    const legendColours = new Set(Array.from(bar.querySelectorAll('.md-tag')).map(t => t.style.color));
    assert(legendColours.size >= 7, 'each category has its own colour');
    await click(bar);
    await click(buttonWith(view.container, 'New message'));
    const select = view.container.querySelector('#md-to');
    assert.strictEqual(select.value, 'superadmin');
    assert(textOf(view.container).includes('students enrolled in your courses'));
    await type(view.container.querySelector('#md-body'), 'Hello admin');
    await submit(view.container.querySelector('form.md-form'));
    await waitFor(() => textOf(view.container).includes('Messaging is unavailable right now'), 'offline send error');
    await act(async () => dockRef.current.compose({ to: 'Stu@School.edu', toName: 'Stu', courseId: 'c1', courseTitle: 'Bio', subject: 'Essay' }));
    assert.strictEqual(view.container.querySelector('#md-to').value, 'stu@school.edu', 'compose pre-addressed');
    assert.strictEqual(view.container.querySelector('#md-subject').value, 'Essay');
    assert.strictEqual(view.container.querySelector('#md-course').value, 'c1', 'the teacher\'s message names the course');
    assert(textOf(view.container.querySelector('#md-course')).includes('Bio'));
    await click(buttonWith(view.container, '←'));
    await click(buttonWith(view.container, 'Request tokens'));
    assert(view.container.querySelector('#md-amount'));
    await view.unmount();

    // Students: the Super Admin, or a teacher about one of the teacher's courses (filled in for them).
    const studentDock = React.createRef();
    const sv = await render(React.createElement(MessageDock, {
      ref: studentDock,
      currentUser: { uid: 's1', email: 'stu@school.edu', displayName: 'Stu' },
      userProfile: { role: 'student', email: 'stu@school.edu' },
      enrolledCourses: [{ id: 'c1', title: 'Bio', authorEmail: 'teacher@school.edu', authorName: 'Ms T' }],
      networkCourses: [{ id: 'g1', title: 'Chemistry', authorEmail: 'chem@school.edu', authorName: 'Dr C' }, { id: 'g2', title: 'Marine Bio', authorEmail: 'teacher@school.edu', authorName: 'Ms T' }]
    }));
    await click(sv.container.querySelector('.md-bar'));
    await click(buttonWith(sv.container, 'New message'));
    await waitFor(() => sv.container.querySelectorAll('#md-to option').length === 3, 'student contacts');
    assert.deepStrictEqual(Array.from(sv.container.querySelectorAll('#md-to option')).map(o => o.value), ['superadmin', 'teacher@school.edu', 'chem@school.edu'], 'no free-typed addresses for students');
    assert(textOf(sv.container).includes('a teacher about one of their courses'));
    assert(!sv.container.querySelector('#md-course'), 'no course needed for the Super Admin');
    await type(sv.container.querySelector('#md-to'), 'teacher@school.edu');
    const courseSelect = sv.container.querySelector('#md-course');
    assert.deepStrictEqual(Array.from(courseSelect.options).map(o => [o.value, o.textContent]), [['c1', 'Bio'], ['g2', 'Marine Bio']], 'their own course first');
    assert.strictEqual(courseSelect.value, 'c1');
    await type(courseSelect, 'g2');
    assert.strictEqual(sv.container.querySelector('#md-course').value, 'g2', 'student can pick another of that teacher\'s courses');
    // "Contact Teacher to Enrol" from Global Search starts a message about that course.
    await act(async () => studentDock.current.compose({ to: 'chem@school.edu', toName: 'Dr C', courseId: 'g1', courseTitle: 'Chemistry', subject: 'Enrolment request: Chemistry' }));
    assert.strictEqual(sv.container.querySelector('#md-to').value, 'chem@school.edu');
    assert.strictEqual(sv.container.querySelector('#md-course').value, 'g1');
    await type(sv.container.querySelector('#md-body'), 'Could you enrol me?');
    await submit(sv.container.querySelector('form.md-form'));
    await waitFor(() => textOf(sv.container).includes('Messaging is unavailable right now'), 'offline send error');
    await sv.unmount();
  });

  await test('Student panel: courses, hidden teacher guides, safe video embeds, submission box', async () => {
    const { default: StudentLearningPanel } = await load('/src/components/student/StudentLearningPanel.jsx');
    const course = {
      id: 'c1', title: 'Reef Ecology', authorName: 'Ms T', authorEmail: 'teacher@school.edu', category: 'Science',
      code: 'REEF-5', aqfLevel: 5, curriculumStandards: ['teqsa'], year: '2026 Semester 2', startDate: '2026-07-20',
      learningOutcomes: ['Explain coral symbiosis'], knowledge: 'Year 10 science', aqfEquivalenceNotes: 'Similar to a UK Level 5 HND.',
      thumbnail: 'https://example.com/cover.jpg', description: 'Reefs from polyp to ecosystem.',
      units: [{
        id: 'u1', unitCode: 'REEF1', unitTitle: 'Coral basics', nominalHours: 10,
        lessons: [{ id: 'l1', title: 'Polyps', estimatedMinutes: 30, blocks: [
          { id: 'b1', type: 'text_description', title: 'Intro', content: 'Corals are animals.' },
          { id: 'b2', type: 'teacher_guide', title: 'Secret', content: 'TEACHER ONLY NOTES' },
          { id: 'b3', type: 'youtube_video', title: 'Video', content: 'https://youtu.be/dQw4w9WgXcQ', metadata: { youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' } },
          { id: 'b4', type: 'notebook_link', title: 'Notebook', content: 'https://notebooklm.google.com/notebook/x', metadata: { notebookUrl: 'https://notebooklm.google.com/notebook/x' } },
          { id: 'b5', type: 'google_drive_link', title: 'Bad', content: 'javascript:alert(1)', metadata: {} },
          { id: 'b6', type: 'google_drive_link', title: 'Slides', content: 'https://docs.google.com/presentation/d/s/view', metadata: { driveUrl: 'https://docs.google.com/presentation/d/s/view' } },
          { id: 'b7', type: 'google_drive_link', title: 'Article', content: 'https://example.org/article', metadata: { driveUrl: 'https://example.org/article' } },
          { id: 'b8', type: 'notebook_link', title: 'Second notebook', content: 'https://notebooklm.google.com/notebook/y', metadata: { notebookUrl: 'https://notebooklm.google.com/notebook/y' } },
          { id: 'b9', type: 'youtube_video', title: 'Second video', content: 'https://www.youtube.com/watch?v=9bZkp7q19f0', metadata: { youtubeUrl: 'https://www.youtube.com/watch?v=9bZkp7q19f0' } },
          { id: 'b10', type: 'quiz', title: 'Polyp quiz', quiz: { instructions: 'Answer both.', questions: [
            { id: 'q1', type: 'multiple_choice', prompt: 'Corals are…', points: 1, allowMultiple: false, options: [{ id: 'o1', text: 'Plants' }, { id: 'o2', text: 'Animals' }] },
            { id: 'q2', type: 'open', prompt: 'Why do corals bleach?', points: 5 }
          ] } }
        ] }],
        assessments: [{ id: 'a1', title: 'Reef report', type: 'summative', dueDate: '2026-05-15', nominalWeight: 60, description: 'Write it.', rubric: types.createDefaultRubric() }]
      }]
    };
    let messaged = null;
    const view = await render(React.createElement(StudentLearningPanel, { currentUser: { uid: 's1', email: 'stu@school.edu' }, courses: [course], onMessageTeacher: c => { messaged = c; } }));
    const overview = textOf(view.container);
    assert(overview.includes('Student Admin Panel') && overview.includes('stu@school.edu'));
    assert(view.container.querySelector('.cards-grid'), 'course postcards grid');
    assert(overview.includes('Reef Ecology') && overview.includes('Ms T'), 'enrolled course postcard shown');
    await click(buttonWith(view.container, 'Open course'));
    assert.deepStrictEqual(Array.from(view.container.querySelectorAll('button[aria-label^="Expand "]')).map(b => b.getAttribute('aria-label')),
      ['Expand Course Specifications', 'Expand Course Assessments', 'Expand Units of Study'], 'every panel collapsed on entry');
    assert(!view.container.querySelector('.sl-student-sidebar') && !textOf(view.container).includes('Quick Navigator'), 'Quick Navigator hidden');
    // Collapsed panels sit tight: the course box ends just below the Units of Study & Course Content panel.
    const unitsHeader = view.container.querySelector('#student-units-panel > div');
    assert(['0', '0px'].includes(unitsHeader.style.marginBottom), 'no gap under the collapsed Units header');
    const panelCss = Array.from(view.container.querySelectorAll('style')).map(st => st.textContent).join('\n');
    assert(!/\.sl-student-main\s*\{[^}]*min-height/.test(panelCss), 'no minimum height on the course box');
    await expandAll(view.container);
    assert.strictEqual(unitsHeader.style.marginBottom, '12px', 'spacing returns when the panel is open');
    assert(Array.from(view.container.querySelectorAll('details.sl-unit-dropdown, details.sl-assessment-dropdown, details.sl-rubric')).every(d => !d.open), 'units, tasks and rubrics start closed');
    const studentSpecs = view.container.querySelector('#student-specs-panel');
    assert(studentSpecs.compareDocumentPosition(view.container.querySelector('#student-assessments-panel')) & window.Node.DOCUMENT_POSITION_FOLLOWING, 'specifications above Course Assessments');
    assert.deepStrictEqual(Array.from(studentSpecs.querySelectorAll('dt')).map(d => d.textContent), [
      'Course Title', 'Course Code', 'Level Taxonomy', 'Curriculum Standards', 'Course Description', 'Category',
      'Year / Semester', 'Start Date', 'Course Learning Outcomes', 'Assumed Knowledge / Prerequisites', 'Level Equivalence Notes'
    ], 'same specifications as Course Builder, no cover image');
    const specText = textOf(studentSpecs);
    for (const value of ['REEF-5', 'TEQSA', '2026 Semester 2', 'Explain coral symbiosis', 'Year 10 science', 'UK Level 5 HND', 'Reefs from polyp to ecosystem.']) {
      assert(specText.includes(value), value);
    }
    assert(!specText.includes('cover.jpg') && !studentSpecs.querySelector('input, textarea, select'), 'view-only, no cover image');
    await click(studentSpecs.querySelector('button[aria-label="Collapse Course Specifications"]'));
    assert(!studentSpecs.querySelector('dl'), 'collapsible');
    const text = textOf(view.container);
    assert(text.includes('Corals are animals.'));
    assert(!text.includes('TEACHER ONLY NOTES'), 'teacher guides are hidden from students');
    assert.deepStrictEqual(Array.from(view.container.querySelectorAll('iframe')).map(f => f.getAttribute('src')),
      ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/9bZkp7q19f0'], 'every video embeds');
    assert(view.container.querySelector('a[href="https://notebooklm.google.com/notebook/x"]'));
    assert(view.container.querySelector('a[href="https://notebooklm.google.com/notebook/y"]'));
    assert.strictEqual(text.match(/Open Gemini Notebook/g).length, 2, 'both Gemini Notebooks are listed');
    assert(view.container.querySelector('a.sl-link[href="https://docs.google.com/presentation/d/s/view"]').textContent.includes('Open in Google Drive'));
    assert(view.container.querySelector('a.sl-link[href="https://example.org/article"]').textContent.includes('Open resource'), 'non-Drive links are not labelled Google Drive');
    assert(!view.container.querySelector('a[href^="javascript"]'), 'unsafe links never render');
    assert(text.includes('How this is marked'));
    await click(buttonWith(view.container, 'Message teacher'));
    assert.strictEqual(messaged.id, 'c1');
    await waitFor(() => view.container.querySelector('textarea#ans-a1'), 'submission box');
    assert(textOf(view.container.querySelector('.sl-assessments-top-panel')).includes('Reef report'), 'a task stored in a unit (older course) shows in the one course list');
    await type(view.container.querySelector('textarea#ans-a1'), 'Coral polyps host algae.');
    await submit(view.container.querySelector('.sl-submit form'));
    await waitFor(() => textOf(view.container).includes('Submissions are unavailable right now'), 'offline submission error');
    // Older course (lessons): every block shows in its unit; the Unit Description opens the unit, above Performance Criteria.
    const unitCard = view.container.querySelector('.sl-unit-dropdown');
    assert(!unitCard.querySelector('.sl-lesson-box'), 'no lesson boxes');
    const descriptionCard = unitCard.querySelector('.sl-unit-description');
    assert(descriptionCard && textOf(descriptionCard).includes('Corals are animals.'), 'Unit Description card');
    const pcCard = Array.from(unitCard.querySelectorAll('.sl-unit-desc-card')).find(c => textOf(c).includes('Performance Criteria'));
    assert(descriptionCard.compareDocumentPosition(pcCard) & window.Node.DOCUMENT_POSITION_FOLLOWING, 'Unit Description above Performance Criteria');
    assert.strictEqual(textOf(unitCard.querySelector('.sl-unit-content')), 'Polyps', 'the old lesson title is kept as Unit Content');
    assert.strictEqual(unitCard.querySelectorAll('.sl-unit-blocks .sl-block').length, unitCard.querySelectorAll('.sl-unit-blocks > *').length, 'blocks follow Unit Content');
    // Unit quiz inside the unit
    const quizForm = await waitFor(() => view.container.querySelector('form.sq-quiz'), 'quiz form');
    assert(textOf(quizForm).includes('Answer both.') && textOf(quizForm).includes('0/2 answered'));
    assert.strictEqual(buttonWith(quizForm, 'Submit quiz').disabled, true, 'nothing answered yet');
    await click(quizForm.querySelectorAll('input[type=radio]')[1]);
    await type(quizForm.querySelector('textarea'), 'Heat stress.');
    assert(textOf(quizForm).includes('2/2 answered'));
    await submit(quizForm);
    await waitFor(() => textOf(view.container).includes('Quizzes are unavailable right now'), 'offline quiz error');
    // The teacher saves an edit (App follows the course live): the open page updates in place.
    const edited = { ...course, title: 'Reef Ecology (2027)', units: course.units.map(u => ({ ...u, lessons: u.lessons.map(l => ({ ...l, title: 'Polyps (updated)' })) })) };
    await view.rerender(React.createElement(StudentLearningPanel, { currentUser: { uid: 's1', email: 'stu@school.edu' }, courses: [edited], onMessageTeacher: c => { messaged = c; } }));
    const updatedText = textOf(view.container);
    assert(updatedText.includes('Reef Ecology (2027)') && updatedText.includes('Polyps (updated)'), 'edited course shown without reopening');
    assert(!updatedText.includes('Student Admin Panel'), 'the student stays on the course page');
    assert(view.container.querySelector('button[aria-label="Collapse Units of Study"]'), 'open panels stay open');
    await view.unmount();
  });

  await test('Student panel: draft courses visible in preview mode, submissions locked, live updates propagate', async () => {
    const { default: StudentLearningPanel } = await load('/src/components/student/StudentLearningPanel.jsx');
    const draftCourse = {
      id: 'draft_c1',
      title: 'Introduction to Quantum AI',
      authorName: 'Dr Quantum',
      authorEmail: 'dr.quantum@school.edu',
      category: 'Technology',
      code: 'QAI-101',
      aqfLevel: 6,
      isDraft: true,
      status: 'draft',
      tags: ['lms', 'Draft', 'OzEdu'],
      units: [{
        id: 'u1',
        unitCode: 'QAI-101-1',
        unitTitle: 'Qubits and Superposition',
        description: 'Core concepts of quantum computing and superposition.',
        content: 'Lecture notes on quantum states.',
        blocks: [
          { id: 'b1', type: 'text_description', title: 'Theory', content: 'Quantum theory and mathematical foundation.' }
        ]
      }],
      assessments: [
        { id: 'a1', title: 'Quantum Circuit Simulator Analysis', type: 'summative', nominalWeight: 100, description: 'Analyze circuit fidelity.' }
      ]
    };

    const view = await render(React.createElement(StudentLearningPanel, {
      currentUser: { uid: 's1', email: 'stu@school.edu', displayName: 'Stu' },
      courses: [draftCourse]
    }));

    // Postcard overview: shows Draft badge and title
    const overview = textOf(view.container);
    assert(overview.includes('Introduction to Quantum AI'), 'draft course card visible to registered student');
    assert(overview.includes('Draft'), 'draft pill on course card');

    // Student opens the draft course
    await click(buttonWith(view.container, 'Open course'));
    const courseViewText = textOf(view.container);
    assert(courseViewText.includes('Draft Course Mode'), 'draft mode notice visible to student');
    assert(courseViewText.includes('You have permission as an enrolled student to view and study this course'), 'draft explanation present');
    assert(courseViewText.includes('DRAFT COURSE'), 'draft badge pill in header');

    // Expand all panels to inspect content
    await expandAll(view.container);
    const expandedText = textOf(view.container);
    assert(expandedText.includes('Qubits and Superposition'), 'unit title visible');
    assert(expandedText.includes('Core concepts of quantum computing'), 'unit description visible');

    // Verify submission button is locked in draft mode
    const submitBtn = buttonWith(view.container, 'Locked in Draft');
    assert(submitBtn, 'submission button is disabled and indicates Locked in Draft');
    assert.strictEqual(submitBtn.disabled, true, 'student cannot submit while in draft');

    // Real-time teacher update propagates (e.g. teacher updates the draft course title and adds a unit)
    const updatedDraft = {
      ...draftCourse,
      title: 'Introduction to Quantum AI (Advanced)',
      units: [
        ...draftCourse.units,
        {
          id: 'u2',
          unitCode: 'QAI-101-2',
          unitTitle: 'Quantum Entanglement & Teleportation',
          description: 'Entanglement protocols.',
          blocks: []
        }
      ]
    };

    await view.rerender(React.createElement(StudentLearningPanel, {
      currentUser: { uid: 's1', email: 'stu@school.edu', displayName: 'Stu' },
      courses: [updatedDraft]
    }));

    const liveUpdatedText = textOf(view.container);
    assert(liveUpdatedText.includes('Introduction to Quantum AI (Advanced)'), 'course title update shows live');
    assert(liveUpdatedText.includes('Quantum Entanglement & Teleportation'), 'newly added unit shows live without reload');

    await view.unmount();
  });

  await test('Students & People: bulk paste / spreadsheet enrolment with preview', async () => {
    const { default: CourseAddPeopleModal } = await load('/src/components/course/CourseAddPeopleModal.jsx');
    let added = 0;
    const course = { id: 'course_bulk_ui', title: 'Bio' };
    const view = await render(React.createElement(CourseAddPeopleModal, { course, currentUser: teacher, onClose: () => {}, onMemberAdded: (id, n) => { added += n; } }));
    await click(buttonWith(view.container, 'Bulk / Spreadsheet'));
    await type(view.container.querySelector('#bulk-emails'), 'Jane Doe <jane@school.edu>\nliam@school.edu, Liam\nbad@\njane@school.edu');
    const summary = textOf(view.container);
    assert(summary.includes('2 to enrol') && summary.includes('1 invalid'), summary);
    const roster = new File(['Name,Email\nMia,mia@school.edu\nNoah,noah@school.edu'], 'class.csv', { type: 'text/csv' });
    await upload(view.container.querySelector('input[type=file]'), [roster]);
    await waitFor(() => textOf(view.container).includes('4 to enrol'), 'spreadsheet emails merged');
    await click(buttonWith(view.container, 'Enrol 4'));
    await waitFor(() => textOf(view.container).includes('Enrolled 4 students'), 'bulk enrol result');
    assert(textOf(view.container).includes('Saved on this device only'), 'offline mode is reported honestly');
    assert.strictEqual(added, 4);
    assert(buttonWith(view.container, 'Enrolled Roster (4)'), 'roster updated');
    await view.unmount();
  });

  await test('Super Admin panel: UNL pill, Give Tokens limits, offline grant error', async () => {
    const { default: SuperAdminTokenPanel } = await load('/src/components/SuperAdminTokenPanel.jsx');
    const admin = { uid: 'a1', email: 'support@aifoundation.net.au', displayName: 'Admin' };
    const view = await render(React.createElement(SuperAdminTokenPanel, { currentUser: admin, userProfile: { role: 'Superadmin', email: admin.email }, isOpen: true, onClose: () => {} }));
    await waitFor(() => textOf(view.container).includes('Give tokens to any registered account'), 'Give Tokens tab');
    assert(textOf(view.container).includes('🪙 UNL Tokens'));
    await type(view.container.querySelector('input[type=email]'), 'stu@school.edu');
    await type(view.container.querySelector('input[aria-label="Tokens to give"]'), '1000');
    await submit(view.container.querySelector('form'));
    assert(textOf(view.container).includes('Give between 1 and 999 tokens'));
    await type(view.container.querySelector('input[aria-label="Tokens to give"]'), '50');
    await submit(view.container.querySelector('form'));
    await waitFor(() => textOf(view.container).includes('Firestore is unavailable'), 'offline grant error');
    await view.unmount();
  });

  await test('Submissions (teacher): offline list shows empty state per assessment', async () => {
    const { default: CourseSubmissionsModal } = await load('/src/components/course/CourseSubmissionsModal.jsx');
    const course = {
      id: 'c1', title: 'Bio', assessments: [{ id: 'a2', title: 'Course exam' }],
      units: [{ id: 'u1', unitCode: 'B1', assessments: [{ id: 'a1', title: 'Essay' }], lessons: [{ id: 'l1', title: 'L', blocks: [{ id: 'qz', type: 'quiz', title: 'Q', quiz: { questions: [] } }] }] }]
    };
    const view = await render(React.createElement(CourseSubmissionsModal, { course, currentUser: teacher, onClose: () => {} }));
    await waitFor(() => textOf(view.container).includes('No submissions yet.'), 'empty state');
    assert(textOf(view.container).includes('Essay') && textOf(view.container).includes('Course exam'), 'one list: course tasks plus tasks moved up from units');
    await click(buttonWith(view.container, 'Unit quizzes (1)'));
    await waitFor(() => textOf(view.container).includes('answer keys could not be loaded'), 'offline marking view');
    await view.unmount();
  });

  await test('Bulk quiz marking: auto-marked closed questions, mark-by-question, release to all', async () => {
    const quizServer = await makeServer([{
      find: /^(\.\.?\/)+services\/quizService(\.js)?$/,
      replacement: fileURLToPath(new URL('./fixtures/quizServiceMock.js', import.meta.url))
    }]);
    const { default: QuizMarkingPanel } = await quizServer.ssrLoadModule('/src/components/course/QuizMarkingPanel.jsx');
    const quizBlock = { id: 'quiz1', type: 'quiz', title: 'Polyp quiz', quiz: { questions: [
      { id: 'q1', type: 'multiple_choice', prompt: 'Corals are…', points: 1, options: [{ id: 'o1', text: 'Plants' }, { id: 'o2', text: 'Animals' }] },
      { id: 'q2', type: 'true_false', prompt: 'Corals host algae.', points: 1 },
      { id: 'q3', type: 'open', prompt: 'Why do corals bleach?', points: 5 }
    ] } };
    globalThis.__TEST_QUIZ__ = {
      keys: { quiz1: { q1: { correctOptionIds: ['o2'] }, q2: { correctAnswer: true }, q3: { modelAnswer: 'Heat stress expels algae.' } } },
      attempts: [
        { id: 'at1', quizId: 'quiz1', studentName: 'Ann', studentEmail: 'ann@school.edu', status: 'submitted', answers: { q1: ['o2'], q2: true, q3: 'Warm water stresses them.' } },
        { id: 'at2', quizId: 'quiz1', studentName: 'Ben', studentEmail: 'ben@school.edu', status: 'submitted', answers: { q1: ['o1'], q2: true } },
        { id: 'at3', quizId: 'quiz1', studentName: 'Cy', studentEmail: 'cy@school.edu', status: 'graded', score: 2, maxScore: 7, percent: 29, answers: { q1: ['o2'] }, results: [] }
      ]
    };
    const course = { id: 'cq', title: 'Reef', units: [{ id: 'u1', unitCode: 'REEF1', lessons: [{ id: 'l1', title: 'Polyps', blocks: [quizBlock] }] }] };
    const view = await render(React.createElement(QuizMarkingPanel, { course, currentUser: teacher }));
    await waitFor(() => view.container.querySelector('.qm-stats'), 'marking view');
    const stat = (label) => Array.from(view.container.querySelectorAll('.qm-stat')).find(x => x.textContent.includes(label)).querySelector('strong').textContent;
    assert.deepStrictEqual([stat('submitted'), stat('to mark'), stat('ready to release'), stat('released')], ['3', '1', '1', '1']);
    assert(textOf(view.container).includes('Model answer: Heat stress expels algae.'), 'model answer shown to the teacher');
    assert(textOf(view.container).includes('Warm water stresses them.'));
    await click(buttonWith(view.container, 'Full marks to all answered'));
    assert.deepStrictEqual([stat('to mark'), stat('ready to release')], ['0', '2']);
    await type(view.container.querySelector('input[aria-label="Feedback for Ann"]'), 'Great work');
    await click(buttonWith(view.container, 'Release results to all ready (2)'));
    await waitFor(() => textOf(view.container).includes('Released results to 2 students'), 'bulk release');
    const released = Object.fromEntries(globalThis.__TEST_QUIZ__.released.map(r => [r.id, r.update]));
    assert.deepStrictEqual([released.at1.score, released.at1.maxScore, released.at1.percent, released.at1.feedback], [7, 7, 100, 'Great work']);
    assert.deepStrictEqual([released.at2.score, released.at2.percent], [1, 14], 'wrong choice 0, unanswered open question 0');
    assert.strictEqual(stat('released'), '3');
    await view.unmount();
    delete globalThis.__TEST_QUIZ__;
  });

  await test('Teacher application: optional ID check (honest "Not verified" offline), document link box, no stored photo', async () => {
    const { default: TeacherApplicationPostcard } = await load('/src/components/TeacherApplicationPostcard.jsx');
    // jsdom cannot decode images or draw on a canvas: fake a decodable photo and no 2D context, which
    // runs the no-canvas path (a photo is kept only when it is already small enough).
    const saved = { Image: globalThis.Image, FileReader: globalThis.FileReader, getContext: window.HTMLCanvasElement.prototype.getContext };
    globalThis.Image = class {
      set src(value) {
        this.naturalWidth = 1600;
        this.naturalHeight = 1000;
        setTimeout(() => this.onload?.(), 0);
      }
    };
    globalThis.FileReader = window.FileReader;
    window.HTMLCanvasElement.prototype.getContext = () => null;
    try {
      const view = await render(React.createElement(TeacherApplicationPostcard, {
        currentUser: { uid: 'u9', email: 'new@teacher.edu', displayName: 'New Teacher' },
        userProfile: { role: 'Supporter', email: 'new@teacher.edu' }
      }));
      const input = await waitFor(() => view.container.querySelector('#id-file-upload'), 'application form');
      const postButton = () => buttonWith(view.container, 'Post Teacher Application');
      const linkBox = view.container.querySelector('#id-document-url');
      assert(textOf(view.container).includes('Identification Document Verification (optional)'));
      assert(linkBox, 'a box for the link to the original document');
      assert.strictEqual(postButton().disabled, false, 'the ID section is optional');
      // A photo that cannot be shrunk is refused with a plain message.
      await upload(input, [new window.File([new Uint8Array(2 * 1024 * 1024)], 'passport.jpg', { type: 'image/jpeg' })]);
      await waitFor(() => textOf(view.container).includes('The image is too large to attach'), 'friendly size message');
      assert(!textOf(view.container).includes('1048487'), 'never the raw Firestore error');
      // A normal photo is checked; with no Gemini key the result is an honest "Not verified".
      await upload(input, [new window.File([new Uint8Array(20 * 1024)], 'passport-small.jpg', { type: 'image/jpeg' })]);
      await waitFor(() => textOf(view.container).includes('Checked: passport-small.jpg'), 'photo checked');
      const afterCheck = textOf(view.container);
      assert(afterCheck.includes('Not verified — manual review needed'), 'honest result when the AI cannot run');
      assert(!/Confidence: \d+%/.test(afterCheck), 'no made-up confidence score');
      assert(!afterCheck.includes('too large'), 'the earlier error is cleared');
      // The document link must be a web address.
      await type(linkBox, 'http://drive.google.com/file/d/abc');
      assert(textOf(view.container).includes('Use a web address that starts with https://'));
      await submit(view.container.querySelector('form'));
      await waitFor(() => textOf(view.container).includes('The document link must be a web address starting with https://'), 'link validation');
      await type(linkBox, 'https://drive.google.com/file/d/abc/view');
      assert(!textOf(view.container).includes('Use a web address that starts with https://'));
      assert.strictEqual(view.container.querySelector('textarea').maxLength, 8000, 'bio length is limited while typing');
      await submit(view.container.querySelector('form'));
      await waitFor(() => textOf(view.container).includes('Database is unavailable'), 'offline save error shown');
      await view.unmount();
    } finally {
      globalThis.Image = saved.Image;
      globalThis.FileReader = saved.FileReader;
      window.HTMLCanvasElement.prototype.getContext = saved.getContext;
    }
  });

  await test('Teacher application: 0 tokens is saved as FREE and reads FREE on the form, the postcard and the Super Admin card', async () => {
    const appsServer = await makeServer([{
      find: /^(\.\.?\/)+services\/teacherApplicationService(\.js)?$/,
      replacement: fileURLToPath(new URL('./fixtures/teacherApplicationServiceMock.js', import.meta.url))
    }]);
    const { default: TeacherApplicationPostcard } = await appsServer.ssrLoadModule('/src/components/TeacherApplicationPostcard.jsx');
    const { default: SuperAdminTokenPanel } = await appsServer.ssrLoadModule('/src/components/SuperAdminTokenPanel.jsx');
    globalThis.__TEST_APPLICATIONS__ = {
      u7: { id: 'app_u7', applicant_uid: 'u7', applicant_name: 'One Token Teacher', applicant_email: 'one@teacher.edu', subject_specialty: 'Maths', proposed_course_title: 'Algebra', proposed_token_rate: 1, teaching_bio: 'Bio', status: 'pending', ai_id_verification: null, id_document_url: '' }
    };
    try {
      const applicant = { uid: 'u8', email: 'free@teacher.edu', displayName: 'Free Teacher' };
      const view = await render(React.createElement(TeacherApplicationPostcard, { currentUser: applicant, userProfile: { role: 'Supporter', email: applicant.email } }));
      const price = await waitFor(() => view.container.querySelector('#proposed-token-rate'), 'application form');
      const hint = () => textOf(view.container.querySelector('#proposed-token-rate-help')).trim();
      assert.strictEqual(price.value, '10', 'starts at 10 tokens');
      assert.strictEqual(hint(), '🪙 Teachers choose their course token price (0 = FREE)');
      await type(price, '0');
      assert.strictEqual(hint(), 'FREE Students enrol at no cost', 'typing 0 shows FREE');
      await type(price, '12');
      assert(!hint().startsWith('FREE'), 'a price above 0 is not FREE');
      await type(price, '0');
      await type(view.container.querySelector('input[placeholder^="e.g. Applied Machine Learning"]'), 'Marine Science');
      await type(view.container.querySelector('input[placeholder^="e.g. Practical Deep Learning"]'), 'Reef Ecology');
      await type(view.container.querySelector('textarea'), 'Ten years teaching marine science.');
      await submit(view.container.querySelector('form'));
      await waitFor(() => textOf(view.container).includes('Application posted!'), 'application posted');
      assert.strictEqual(globalThis.__TEST_APPLICATIONS__.u8.proposed_token_rate, 0, 'saved as 0 tokens (FREE), not 10');
      const postcard = textOf(view.container);
      assert(postcard.includes('Proposed Course: Reef Ecology (FREE)'), postcard.slice(0, 500));
      assert(!/🪙\s*(0|10)\s*Tokens/.test(postcard), 'neither 0 nor 10 tokens is shown');
      // The app's default text is white; these light cards must set dark text or "FREE" is invisible.
      const lineStartingWith = (scope, start) => Array.from(scope.querySelectorAll('div')).find(d => textOf(d).trim().startsWith(start));
      const inkOf = (el) => {
        for (let node = el; node; node = node.parentElement) if (node.style?.color) return node.style.color;
        return '';
      };
      assert.strictEqual(inkOf(lineStartingWith(view.container, 'Proposed Course:')), 'rgb(30, 41, 59)', 'readable on the postcard');
      await view.unmount();

      // The Super Admin reviews it in 🛡️ Super Admin Control → Teacher Postcards.
      const admin = { uid: 'a1', email: 'support@aifoundation.net.au', displayName: 'Admin' };
      const panel = await render(React.createElement(SuperAdminTokenPanel, { currentUser: admin, userProfile: { role: 'Superadmin', email: admin.email }, isOpen: true, onClose: () => {} }));
      await click(await waitFor(() => buttonWith(panel.container, 'Teacher Postcards (2 pending)'), 'Teacher Postcards tab'));
      await waitFor(() => textOf(panel.container).includes('Free Teacher'), 'applications listed');
      const review = textOf(panel.container);
      assert(review.includes('Proposed Course: Reef Ecology (FREE)'), review.slice(0, 800));
      assert(review.includes('Proposed Course: Algebra (🪙 1 Token)'), 'one token reads "1 Token"');
      assert.strictEqual(inkOf(lineStartingWith(panel.container, 'Proposed Course: Reef Ecology')), 'rgb(30, 41, 59)', 'readable on the white review card');
      await panel.unmount();
    } finally {
      delete globalThis.__TEST_APPLICATIONS__;
    }
  });

  // ---------- signed-in dashboards (auth stand-in, Firebase still offline) ----------
  const signedIn = await makeServer([{
    find: /^(\.\.?\/)+services\/authService(\.js)?$/,
    replacement: fileURLToPath(new URL('./fixtures/authServiceMock.js', import.meta.url))
  }]);
  const { default: SignedInApp } = await signedIn.ssrLoadModule('/src/App.jsx');
  const renderAs = async (user, profile) => {
    globalThis.__TEST_AUTH__ = { user, profile };
    const view = await render(React.createElement(SignedInApp));
    await waitFor(() => view.container.querySelector('.md-bar'), 'signed-in dashboard with message dock');
    return view;
  };

  await test('Teacher dashboard: role menu, Token Fund, Students & People and Submissions open', async () => {
    const view = await renderAs({ uid: 't1', email: teacher.email, displayName: 'Ms T' }, { role: 'teacher', email: teacher.email });
    const nav = view.container.querySelector('nav.header-nav');
    for (const label of ['My Courses', 'Student Registration', 'Global Search', 'Token Fund', 'Tokens']) assert(buttonWith(nav, label), `teacher sees ${label}`);
    const myCourseCards = view.container.querySelector('.cards-grid');
    assert(myCourseCards && textOf(myCourseCards).includes('Introduction to AI'), 'My Courses cards');
    assert(!/🪙\s*\d+\s*Tokens/.test(textOf(myCourseCards)), 'course cards show no enrolment cost');
    assert(!buttonWith(nav, 'Join as Teacher'), 'teachers do not see the application form');
    assert(!buttonWith(nav, 'Super Admin Control'));
    await click(buttonWith(view.container, 'Students & People'));
    assert(textOf(view.container).includes('Add Members to Course'), 'Add People modal now opens from the dashboard');
    await click(buttonWith(view.container, '×'));
    await click(buttonWith(view.container, 'Submissions'));
    await waitFor(() => textOf(view.container).includes('📥 Submissions'), 'submissions modal');
    await click(view.container.querySelector('.cs-modal .close-btn'));
    await click(buttonWith(nav, 'Token Fund'));
    assert(textOf(view.container).includes('Sponsor a Student'));
    await click(view.container.querySelector('[aria-labelledby="token-fund-title"] .close-btn'));
    await click(buttonWith(nav, 'Global Search'));
    await waitFor(() => textOf(view.container).includes('Published OzEdu courses could not be loaded'), 'offline published-courses notice');
    assert(/Curated Course Catalog/i.test(textOf(view.container)));
    assert(buttonWith(view.container, '+ Copy to My Courses'), 'catalog courses can be copied');
    await view.unmount();
  });

  await test('Student dashboard: Student Panel, Join as Teacher, Global Search, no teacher tools', async () => {
    const view = await renderAs({ uid: 's1', email: 'stu@school.edu', displayName: 'Stu' }, { role: 'Supporter', email: 'stu@school.edu' });
    const nav = view.container.querySelector('nav.header-nav');
    for (const label of ['Student Panel', 'Join as Teacher', 'Global Search', 'Token Fund']) assert(buttonWith(nav, label), `student sees ${label}`);
    for (const label of ['My Courses', 'Student Registration']) assert(!buttonWith(nav, label), `student does not see ${label}`);
    await waitFor(() => textOf(view.container).includes('You are not enrolled in any courses yet'), 'student landing page');
    assert(textOf(view.container).includes('stu@school.edu'));
    // Student can view Global Search, but cannot enrol or copy
    await click(buttonWith(nav, 'Global Search'));
    await waitFor(() => /Curated Course Catalog/i.test(textOf(view.container)), 'global courses visible to student');
    assert(textOf(view.container).includes('Enrolment by Teacher Only'), 'enrolment by teacher only notice shown to student');
    assert(!buttonWith(view.container, '+ Copy to My Courses'), 'student cannot copy or enrol directly');
    // Front page -> Contact -> "Message the Super Admin" opens the admin panel with a message to the Super Admin ready.
    await click(view.container.querySelector('.logo-btn'));
    await click(await waitFor(() => buttonWith(view.container.querySelector('nav.header-nav'), 'Contact'), 'front page Contact'));
    await click(buttonWith(view.container.querySelector('.contact-steps'), 'Message the Super Admin'));
    const to = await waitFor(() => view.container.querySelector('#md-to'), 'message composer opened');
    assert.strictEqual(to.value, 'superadmin', 'addressed to the Super Admin');
    assert(view.container.querySelector('.md-bar'), 'back in the admin panel');
    await view.unmount();
  });

  await test('Super Admin dashboard: UNL tokens and the control panel', async () => {
    const view = await renderAs({ uid: 'a1', email: 'support@aifoundation.net.au', displayName: 'Admin' }, { role: 'Superadmin', email: 'support@aifoundation.net.au' });
    const nav = view.container.querySelector('nav.header-nav');
    assert(textOf(nav).includes('🪙 UNL Tokens'), 'Super Admin balance shows UNL');
    assert(!textOf(nav).includes('+Buy'), 'no buy prompt for unlimited tokens');
    await click(buttonWith(nav, 'Super Admin Control'));
    await waitFor(() => textOf(view.container).includes('Give tokens to any registered account'), 'Give Tokens tab');
    await view.unmount();
    delete globalThis.__TEST_AUTH__;
  });

  await test('Phone header (signed in): the Google button opens a role menu whose first item is the role status', async () => {
    const menuButtons = (nav) => Array.from(nav.children).filter(el => el.tagName === 'BUTTON').map(b => b.textContent.replace(/\s+/g, ' ').trim());
    const memberItems = ['Student Panel', 'Global Search', 'Join as Teacher', 'Token Fund', 'Tokens', 'Logout'];
    const roles = [
      { user: { uid: 's1', email: 'stu@school.edu', displayName: 'Stu' }, profile: { role: 'Supporter', email: 'stu@school.edu' }, label: 'Supporter', items: memberItems },
      { user: { uid: 's2', email: 'lee@school.edu', displayName: 'Lee' }, profile: { role: 'student', email: 'lee@school.edu' }, label: 'Student', items: memberItems },
      { user: { uid: 't1', email: teacher.email, displayName: 'Ms T' }, profile: { role: 'teacher', email: teacher.email }, label: 'Teacher', items: ['My Courses', 'Student Registration', 'Global Search', 'Token Fund', 'Tokens', 'Logout'] },
      { user: { uid: 'a1', email: 'support@aifoundation.net.au', displayName: 'Admin' }, profile: { role: 'Superadmin', email: 'support@aifoundation.net.au' }, label: 'Super Admin', items: ['My Courses', 'Student Registration', 'Global Search', 'Token Fund', 'UNL Tokens', 'Super Admin Control', 'Logout'] }
    ];
    // jsdom has no matchMedia: a stand-in lets the test widen the window to the desktop layout.
    const widthListeners = new Set();
    window.matchMedia = (media) => ({ media, matches: false, addEventListener: (_type, fn) => widthListeners.add(fn), removeEventListener: (_type, fn) => widthListeners.delete(fn) });
    try {
      for (const r of roles) {
        const view = await renderAs(r.user, r.profile);
        const header = view.container.querySelector('header.header');
        const nav = header.querySelector('nav.header-nav');
        const account = header.querySelector('.mobile-account-btn');
        const isOpen = () => account.getAttribute('aria-expanded') === 'true' && nav.classList.contains('mobile-open') && Boolean(header.querySelector('.mobile-nav-backdrop'));
        const isClosed = () => account.getAttribute('aria-expanded') === 'false' && !nav.classList.contains('mobile-open') && !header.querySelector('.mobile-nav-backdrop');
        assert(account && account.previousElementSibling?.classList.contains('logo-btn'), `${r.label}: Google button next to the logo (top right)`);
        assert(account.querySelector('svg'), 'Google "G" on the button');
        assert(!view.container.querySelector('.mobile-menu-toggle, .hamburger-line'), 'the 3-bar menu is gone');
        assert.strictEqual(account.getAttribute('aria-controls'), nav.id, 'the button controls the menu');
        assert(account.getAttribute('aria-label').includes(r.label), account.getAttribute('aria-label'));
        assert(isClosed(), `${r.label}: menu starts closed`);
        // Role status is always the first item, then the role's own items, Logout last.
        const status = nav.firstElementChild;
        assert(status.classList.contains('mobile-role-status'), `${r.label}: role status is the first item`);
        assert(textOf(status).includes(r.user.email) && textOf(status).includes(`Role: ${r.label}`), textOf(status));
        const items = menuButtons(nav);
        assert.strictEqual(items.length, r.items.length, `${r.label} menu: ${items.join(' | ')}`);
        r.items.forEach((label, i) => assert(items[i].includes(label), `${r.label} item ${i + 1}: expected ${label}, got ${items[i]}`));

        await click(account);
        assert(isOpen(), `${r.label}: pressing the Google button opens the menu`);
        await click(account);
        assert(isClosed(), 'pressing it again closes it');
        await click(account);
        await click(header.querySelector('.mobile-nav-backdrop'));
        assert(isClosed(), 'tapping outside closes it');
        await click(account);
        await act(async () => { document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        assert(isClosed(), 'Escape closes it');
        assert.strictEqual(document.activeElement, account, 'focus returns to the Google button');
        await click(account);
        assert.strictEqual(widthListeners.size, 1, 'listens for the desktop width only while open');
        await act(async () => { for (const fn of [...widthListeners]) fn({ matches: true }); });
        assert(isClosed(), 'widening to the desktop layout closes it');
        assert.strictEqual(widthListeners.size, 0, 'listener removed when closed (no leak)');
        await click(account);
        await click(buttonWith(nav, 'Global Search'));
        assert(isClosed(), 'choosing an item closes the menu');
        await waitFor(() => /Curated Course Catalog/i.test(textOf(view.container)), `${r.label}: Global Search opened from the menu`);
        await view.unmount();
      }

      // Signed-in front page: same Google button and role status, then the front-page items.
      const view = await renderAs(roles[2].user, roles[2].profile);
      await click(view.container.querySelector('.logo-btn'));
      const header = await waitFor(() => view.container.querySelector('.hero-text') && view.container.querySelector('header.header'), 'front page');
      const nav = header.querySelector('nav.header-nav');
      await click(header.querySelector('.mobile-account-btn'));
      assert(nav.classList.contains('mobile-open'));
      assert(nav.firstElementChild.classList.contains('mobile-role-status') && textOf(nav.firstElementChild).includes('Role: Teacher'));
      assert.deepStrictEqual(menuButtons(nav).map(t => t.replace(/^\W+/u, '')), ['Contact', 'Go to Admin', 'Token Fund', 'Logout']);
      // Logging out from the menu closes it and brings back Sign in with Google.
      await click(buttonWith(nav, 'Logout'));
      await waitFor(() => view.container.querySelector('header.header .mobile-signin-btn'), 'signed out');
      assert(!view.container.querySelector('.mobile-account-btn, .mobile-nav-backdrop, nav.header-nav.mobile-open, .mobile-role-status'), 'menu gone after logout');
      await view.unmount();
    } finally {
      delete window.matchMedia;
      delete globalThis.__TEST_AUTH__;
    }
  });

  await test('Phone header CSS: hidden on desktop, menu closed until the Google button is pressed', async () => {
    const css = readFileSync(fileURLToPath(new URL('../src/App.css', import.meta.url)), 'utf8');
    const phone = mediaBlocks(css, '@media (max-width: 768px)').join('\n');
    const desktop = mediaBlocks(css, '@media (min-width: 769px)').join('\n');
    const base = stripMediaBlocks(css);
    assert(/display:\s*none/.test(ruleBody(base, '.header .mobile-signin-btn, .header .mobile-account-btn, .header-nav .mobile-role-status, .footer .mobile-footer-contact') || ''),
      'phone-only pieces are hidden by default (desktop and laptop)');
    for (const name of ['mobile-signin-btn', 'mobile-account-btn', 'mobile-role-status', 'mobile-footer-contact']) {
      assert(!desktop.includes(name), `${name} is never shown by the desktop rules`);
    }
    assert(/display:\s*inline-flex/.test(ruleBody(phone, '.header .mobile-signin-btn') || ''), 'phones show Sign in with Google');
    assert(/display:\s*inline-flex/.test(ruleBody(phone, '.header .mobile-account-btn') || ''), 'phones show the Google account button');
    assert(/display:\s*flex/.test(ruleBody(phone, '.header-nav .mobile-role-status') || ''), 'phones show the role status item');
    // ".header nav { display: flex }" out-ranks a plain ".header-nav" rule, which once kept the phone menu open.
    assert(/display:\s*none/.test(ruleBody(phone, '.header .header-nav') || ''), 'phone menu is closed by default');
    assert(/display:\s*flex/.test(ruleBody(phone, '.header .header-nav.mobile-open') || ''), 'phone menu opens with .mobile-open');
    assert(!/mobile-menu-toggle|hamburger/.test(css), 'no 3-bar menu styles left');
  });

  await test('Phone postcards CSS: course postcards fit their column, so they never overlap or run off the screen', async () => {
    const css = readFileSync(fileURLToPath(new URL('../src/App.css', import.meta.url)), 'utf8');
    const phone = mediaBlocks(css, '@media (max-width: 600px)').join('\n');
    // A square postcard with a minimum height is stretched wider than its column: postcards overlapped
    // each other and pushed the phone page past the right edge.
    const postcards = ruleBody(phone, '.global-cards-grid-4x6 > .global-course-card, .cards-grid:not(.front-cards-grid) > .card') || '';
    for (const rule of [/aspect-ratio:\s*auto/, /min-width:\s*0/, /min-height:\s*0/]) {
      assert(rule.test(postcards), `phone postcards: ${rule} (got: ${postcards.trim()})`);
    }
    assert(/flex-wrap:\s*wrap/.test(ruleBody(phone, '.pagination-actions') || ''), 'pagination buttons wrap on phones');
    assert(/width:\s*100%\s*!important/.test(ruleBody(phone, '.global-filter-row > .search-input, .global-filter-row > .filter-select') || ''),
      'the search box and subject filter fit the screen');
  });

  console.log(`\n🎉 All UI interaction tests passed (${passed}).`);
}

let exitCode = 0;
try {
  await run();
} catch (err) {
  console.error('❌ UI test failure:', err);
  exitCode = 1;
} finally {
  for (const server of servers) await server.close();
  window.close();
}
process.exit(exitCode);
