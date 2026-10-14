/**
 * UI interaction tests: real React components in jsdom, loaded through Vite (JSX, ?raw imports).
 * Firebase is replaced by an offline stub, so every screen also proves its graceful-degradation
 * path, and no .env keys are loaded (no network calls to Gemini or Firestore).
 * Run: node tests/ui.test.js
 */

import assert from 'node:assert';
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
    const pcLabel = Array.from(view.container.querySelectorAll('.unit-editor-header label')).find(l => l.textContent.trim() === 'Performance Criteria');
    assert(pcLabel, 'unit box below Unit Code / Title / Nominal Hours is titled Performance Criteria');
    assert.strictEqual(document.getElementById(pcLabel.htmlFor)?.tagName, 'TEXTAREA', 'label is linked to its box');
    const toolbar = view.container.querySelector('.add-block-toolbar');
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
    // Units: lessons & blocks only.
    assert.deepStrictEqual(Array.from(view.container.querySelectorAll('.unit-tabs-row .tab-btn')).map(t => t.textContent.trim()), ['📚 Lessons & Blocks (1)']);
    const toolbar = view.container.querySelector('.add-block-toolbar');
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
    // Course-level assessments: one section reached from the sidebar.
    await click(view.container.querySelector('.course-assessments-nav'));
    assert.strictEqual(view.container.querySelectorAll('.assessment-card').length, 1, 'the blank course starts with one task');
    await click(buttonWith(view.container.querySelector('.assessments-container'), '+ Summative Task'));
    assert.strictEqual(view.container.querySelectorAll('.assessment-card').length, 2);
    assert(textOf(view.container).includes('should add up to 100%'), 'weighting total is checked across the course');
    await click(buttonWith(view.container, 'Save Draft'));
    const savedQuiz = saved[0].units[0].lessons[0].blocks.find(b => b.type === 'quiz').quiz;
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
    assert(summary.includes('2 units') && summary.includes('4 lessons') && summary.includes('10 rubric criteria'), summary);
    await click(buttonWith(view.container, 'Import into Course Builder (free)'));
    assert(!view.container.querySelector('.ssp'), 'window closes after import');
    assert(textOf(view.container).includes('Course Builder: Diploma of Sustainable Business Practice'));
    assert(textOf(view.container).includes('Imported "Diploma of Sustainable Business Practice"'));
    const navCodes = Array.from(view.container.querySelectorAll('.unit-nav-code')).map(n => n.textContent);
    assert.deepStrictEqual(navCodes, ['SBP501', 'SBP502']);
    // Lessons-tab link columns: several YouTube / Google Drive / Gemini Notebook links per lesson.
    const lessonCards = view.container.querySelectorAll('.lesson-card');
    const linksIn = (card, blockType) => Array.from(card.querySelectorAll(`.content-block-item.type-${blockType} input.form-input:not(.block-title-input)`)).map(i => i.value);
    assert.deepStrictEqual(linksIn(lessonCards[0], 'youtube_video'), ['https://www.youtube.com/watch?v=REPLACE_WITH_VIDEO_ID_1', 'https://www.youtube.com/watch?v=REPLACE_WITH_VIDEO_ID_2']);
    assert.deepStrictEqual(linksIn(lessonCards[0], 'google_drive_link'), ['https://docs.google.com/presentation/d/REPLACE_WITH_SLIDES_ID/view']);
    assert.deepStrictEqual(linksIn(lessonCards[0], 'notebook_link'), ['https://notebooklm.google.com/notebook/REPLACE_WITH_NOTEBOOK_ID_1']);
    assert.strictEqual(linksIn(lessonCards[1], 'google_drive_link').length, 2, 'two Drive resources');
    assert.strictEqual(linksIn(lessonCards[1], 'notebook_link').length, 2, 'two Gemini Notebooks');
    const lessonOneTitles = Array.from(lessonCards[0].querySelectorAll('.content-block-item .block-title-input')).map(i => i.value);
    assert.deepStrictEqual(lessonOneTitles, ['Key ideas', 'Facilitation notes', 'Check your understanding', 'Introductory video', 'The triple bottom line explained', 'Lesson slides', 'Study notebook']);
    // Unit quiz imported from the Quiz Questions tab, answer keys included (teacher view).
    const quizEditor = lessonCards[0].querySelector('.content-block-item.type-quiz');
    assert.strictEqual(quizEditor.querySelectorAll('.qb-question').length, 4);
    assert.deepStrictEqual(Array.from(quizEditor.querySelectorAll('.qb-type')).map(s => s.value), ['multiple_choice', 'true_false', 'short_answer', 'open']);
    const firstOptions = quizEditor.querySelectorAll('.qb-question')[0].querySelectorAll('.qb-option');
    assert.deepStrictEqual(Array.from(firstOptions).map(o => o.querySelector('input[type=radio]').checked), [false, false, false, true], 'correct answer D is ticked');
    // Units have lessons & blocks only; the course has one Assessments & Rubrics section.
    assert(!textOf(view.container.querySelector('.unit-tabs-row')).includes('Assessments'), 'no per-unit assessments tab');
    await click(buttonWith(view.container.querySelector('.builder-sidebar'), 'Assessments & Rubrics'));
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
    await click(buttonWith(view.container, 'Assessments & Rubrics'));
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
    await click(buttonWith(view.container, '←'));
    await click(buttonWith(view.container, 'Request tokens'));
    assert(view.container.querySelector('#md-amount'));
    await view.unmount();
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
    // Unit quiz inside the lesson
    const quizForm = await waitFor(() => view.container.querySelector('form.sq-quiz'), 'quiz form');
    assert(textOf(quizForm).includes('Answer both.') && textOf(quizForm).includes('0/2 answered'));
    assert.strictEqual(buttonWith(quizForm, 'Submit quiz').disabled, true, 'nothing answered yet');
    await click(quizForm.querySelectorAll('input[type=radio]')[1]);
    await type(quizForm.querySelector('textarea'), 'Heat stress.');
    assert(textOf(quizForm).includes('2/2 answered'));
    await submit(quizForm);
    await waitFor(() => textOf(view.container).includes('Quizzes are unavailable right now'), 'offline quiz error');
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
    assert(textOf(view.container).includes('Curated course catalog'));
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
    await waitFor(() => textOf(view.container).includes('Curated course catalog'), 'global courses visible to student');
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
