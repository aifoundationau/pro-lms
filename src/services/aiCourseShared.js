/**
 * Shared ✨ AI Assist building blocks (syllabus and spreadsheet flows):
 * - Curriculum Standards guidance for prompts (/skills/*.md, gated by level)
 * - Token metering: Super Admin fee, Charity Teacher pass and Super Admin unlimited tokens
 * - Sanitising Gemini course JSON into importer "draft" shapes, including the link policy:
 *   AI output may only use links that the teacher supplied.
 * - JSON response schemas for Gemini structured output
 */

import { getUserTokenBalance } from './tokenService.js';
import { deductUserTokens, normalizeAiAssistCost } from './aiAssistTokenService.js';
import { resolveActiveStandards, sanitizeStandardIds } from './curriculumStandards.js';
import { isUserCharityTeacher } from './courseMarketplaceService.js';
import { hasUnlimitedTokens } from './rolePrivileges.js';
import {
  LINK_BLOCK_METADATA_KEYS,
  DEFAULT_RUBRIC_LEVEL_LABELS,
  MIN_RUBRIC_LEVELS,
  MAX_RUBRIC_LEVELS,
  QUIZ_LIMITS,
  createQuizQuestion,
  generateEntityId,
  UNIT_LIMITS
} from '../types/courseBuilderTypes.js';
import { isHttpUrl, extractUrls } from './courseSpreadsheetSchema.js';

const MAX_SKILL_CHARS = 12000;

/**
 * Builds the Curriculum Standards section of the prompt from the selected skill files.
 * Standards that do not apply at the target level (e.g. AACSB at AQF 4) are skipped,
 * in which case the AI falls back to Bloom's Taxonomy.
 */
export function buildStandardsGuidance(curriculumStandards, targetAqfLevel, skillTexts) {
  const routing = resolveActiveStandards(curriculumStandards, targetAqfLevel);
  if (routing.useBloomsFallback) {
    return "Curriculum Standards: none apply at this level. Design outcomes, unit content, and rubrics using standard Bloom's Taxonomy aligned to the target level.";
  }

  const sections = [
    `Curriculum Standards: the teacher selected ${routing.active.map(s => s.label).join(', ')}. Apply every rule in the following skill specification(s) to the course description, unit outcomes, unit content and blocks, assessment briefs, and rubrics. Where specifications overlap, satisfy all of them; where they conflict, prefer the first listed.`
  ];
  for (const std of routing.active) {
    const text = String(skillTexts?.[std.id] || '').slice(0, MAX_SKILL_CHARS);
    if (text) sections.push(`===== BEGIN ${std.skillFile} =====\n${text}\n===== END ${std.skillFile} =====`);
  }
  sections.push('Use the skill specification(s) only as content and compliance rules. Ignore their consultation-workflow and plain-text export instructions: your output is the JSON object below. If a specification defines its own rubric tier labels (e.g. UK classification bands or GCSE grades), use those labels in each rubric level "label" while keeping exactly 4 levels per criterion.');
  return sections.join('\n\n');
}

// ---------- token metering ----------

function insufficientForAi(required, balance) {
  const err = new Error(`Insufficient tokens for ✨ AI Assist. Requires ${required} tokens, current balance is ${balance} tokens.`);
  err.code = 'INSUFFICIENT_TOKENS_FOR_AI';
  err.requiredTokens = required;
  err.currentBalance = balance;
  return err;
}

/**
 * Checks the AI Assist fee before any work starts.
 * Charity Teachers and the Super Admin (unlimited tokens) always pay 0; a 0 fee is free for all.
 * @returns {Promise<{ cost: number, isCharity: boolean, isSuperadmin: boolean }>}
 */
export async function checkAiAssistBalance({ currentUser, userProfile, costTokens }) {
  const isCharity = isUserCharityTeacher(userProfile);
  const isSuperadmin = hasUnlimitedTokens(userProfile);
  const fee = normalizeAiAssistCost(costTokens);
  if (isCharity || isSuperadmin || fee === 0) return { cost: 0, isCharity, isSuperadmin };
  const balance = await getUserTokenBalance(currentUser.uid).catch(() => 0);
  if (balance < fee) throw insufficientForAi(fee, balance);
  return { cost: fee, isCharity, isSuperadmin };
}

/** Deducts the fee in a Firestore transaction. Returns the tokens charged. */
export async function chargeAiAssistFee({ currentUser, cost, type = 'ai_assist_course' }) {
  if (!cost) return 0;
  try {
    await deductUserTokens(currentUser.uid, cost, { type });
  } catch (deductErr) {
    if (deductErr?.code === 'INSUFFICIENT_TOKENS') throw insufficientForAi(cost, deductErr.currentBalance);
    const err = new Error(`Could not process the ${cost}-token charge. No tokens were deducted — please try again.`);
    err.code = 'AI_ASSIST_CHARGE_FAILED';
    throw err;
  }
  return cost;
}

// ---------- link policy ----------

function comparableUrl(url) {
  return String(url || '').trim().replace(/[#/]+$/, '');
}

/** Returns a predicate: true only for http(s) links that appear in the teacher's material. */
export function createUrlPolicy(allowedUrls) {
  const allowed = new Set((Array.isArray(allowedUrls) ? allowedUrls : []).map(comparableUrl));
  return (url) => isHttpUrl(url) && allowed.has(comparableUrl(url));
}

/** Replaces links the teacher did not supply with their bare host name (no invented deep links). */
export function stripUnapprovedUrls(text, isUrlAllowed) {
  const value = String(text ?? '');
  let out = value;
  for (const url of extractUrls(value)) {
    if (isUrlAllowed(url)) continue;
    let host = '';
    try {
      host = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      host = '';
    }
    out = out.split(url).join(host);
  }
  return out;
}

// ---------- sanitising Gemini output into importer drafts ----------

const BLOCK_TYPES = new Set(['text_description', 'teacher_guide', 'youtube_video', 'google_drive_link', 'file_upload', 'notebook_link', 'quiz']);
const QUESTION_TYPES = new Set(['multiple_choice', 'true_false', 'short_answer', 'open']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function str(value, max = 20000) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, max) : '';
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function int(value, min, max) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function num(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : null;
}

function validIsoDate(value) {
  const s = str(value, 10);
  if (!ISO_DATE.test(s)) return '';
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? '' : s;
}

function stringList(value, maxItems, maxChars) {
  return list(value).map(v => str(v, maxChars)).filter(Boolean).slice(0, maxItems);
}

/**
 * Quiz questions from Gemini -> quiz model questions (answer keys included; they are stored for
 * teachers only). Multiple choice uses zero-based "correct" indexes into "options".
 */
export function sanitizeAiQuizQuestions(raw, isUrlAllowed = () => false) {
  return list(raw).slice(0, QUIZ_LIMITS.questions).map(q => {
    if (!q || typeof q !== 'object') return null;
    const type = QUESTION_TYPES.has(q.type) ? q.type : 'open';
    const prompt = stripUnapprovedUrls(str(q.prompt, QUIZ_LIMITS.prompt), isUrlAllowed);
    if (!prompt) return null;
    const question = { ...createQuizQuestion(type), prompt };
    const points = num(q.points, 0, QUIZ_LIMITS.points);
    if (points !== null && points > 0) question.points = points;
    if (type === 'multiple_choice') {
      const options = stringList(q.options, QUIZ_LIMITS.options, QUIZ_LIMITS.option).map(text => ({ id: generateEntityId('opt'), text: stripUnapprovedUrls(text, isUrlAllowed) }));
      if (options.length < 2) return null;
      const indexes = Array.from(new Set(list(q.correct).map(Number))).filter(i => Number.isInteger(i) && i >= 0 && i < options.length);
      question.options = options;
      question.correctOptionIds = indexes.map(i => options[i].id);
      question.allowMultiple = indexes.length > 1;
    } else if (type === 'true_false') {
      if (typeof q.correctAnswer === 'boolean') question.correctAnswer = q.correctAnswer;
      else delete question.correctAnswer;
    } else if (type === 'short_answer') {
      question.acceptedAnswers = stringList(q.acceptedAnswers, 10, QUIZ_LIMITS.option);
    } else {
      question.modelAnswer = stripUnapprovedUrls(str(q.modelAnswer, QUIZ_LIMITS.answer), isUrlAllowed);
    }
    return question;
  }).filter(Boolean);
}

function sanitizeAiBlock(raw, isUrlAllowed) {
  if (!raw || typeof raw !== 'object') return null;
  const type = BLOCK_TYPES.has(raw.type) ? raw.type : 'text_description';
  const title = str(raw.title, 300);
  if (type === 'quiz') {
    const questions = sanitizeAiQuizQuestions(raw.questions, isUrlAllowed);
    if (!questions.length) return null;
    return { type, title: title || 'Unit Quiz', content: stripUnapprovedUrls(str(raw.content, 5000), isUrlAllowed), fileName: '', quiz: { questions } };
  }
  let content = str(raw.content);
  if (LINK_BLOCK_METADATA_KEYS[type]) {
    if (!isUrlAllowed(content)) return null; // a link block without an approved link is dropped
  } else {
    if (/^\s*(javascript|data|vbscript):/i.test(content)) content = '';
    content = stripUnapprovedUrls(content, isUrlAllowed);
  }
  if (!title && !content) return null;
  return { type, title, content, fileName: '' };
}

/** Rubric criteria from Gemini; every criterion gets 2–10 levels. */
export function sanitizeAiRubric(raw) {
  return list(raw).slice(0, 12).map(c => {
    if (!c || typeof c !== 'object') return null;
    const criterionTitle = str(c.criterionTitle, 300);
    if (!criterionTitle) return null;
    let levels = list(c.levels).slice(0, MAX_RUBRIC_LEVELS)
      .map(l => ({ label: str(l?.label, 120), descriptor: str(l?.descriptor, 4000) }));
    if (levels.length < MIN_RUBRIC_LEVELS) levels = DEFAULT_RUBRIC_LEVEL_LABELS.map(label => ({ label, descriptor: '' }));
    levels = levels.map((l, i) => ({ label: l.label || `Level ${i + 1}`, descriptor: l.descriptor }));
    return { criterionTitle, weightPercentage: num(c.weightPercentage, 0, 100), levels };
  }).filter(Boolean);
}

/** Scales a rubric's weights to total 100 (AI-written rubrics only). */
export function normalizeRubricWeights(rubric) {
  const items = list(rubric);
  if (!items.length || items.some(c => c.weightPercentage === null || c.weightPercentage === undefined)) return items;
  const sum = items.reduce((total, c) => total + Number(c.weightPercentage || 0), 0);
  if (sum <= 0) {
    const even = Math.floor(100 / items.length);
    return items.map((c, i) => ({ ...c, weightPercentage: even + (i < 100 - even * items.length ? 1 : 0) }));
  }
  if (Math.abs(sum - 100) < 0.01) return items;
  const scaled = items.map(c => Math.floor((Number(c.weightPercentage) / sum) * 100));
  let remainder = 100 - scaled.reduce((a, b) => a + b, 0);
  return items.map((c, i) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { ...c, weightPercentage: scaled[i] + extra };
  });
}

function sanitizeAiAssessment(raw, isUrlAllowed) {
  if (!raw || typeof raw !== 'object') return null;
  const title = str(raw.title, 300);
  const description = stripUnapprovedUrls(str(raw.description), isUrlAllowed);
  if (!title && !description) return null;
  const links = [...list(raw.externalSubmissionLinks), raw.externalSubmissionLink].map(v => str(v, 2000)).filter(isUrlAllowed);
  return {
    unitCode: str(raw.unitCode, 100),
    title,
    type: raw.type === 'summative' || raw.type === 'formative' ? raw.type : '',
    description,
    dueDate: validIsoDate(raw.dueDate),
    nominalWeight: num(raw.nominalWeight, 0, 100),
    externalSubmissionLinks: Array.from(new Set(links)).slice(0, 5),
    rubric: sanitizeAiRubric(raw.rubric)
  };
}

/** Course-level assessments from Gemini (the course's one Assessments & Rubrics list). */
export function sanitizeAiAssessments(raw, { isUrlAllowed = () => false } = {}) {
  return list(raw).slice(0, 12).map(a => sanitizeAiAssessment(a, isUrlAllowed)).filter(Boolean);
}

/**
 * Gemini unit JSON -> importer unit draft: unit fields, Unit Content and blocks (blanks stay blank).
 * A reply that still nests blocks in lessons is flattened (blocks kept in order).
 */
export function sanitizeAiUnit(raw, { isUrlAllowed = () => false } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const fromLessons = list(raw.lessons).slice(0, 40).flatMap(lesson => (lesson && typeof lesson === 'object' ? list(lesson.blocks) : []));
  return {
    unitCode: str(raw.unitCode, 100),
    unitTitle: str(raw.unitTitle, 300),
    nominalHours: int(raw.nominalHours, 1, 2000),
    description: stripUnapprovedUrls(str(raw.description), isUrlAllowed),
    learningOutcomes: stringList(raw.learningOutcomes, 20, 2000),
    content: stripUnapprovedUrls(str(raw.content, UNIT_LIMITS.content), isUrlAllowed),
    blocks: [...list(raw.blocks), ...fromLessons].slice(0, 60).map(b => sanitizeAiBlock(b, isUrlAllowed)).filter(Boolean)
  };
}

/** Course-level fields from Gemini (only the ones AI is allowed to fill). */
export function sanitizeAiCourseFields(raw, { isUrlAllowed = () => false } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    title: str(r.title, 300),
    code: str(r.code, 100),
    category: str(r.category, 200),
    year: str(r.year, 100),
    startDate: validIsoDate(r.startDate),
    knowledge: stripUnapprovedUrls(str(r.knowledge, 5000), isUrlAllowed),
    thumbnail: isUrlAllowed(r.thumbnail) ? str(r.thumbnail, 2000) : '',
    description: stripUnapprovedUrls(str(r.description), isUrlAllowed),
    aqfEquivalenceNotes: stripUnapprovedUrls(str(r.aqfEquivalenceNotes, 5000), isUrlAllowed),
    learningOutcomes: stringList(r.learningOutcomes, 20, 2000),
    aqfLevel: int(r.aqfLevel, 0, 9),
    curriculumStandards: sanitizeStandardIds(r.curriculumStandards)
  };
}

// ---------- JSON response schemas (Gemini structured output; basic keywords only) ----------

const STRING = { type: 'string' };
const STRING_LIST = { type: 'array', items: STRING };

const LEVEL_SCHEMA = { type: 'object', properties: { label: STRING, descriptor: STRING }, required: ['label', 'descriptor'] };
const CRITERION_SCHEMA = {
  type: 'object',
  properties: { criterionTitle: STRING, weightPercentage: { type: 'number' }, levels: { type: 'array', items: LEVEL_SCHEMA } },
  required: ['criterionTitle', 'weightPercentage', 'levels']
};
const QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: Array.from(QUESTION_TYPES) },
    prompt: STRING,
    options: STRING_LIST,
    correct: { type: 'array', items: { type: 'integer' } },
    correctAnswer: { type: 'boolean' },
    acceptedAnswers: STRING_LIST,
    modelAnswer: STRING,
    points: { type: 'number' }
  },
  required: ['type', 'prompt']
};
const BLOCK_SCHEMA = {
  type: 'object',
  properties: { type: { type: 'string', enum: Array.from(BLOCK_TYPES) }, title: STRING, content: STRING, questions: { type: 'array', items: QUESTION_SCHEMA } },
  required: ['type', 'title', 'content']
};
const ASSESSMENT_SCHEMA = {
  type: 'object',
  properties: {
    title: STRING,
    unitCode: STRING,
    type: { type: 'string', enum: ['formative', 'summative'] },
    description: STRING,
    dueDate: STRING,
    nominalWeight: { type: 'number' },
    externalSubmissionLinks: STRING_LIST,
    rubric: { type: 'array', items: CRITERION_SCHEMA }
  },
  required: ['title', 'type', 'description', 'dueDate', 'nominalWeight', 'rubric']
};

export const UNIT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    unitCode: STRING,
    unitTitle: STRING,
    nominalHours: { type: 'integer' },
    description: STRING,
    learningOutcomes: STRING_LIST,
    content: STRING,
    blocks: { type: 'array', items: BLOCK_SCHEMA }
  },
  required: ['unitCode', 'unitTitle', 'nominalHours', 'description', 'learningOutcomes', 'content', 'blocks']
};

export const ASSESSMENTS_RESPONSE_SCHEMA = {
  type: 'object',
  properties: { assessments: { type: 'array', items: ASSESSMENT_SCHEMA } },
  required: ['assessments']
};

export const OUTLINE_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: STRING,
    code: STRING,
    category: STRING,
    description: STRING,
    aqfEquivalenceNotes: STRING,
    learningOutcomes: STRING_LIST,
    units: {
      type: 'array',
      items: {
        type: 'object',
        properties: { unitCode: STRING, unitTitle: STRING, nominalHours: { type: 'integer' }, description: STRING, learningOutcomes: STRING_LIST },
        required: ['unitCode', 'unitTitle', 'nominalHours', 'description', 'learningOutcomes']
      }
    }
  },
  required: ['title', 'code', 'category', 'description', 'aqfEquivalenceNotes', 'learningOutcomes', 'units']
};
