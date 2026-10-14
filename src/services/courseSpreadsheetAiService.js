/**
 * ✨ AI Assist from spreadsheets: Gemini builds out the entire course from the teacher's workbook.
 *
 * Guarantees (enforced in code after every Gemini response, not just requested in the prompt):
 * 1. Every value the teacher typed is kept exactly; Gemini only fills blanks and empty sections.
 * 2. The teacher's structure (units, their blocks and quizzes, the course's assessments, rubric
 *    criteria) and order are kept. Units hold their content and blocks; assessments are one
 *    course-level list.
 * 3. Gemini never adds links: link blocks need a URL that already appears in the spreadsheet.
 *
 * Reliability:
 * - One call for the outline (when needed), one call per unit (bounded concurrency) and one for the
 *   course assessments, so large courses never exceed model output limits and one failed call does
 *   not lose the rest.
 * - The AI Assist fee is charged once, only after Gemini returns usable content. If Gemini is
 *   unavailable the build stops with no charge, and the teacher can import without AI.
 */

import { getAqfLevelMeta, DEFAULT_RUBRIC_LEVEL_LABELS, LINK_BLOCK_METADATA_KEYS } from '../types/courseBuilderTypes.js';
import { sanitizeStandardIds } from './curriculumStandards.js';
import { generateGeminiJson, GEMINI_ERROR } from './geminiClient.js';
import { DEFAULT_GEMINI_KEY } from './geminiCourseService.js';
import {
  buildStandardsGuidance,
  checkAiAssistBalance,
  chargeAiAssistFee,
  createUrlPolicy,
  sanitizeAiUnit,
  sanitizeAiCourseFields,
  sanitizeAiAssessments,
  normalizeRubricWeights,
  UNIT_RESPONSE_SCHEMA,
  OUTLINE_RESPONSE_SCHEMA,
  ASSESSMENTS_RESPONSE_SCHEMA
} from './aiCourseShared.js';
import { finalizeCourseDraft, hasSpreadsheetContent } from './courseSpreadsheetImport.js';
import { normalizeKey, isHttpUrl } from './courseSpreadsheetSchema.js';

const MAX_PROMPT_UNSTRUCTURED_CHARS = 20000;

// ---------- merge (teacher values always win) ----------

function isBlank(value) {
  return value === null || value === undefined || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && value.length === 0);
}

function pick(teacherValue, aiValue) {
  return isBlank(teacherValue) ? (aiValue ?? teacherValue) : teacherValue;
}

/** For each teacher item, the AI item with the same key, else the AI item at the same position. */
function pairItems(teacherItems, aiItems, keyOf) {
  const used = new Set();
  const byKey = new Map();
  aiItems.forEach((item, i) => {
    const key = keyOf(item);
    if (key && !byKey.has(key)) byKey.set(key, i);
  });
  const pairs = teacherItems.map(item => {
    const key = keyOf(item);
    const i = key ? byKey.get(key) : undefined;
    if (i !== undefined && !used.has(i)) {
      used.add(i);
      return i;
    }
    return -1;
  });
  return pairs.map((i, position) => {
    if (i >= 0) return aiItems[i];
    if (position < aiItems.length && !used.has(position)) {
      used.add(position);
      return aiItems[position];
    }
    return null;
  });
}

export function mergeCourseFields(teacher, ai) {
  const t = teacher || {};
  const a = ai || {};
  return {
    ...t,
    title: pick(t.title, a.title),
    code: pick(t.code, a.code),
    category: pick(t.category, a.category),
    description: pick(t.description, a.description),
    aqfEquivalenceNotes: pick(t.aqfEquivalenceNotes, a.aqfEquivalenceNotes),
    learningOutcomes: t.learningOutcomes?.length ? t.learningOutcomes : (a.learningOutcomes || [])
  };
}

/** Comparable form of a link block's URL ('' when it has none). Case is kept: video ids are case-sensitive. */
function linkKey(block) {
  const url = String(block?.content ?? '').trim();
  return LINK_BLOCK_METADATA_KEYS[block?.type] && isHttpUrl(url) ? url.replace(/[#/]+$/, '') : '';
}

/**
 * @param {{ allowNewQuiz?: boolean, quizAdded?: boolean }} [quizBudget] shared per unit: Gemini adds at
 *   most one quiz to a unit, and only when the teacher's unit has none.
 */
export function mergeBlocks(teacherBlocks, aiBlocks, quizBudget = { allowNewQuiz: true }) {
  const teacher = teacherBlocks || [];
  const allowQuiz = () => quizBudget.allowNewQuiz && !quizBudget.quizAdded;
  const ai = (aiBlocks || []).filter(b => b?.type !== 'quiz' || teacher.some(t => t?.type === 'quiz') || allowQuiz());
  if (!teacher.length) {
    const added = [];
    for (const b of ai) {
      if (b.type === 'quiz') {
        if (!allowQuiz()) continue;
        quizBudget.quizAdded = true;
      }
      added.push(b);
    }
    return added;
  }
  const used = new Set();
  const merged = teacher.map(block => {
    const link = linkKey(block);
    let index;
    if (link) {
      // A teacher link only takes details from Gemini's block for the same link, so with several
      // videos, Drive files or notebooks in a unit no link gets another link's title.
      index = ai.findIndex((candidate, i) => !used.has(i) && candidate.type === block.type && linkKey(candidate) === link);
    } else {
      index = ai.findIndex((candidate, i) => !used.has(i) && candidate.type === block.type &&
        (!block.title || normalizeKey(candidate.title) === normalizeKey(block.title)));
      if (index < 0) index = ai.findIndex((candidate, i) => !used.has(i) && candidate.type === block.type);
    }
    if (index < 0) return block;
    used.add(index);
    const match = ai[index];
    const merged = { ...block, title: pick(block.title, match.title), content: pick(block.content, match.content) };
    // A teacher's quiz is kept as written; an empty quiz the teacher placed takes Gemini's questions.
    if (block.type === 'quiz') merged.quiz = block.quiz?.questions?.length ? block.quiz : (match.quiz || block.quiz);
    return merged;
  });
  // Add block types the teacher's unit lacks (e.g. a teacher guide), one of each.
  const present = new Set(merged.map(b => b.type));
  ai.forEach((candidate, i) => {
    if (used.has(i) || present.has(candidate.type)) return;
    if (candidate.type === 'quiz') {
      if (!allowQuiz()) return;
      quizBudget.quizAdded = true;
    }
    merged.push(candidate);
    present.add(candidate.type);
  });
  return merged;
}

export function mergeRubric(teacherRubric, aiRubric) {
  const teacher = teacherRubric || [];
  const ai = aiRubric || [];
  if (!teacher.length) return normalizeRubricWeights(ai);
  const pairs = pairItems(teacher, ai, c => normalizeKey(c.criterionTitle));
  return teacher.map((criterion, i) => {
    const match = pairs[i];
    const aiLevels = match?.levels || [];
    const levels = criterion.levels?.length
      ? criterion.levels.map((level, li) => {
          const sameLabel = aiLevels.find(l => normalizeKey(l.label) === normalizeKey(level.label));
          return { label: level.label, descriptor: pick(level.descriptor, (sameLabel || aiLevels[li])?.descriptor || '') };
        })
      : aiLevels;
    return {
      criterionTitle: pick(criterion.criterionTitle, match?.criterionTitle),
      weightPercentage: criterion.weightPercentage ?? match?.weightPercentage ?? null,
      levels
    };
  });
}

function mergeAssessment(teacher, ai) {
  if (!ai) return teacher;
  return {
    ...teacher,
    unitIndex: Number.isInteger(teacher.unitIndex) && teacher.unitIndex >= 0 ? teacher.unitIndex : (ai.unitIndex ?? -1),
    title: pick(teacher.title, ai.title),
    type: teacher.type || ai.type,
    description: pick(teacher.description, ai.description),
    dueDate: teacher.dueDate || ai.dueDate || '',
    nominalWeight: teacher.nominalWeight ?? ai.nominalWeight ?? null,
    externalSubmissionLinks: teacher.externalSubmissionLinks?.length ? teacher.externalSubmissionLinks : (ai.externalSubmissionLinks || []),
    rubric: mergeRubric(teacher.rubric, ai.rubric)
  };
}

/** Merges Gemini's unit into the teacher's unit (content & blocks): teacher values and structure win. */
export function mergeUnit(teacher, ai) {
  if (!ai) return teacher;
  const teacherBlocks = Array.isArray(teacher.blocks) ? teacher.blocks : [];
  const teacherHasQuiz = teacherBlocks.some(b => b?.type === 'quiz');
  const quizBudget = { allowNewQuiz: !teacherHasQuiz, quizAdded: false };
  return {
    ...teacher,
    unitCode: pick(teacher.unitCode, ai.unitCode),
    unitTitle: pick(teacher.unitTitle, ai.unitTitle),
    nominalHours: teacher.nominalHours ?? ai.nominalHours ?? null,
    description: pick(teacher.description, ai.description),
    learningOutcomes: teacher.learningOutcomes?.length ? teacher.learningOutcomes : (ai.learningOutcomes || []),
    content: pick(teacher.content, ai.content),
    blocks: mergeBlocks(teacherBlocks, ai.blocks, quizBudget)
  };
}

/** Merges Gemini's course assessments into the teacher's list: teacher tasks, values and order win. */
export function mergeCourseAssessments(teacherList, aiList) {
  const teacher = Array.isArray(teacherList) ? teacherList : [];
  const ai = Array.isArray(aiList) ? aiList : [];
  if (!teacher.length) return ai.map(a => ({ ...a, rubric: normalizeRubricWeights(a.rubric) }));
  const pairs = pairItems(teacher, ai, a => normalizeKey(a.title));
  return teacher.map((a, i) => mergeAssessment(a, pairs[i]));
}

// ---------- prompts ----------

function levelHeader(aqfLevel) {
  const meta = getAqfLevelMeta(aqfLevel);
  return `TARGET LEVEL: AQF Level ${meta.level} — ${meta.credential}. ${meta.summary}\nExpected autonomy and cognitive demand: ${meta.competencySummary}`;
}

function unitForPrompt(unit) {
  return {
    unitCode: unit.unitCode || '',
    unitTitle: unit.unitTitle || '',
    nominalHours: unit.nominalHours ?? null,
    description: unit.description || '',
    learningOutcomes: unit.learningOutcomes || [],
    ...(Array.isArray(unit.topics) && unit.topics.length ? { topics: unit.topics } : {}),
    content: unit.content || '',
    blocks: (unit.blocks || []).map(b => ({
      type: b.type,
      title: b.title || '',
      content: b.content || '',
      ...(b.type === 'quiz' ? { questions: (b.quiz?.questions || []).length } : {})
    }))
  };
}

function assessmentsForPrompt(assessments, units) {
  return (assessments || []).map(a => ({
    title: a.title || '',
    unitCode: Number.isInteger(a.unitIndex) && a.unitIndex >= 0 ? units[a.unitIndex]?.unitCode || '' : '',
    type: a.type || '',
    description: a.description || '',
    dueDate: a.dueDate || '',
    nominalWeight: a.nominalWeight ?? null,
    externalSubmissionLinks: a.externalSubmissionLinks || [],
    rubric: (a.rubric || []).map(c => ({
      criterionTitle: c.criterionTitle || '',
      weightPercentage: c.weightPercentage ?? null,
      levels: (c.levels || []).map(l => ({ label: l.label, descriptor: l.descriptor || '' }))
    }))
  }));
}

function courseForPrompt(course) {
  return {
    title: course.title || '',
    code: course.code || '',
    category: course.category || '',
    description: course.description || '',
    aqfEquivalenceNotes: course.aqfEquivalenceNotes || '',
    learningOutcomes: course.learningOutcomes || []
  };
}

export function buildOutlinePrompt({ course, units, unstructuredText, aqfLevel, guidance }) {
  const unitList = units.length
    ? units.map((u, i) => `${i + 1}. unitCode: ${JSON.stringify(u.unitCode || '')}, unitTitle: ${JSON.stringify(u.unitTitle || '')}`).join('\n')
    : 'None — design the units.';
  return `You are an expert curriculum architect for OzEdu, an Australian online learning platform.
A teacher uploaded course spreadsheets. Plan the course outline.

${levelHeader(aqfLevel)}

${guidance}

THE TEACHER'S COURSE DETAILS (authoritative; "" or [] means blank):
${JSON.stringify(courseForPrompt(course))}

THE TEACHER'S UNITS (authoritative):
${unitList}

UNSTRUCTURED SPREADSHEET CONTENT (rows the importer could not map; use it as source material):
"""
${String(unstructuredText || '(none)').slice(0, MAX_PROMPT_UNSTRUCTURED_CHARS)}
"""

RULES
1. Copy every non-blank teacher value exactly. Write values only for blank fields.
2. If the teacher listed units, return exactly those units in the same order with the same unitCode and unitTitle, filling only blank fields. Otherwise design 3-8 units that cover the source material, each with a unique unitCode.
3. learningOutcomes: 4-8 measurable outcomes that start with Bloom's Taxonomy verbs suited to the level (keep the teacher's if given).
4. Never invent URLs.

Return only a JSON object: {"title","code","category","description","aqfEquivalenceNotes","learningOutcomes":[],"units":[{"unitCode","unitTitle","nominalHours","description","learningOutcomes":[]}]}`;
}

export function buildUnitPrompt({ course, unit, index, units, unstructuredText, aqfLevel, guidance }) {
  const unitList = units.map((u, i) => `${i + 1}. ${u.unitCode || '(no code)'} — ${u.unitTitle || '(untitled)'}`).join('\n');
  const unstructured = String(unstructuredText || '').slice(0, MAX_PROMPT_UNSTRUCTURED_CHARS);

  return `You are an expert curriculum designer for OzEdu, an Australian online learning platform.
Build out ONE unit of the course "${course.title || 'Untitled course'}"${course.code ? ` (${course.code})` : ''}.

${levelHeader(aqfLevel)}

${guidance}

COURSE CONTEXT (read-only)
- Description: ${course.description || '(blank)'}
- Course learning outcomes: ${(course.learningOutcomes || []).join('; ') || '(blank)'}
- Course start date: ${course.startDate || 'not set'}
- Units in this course:
${unitList}
- This is unit ${index + 1} of ${units.length}.

THE TEACHER'S DRAFT OF THIS UNIT (authoritative; "", null and [] are blanks to fill):
${JSON.stringify(unitForPrompt(unit))}
${unstructured ? `
SPREADSHEET CONTENT THE IMPORTER COULD NOT MAP (use whatever belongs to this unit):
"""
${unstructured}
"""
` : ''}
RULES
1. Keep every content block in the teacher's draft, in the same order. Copy every non-blank value exactly (titles, text, links). Write content only for blank values. A unit has its "content" and "blocks" only (no lessons) — the course's assessments are planned separately.
2. "content" is the unit's teaching text: the lesson paragraphs students read. If it is blank, write it: accurate, engaging instructional paragraphs (500-1,000 words; simple Markdown allowed) that cover the performance criteria (description) and outcomes. If "topics" are listed (the teacher's lesson titles), cover each one, in order, under its own short heading. A "text_description" block is the Unit Description, shown at the top of the unit above the performance criteria: if the unit has none, add one (2-4 sentences: what the unit covers, who it is for and why it matters). The unit also needs one "teacher_guide" block (facilitation steps, timings, discussion prompts, common misconceptions); add it if the teacher's unit lacks one.
3. Links: never invent URLs. Only use URLs that already appear in the teacher's draft or the spreadsheet content. Link blocks are "youtube_video" (YouTube Video), "google_drive_link" (Google Drive Resource) and "notebook_link" (Gemini Notebook): one block per link, and a unit may have several of each — keep every one of the teacher's link blocks with its own URL. Do not create link blocks (or "file_upload" blocks) without such a URL; suggest video or resource search terms inside the teacher_guide text instead.
4. Unit quiz: never change the teacher's "quiz" blocks. If this unit has no "quiz" block, add ONE "quiz" block at the end of the unit's blocks: title (e.g. "Unit quiz"), content = one line of instructions, and "questions": 4-6 questions that check the unit's learning outcomes — mostly "multiple_choice" ("options": 3-5 answer texts, "correct": zero-based indexes of the right options), "true_false" ("correctAnswer": true or false) and "short_answer" ("acceptedAnswers": 1-3 short accepted answers), plus exactly one "open" question with a "modelAnswer" (seen by teachers only). Give each question "points" (1 for closed questions, 5 for the open one).
5. Fill blank unit fields: 3-6 measurable learningOutcomes, realistic nominalHours, and a clear description.

Return only a JSON object: {"unitCode","unitTitle","nominalHours","description","learningOutcomes":[],"content","blocks":[{"type","title","content","questions":[{"type","prompt","options":[],"correct":[],"correctAnswer","acceptedAnswers":[],"modelAnswer","points"}]}]}`;
}

export function buildAssessmentsPrompt({ course, units, assessments, unstructuredText, aqfLevel, guidance, levelLabels, standardsActive }) {
  const unitList = units.length
    ? units.map((u, i) => `${i + 1}. unitCode: ${JSON.stringify(u.unitCode || '')}, unitTitle: ${JSON.stringify(u.unitTitle || '')}, outcomes: ${(u.learningOutcomes || []).join('; ') || '(blank)'}`).join('\n')
    : '(none)';
  const labels = (levelLabels && levelLabels.length ? levelLabels : DEFAULT_RUBRIC_LEVEL_LABELS).join(' | ');
  const labelRule = standardsActive && !(levelLabels && levelLabels.length)
    ? `use the tier labels required by the curriculum standards above (4 levels); if they define none, use exactly: ${labels}`
    : `label the levels exactly: ${labels}`;
  const unstructured = String(unstructuredText || '').slice(0, MAX_PROMPT_UNSTRUCTURED_CHARS);
  return `You are an expert assessment designer for OzEdu, an Australian online learning platform.
Plan the assessment tasks for the WHOLE course "${course.title || 'Untitled course'}"${course.code ? ` (${course.code})` : ''}. A course has ONE Assessments & Rubrics list; units have only their content, blocks and quizzes.

${levelHeader(aqfLevel)}

${guidance}

COURSE CONTEXT (read-only)
- Description: ${course.description || '(blank)'}
- Course learning outcomes: ${(course.learningOutcomes || []).join('; ') || '(blank)'}
- Course start date: ${course.startDate || 'not set'}
- Units:
${unitList}

THE TEACHER'S ASSESSMENT TASKS (authoritative; "", null and [] are blanks to fill):
${JSON.stringify(assessmentsForPrompt(assessments, units))}
${unstructured ? `
SPREADSHEET CONTENT THE IMPORTER COULD NOT MAP (use any assessment details in it):
"""
${unstructured}
"""
` : ''}
RULES
1. Keep every teacher task and rubric criterion, in the same order, and copy every non-blank value exactly (titles, text, links, weights, level labels). Write content only for blank values.
2. If there are no teacher tasks, design 2-4 tasks for the whole course (at least one "formative" and one "summative") with clear task briefs (what to submit, length or duration, conditions) that together cover the course learning outcomes.
3. nominalWeight is the percentage of the COURSE grade; all tasks together add up to 100. dueDate is "YYYY-MM-DD" after the course start date, or "" when no start date is set.
4. unitCode: the unit a task mainly assesses (copy its unitCode exactly), or "" when it covers the whole course.
5. Every task needs a rubric. Keep the teacher's criteria and level labels and fill only blank descriptors. For a new rubric write 3-5 criteria aligned to the task with weights adding up to 100, and ${labelRule}. Each descriptor describes observable performance at that level.
6. Never invent URLs: only use links that already appear in the teacher's tasks or the spreadsheet content.

Return only a JSON object: {"assessments":[{"title","unitCode","type","description","dueDate","nominalWeight","externalSubmissionLinks":[],"rubric":[{"criterionTitle","weightPercentage","levels":[{"label","descriptor"}]}]}]}`;
}

// ---------- orchestration ----------

function firstTeacherLevelLabels(assessments) {
  for (const a of assessments || []) {
    const labels = (a.rubric?.[0]?.levels || []).map(l => l.label).filter(Boolean);
    if (labels.length >= 2) return labels;
  }
  return null;
}

function courseNeedsOutline(course, units) {
  if (!units.length) return true;
  return ['title', 'description', 'category', 'aqfEquivalenceNotes'].some(k => isBlank(course[k])) || isBlank(course.learningOutcomes);
}

function emptyUnitDraft(init) {
  return { unitCode: '', unitTitle: '', nominalHours: null, description: '', learningOutcomes: [], content: '', blocks: [], ...init };
}

function friendlyError(err) {
  if (!err) return 'unknown error';
  if (err.code === GEMINI_ERROR.UNAVAILABLE) return 'Gemini did not respond';
  if (err.code === GEMINI_ERROR.BLOCKED) return 'Gemini declined this content';
  return String(err.message || err).slice(0, 160);
}

function isFatal(err) {
  return [GEMINI_ERROR.NO_KEY, GEMINI_ERROR.AUTH, GEMINI_ERROR.ABORTED].includes(err?.code) ||
    ['INSUFFICIENT_TOKENS_FOR_AI', 'AI_ASSIST_CHARGE_FAILED'].includes(err?.code);
}

async function runPool(items, limit, worker, signal) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length && !signal?.aborted) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Builds the entire course from a parsed spreadsheet with Gemini.
 *
 * @param {object} args
 * @param {object} args.parsed       result of parseCourseSpreadsheet()
 * @param {object} args.baseCourse   the course being edited (identity and unset fields are kept)
 * @param {(p: {stage: string, done: number, total: number, message: string}) => void} [args.onProgress]
 * @returns {Promise<{ course, tokensCharged, charityPassApplied, superadminPass, model, unitsBuilt, unitsTotal, warnings, message }>}
 */
export async function buildCourseFromSpreadsheetWithAI({
  currentUser,
  userProfile,
  parsed,
  baseCourse = {},
  targetAqfLevel,
  curriculumStandards = [],
  skillTexts = {},
  costTokens,
  apiKey = DEFAULT_GEMINI_KEY,
  onProgress,
  signal,
  concurrency = 2,
  models,
  fetchImpl
}) {
  if (!currentUser?.uid) throw new Error('Please sign in to use ✨ AI Assist.');
  if (!hasSpreadsheetContent(parsed)) throw new Error('The spreadsheet has no course content to build from.');

  const metering = await checkAiAssistBalance({ currentUser, userProfile, costTokens });
  const report = (stage, done, total, message) => {
    try {
      onProgress?.({ stage, done, total, message });
    } catch (err) {
      console.warn('AI Assist progress callback failed:', err);
    }
  };

  const draft = JSON.parse(JSON.stringify(parsed.draft));
  if (!Array.isArray(draft.assessments)) draft.assessments = [];
  const aqfLevel = Number.isInteger(draft.course.aqfLevel)
    ? draft.course.aqfLevel
    : (Number.isInteger(Number(targetAqfLevel)) ? Number(targetAqfLevel) : (Number.isInteger(Number(baseCourse.aqfLevel)) ? Number(baseCourse.aqfLevel) : 0));
  const standards = Array.isArray(draft.course.curriculumStandards)
    ? draft.course.curriculumStandards
    : sanitizeStandardIds(curriculumStandards?.length ? curriculumStandards : baseCourse.curriculumStandards);
  const guidance = buildStandardsGuidance(standards, aqfLevel, skillTexts);
  const standardsActive = !guidance.startsWith('Curriculum Standards: none apply');
  const isUrlAllowed = createUrlPolicy(parsed.sourceUrls);
  const levelLabels = firstTeacherLevelLabels(draft.assessments);

  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });

  let tokensCharged = 0;
  let chargePromise = null;
  const ensureCharged = () => {
    if (!chargePromise) {
      chargePromise = chargeAiAssistFee({ currentUser, cost: metering.cost, type: 'ai_assist_spreadsheet' })
        .then(charged => {
          tokensCharged = charged;
          return charged;
        });
    }
    return chargePromise;
  };

  let successes = 0;
  let model = '';
  const callGemini = async (prompt, schema, label, maxOutputTokens) => {
    const res = await generateGeminiJson({
      prompt,
      apiKey,
      responseJsonSchema: schema,
      maxOutputTokens,
      attemptTimeoutMs: 120000,
      deadlineMs: 210000,
      signal: controller.signal,
      label,
      ...(models ? { models } : {}),
      ...(fetchImpl ? { fetchImpl } : {})
    });
    await ensureCharged(); // charged once, after the first usable Gemini response
    successes++;
    model = res.model;
    return res.data;
  };

  const warnings = [];
  try {
    // 1. Outline: course details and, when the spreadsheet has no units, the unit list.
    let outlineError = null;
    if (courseNeedsOutline(draft.course, draft.units)) {
      report('outline', 0, 1, 'Planning the course outline…');
      try {
        const data = await callGemini(
          buildOutlinePrompt({ course: draft.course, units: draft.units, unstructuredText: parsed.unstructuredText, aqfLevel, guidance }),
          OUTLINE_RESPONSE_SCHEMA,
          'course outline',
          16384
        );
        const outlineCourse = sanitizeAiCourseFields(data, { isUrlAllowed });
        draft.course = mergeCourseFields(draft.course, outlineCourse);
        if (!draft.units.length) {
          const outlineUnits = (Array.isArray(data.units) ? data.units : []).slice(0, 20)
            .map(u => sanitizeAiUnit({ ...u, content: '', blocks: [], lessons: [] }, { isUrlAllowed }))
            .filter(u => u && (u.unitTitle || u.unitCode))
            .map(u => emptyUnitDraft({ unitCode: u.unitCode, unitTitle: u.unitTitle, nominalHours: u.nominalHours, description: u.description, learningOutcomes: u.learningOutcomes }));
          draft.units = outlineUnits;
        }
      } catch (err) {
        if (isFatal(err)) throw err;
        outlineError = err;
        warnings.push(`Course outline: ${friendlyError(err)}.`);
      }
      if (!draft.units.length) {
        const err = outlineError && successes === 0
          ? new Error(`Gemini could not build the course right now (${friendlyError(outlineError)}). No tokens were charged — try again, or import the spreadsheet without AI.`)
          : new Error('Gemini could not plan the course units from this spreadsheet. No tokens were charged — try again, or add a Units tab.');
        err.code = outlineError && successes === 0 ? 'AI_ASSIST_UNAVAILABLE' : 'AI_ASSIST_NO_UNITS';
        throw err;
      }
    }

    // 2. Each unit, in parallel (bounded).
    const total = draft.units.length;
    let done = 0;
    let fatal = null;
    report('units', 0, total, `Building unit 1 of ${total}…`);
    const results = await runPool(draft.units, concurrency, async (unit, index) => {
      try {
        const data = await callGemini(
          buildUnitPrompt({
            course: draft.course,
            unit,
            index,
            units: draft.units,
            unstructuredText: parsed.unstructuredText,
            aqfLevel,
            guidance
          }),
          UNIT_RESPONSE_SCHEMA,
          `unit ${index + 1}`,
          32768
        );
        return { ok: true, unit: mergeUnit(unit, sanitizeAiUnit(data, { isUrlAllowed })) };
      } catch (err) {
        if (isFatal(err)) {
          fatal = fatal || err;
          controller.abort();
        }
        return { ok: false, error: err };
      } finally {
        done++;
        report('units', done, total, done < total ? `Built ${done} of ${total} units…` : 'Finishing…');
      }
    }, controller.signal);
    if (fatal) throw fatal;

    if (successes === 0) {
      const first = results.find(r => r && !r.ok)?.error;
      const err = new Error(`Gemini could not build the course right now (${friendlyError(first)}). No tokens were charged — try again, or import the spreadsheet without AI.`);
      err.code = 'AI_ASSIST_UNAVAILABLE';
      throw err;
    }

    let unitsBuilt = 0;
    draft.units = draft.units.map((unit, i) => {
      const result = results[i];
      if (result?.ok) {
        unitsBuilt++;
        return result.unit;
      }
      warnings.push(`Unit ${unit.unitCode || unit.unitTitle || i + 1}: ${friendlyError(result?.error)} — your spreadsheet content was kept.`);
      return unit;
    });

    // 3. The course's one Assessments & Rubrics list.
    report('assessments', total, total, 'Planning the course assessments…');
    try {
      const data = await callGemini(
        buildAssessmentsPrompt({
          course: draft.course,
          units: draft.units,
          assessments: draft.assessments,
          unstructuredText: parsed.unstructuredText,
          aqfLevel,
          guidance,
          levelLabels,
          standardsActive
        }),
        ASSESSMENTS_RESPONSE_SCHEMA,
        'course assessments',
        32768
      );
      const unitIndexByCode = new Map(draft.units.map((u, i) => [normalizeKey(u.unitCode), i]).filter(([key]) => key));
      const aiTasks = sanitizeAiAssessments(data?.assessments, { isUrlAllowed })
        .map(({ unitCode, ...task }) => ({ ...task, unitIndex: unitIndexByCode.get(normalizeKey(unitCode)) ?? -1 }));
      draft.assessments = mergeCourseAssessments(draft.assessments, aiTasks);
    } catch (err) {
      if (isFatal(err)) throw err;
      warnings.push(`Course assessments: ${friendlyError(err)} — your spreadsheet tasks were kept.`);
    }

    report('finalizing', total, total, 'Finishing…');
    draft.course.aqfLevel = aqfLevel;
    draft.course.curriculumStandards = standards;
    const course = finalizeCourseDraft(draft, baseCourse);
    course.tags = Array.from(new Set([...(course.tags || []), 'AI-Assisted']));

    const passNote = metering.isSuperadmin
      ? '0 tokens — Super Admin (UNL)'
      : metering.isCharity ? '0 tokens — Charity Pass applied' : `Charged ${tokensCharged} tokens`;
    return {
      course,
      tokensCharged,
      charityPassApplied: metering.isCharity,
      superadminPass: metering.isSuperadmin,
      model,
      unitsBuilt,
      unitsTotal: total,
      warnings,
      message: `✨ Gemini built out ${unitsBuilt} of ${total} unit${total === 1 ? '' : 's'} from your spreadsheet (${passNote}).`
    };
  } finally {
    signal?.removeEventListener('abort', forwardAbort);
  }
}
