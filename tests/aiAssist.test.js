/**
 * Verification Suite for ✨ AI Assist: flat Super Admin fee & Curriculum Standards routing
 * Run: node tests/aiAssist.test.js
 */

import assert from 'node:assert';
import {
  DEFAULT_AI_ASSIST_COST_TOKENS,
  MAX_AI_ASSIST_COST_TOKENS,
  normalizeAiAssistCost,
  hasSufficientTokens,
  computeBalanceAfterDeduction
} from '../src/services/aiAssistTokenService.js';
import {
  CURRICULUM_STANDARDS,
  sanitizeStandardIds,
  resolveActiveStandards
} from '../src/services/curriculumStandards.js';
import { ingestCourseSyllabusWithAI, AI_INGEST_COST_TOKENS } from '../src/services/aqfAiIngestService.js';
import { normalizeCourse } from '../src/services/lmsRepository.js';

const SYLLABUS = `Strategic Technology Governance
Unit 1: AI Ethics & Digital Agility
Unit 2: ESG Reporting`;

/** Replaces fetch with a stub that records the prompt and forces the deterministic fallback. */
function captureAiPrompt() {
  const captured = { prompts: [] };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init?.body || '{}');
    captured.prompts.push(body.contents?.[0]?.parts?.[0]?.text || '');
    return { ok: false, status: 503, json: async () => ({}) };
  };
  captured.restore = () => { globalThis.fetch = realFetch; };
  return captured;
}

async function run() {
  console.log('🧪 ✨ AI Assist Test Suite\n');

  // 1. Flat whole-token fee math
  assert.strictEqual(DEFAULT_AI_ASSIST_COST_TOKENS, 10);
  assert.strictEqual(MAX_AI_ASSIST_COST_TOKENS, 10);
  assert.strictEqual(AI_INGEST_COST_TOKENS, 10);
  assert.strictEqual(computeBalanceAfterDeduction(25, 10), 15);
  assert.strictEqual(computeBalanceAfterDeduction(10, 10), 0);
  assert.strictEqual(hasSufficientTokens(9, 10), false);
  assert.throws(() => computeBalanceAfterDeduction(9, 10), err => err.code === 'INSUFFICIENT_TOKENS');
  console.log('✅ Test 1 Passed: Flat-fee deduction throws INSUFFICIENT_TOKENS below the fee.');

  // 2. Super Admin fee validation: whole numbers 0-10 only
  assert.strictEqual(normalizeAiAssistCost(undefined), 10);
  assert.strictEqual(normalizeAiAssistCost('abc'), 10);
  assert.strictEqual(normalizeAiAssistCost(-1), 10);
  assert.strictEqual(normalizeAiAssistCost(0.5), 10, 'Decimals are rejected');
  assert.strictEqual(normalizeAiAssistCost(11), 10);
  assert.strictEqual(normalizeAiAssistCost(0), 0);
  assert.strictEqual(normalizeAiAssistCost('7'), 7);
  console.log('✅ Test 2 Passed: Super Admin fee accepts whole numbers 0–10 only.');

  // 3. Standards sanitization & AQF-level routing
  assert.strictEqual(CURRICULUM_STANDARDS.length, 5);
  assert.deepStrictEqual(sanitizeStandardIds(['teqsa', 'bogus', 'aacsb', 'teqsa', 42]), ['aacsb', 'teqsa']);
  assert.deepStrictEqual(resolveActiveStandards(['aacsb', 'teqsa'], 8).active.map(s => s.id), ['aacsb', 'teqsa']);
  assert.strictEqual(resolveActiveStandards(['aacsb'], 4).useBloomsFallback, true, 'AACSB must not apply at AQF 4');
  assert.deepStrictEqual(resolveActiveStandards(['uk_qaa'], 7).active.map(s => s.id), ['uk_qaa']);
  console.log("✅ Test 3 Passed: AACSB/TEQSA gated to AQF 7–9; otherwise Bloom's fallback.");

  // 4. Standards persist through the course save normalizer
  assert.deepStrictEqual(normalizeCourse({ title: 'X', curriculumStandards: ['acara', 'nope'] }).curriculumStandards, ['acara']);
  assert.deepStrictEqual(normalizeCourse({ title: 'X' }).curriculumStandards, []);
  console.log('✅ Test 4 Passed: curriculumStandards survive save normalization (unknown ids dropped).');

  // 5. AI Assist prompt injects only the applicable skill files
  const skillTexts = { aacsb: 'AACSB-RULES-MARKER', teqsa: 'TEQSA-RULES-MARKER', acara: 'ACARA-RULES-MARKER' };
  const charityProfile = { isCharityTeacher: true };
  const cap = captureAiPrompt();
  try {
    const res = await ingestCourseSyllabusWithAI({
      currentUser: { uid: 'u_test' },
      userProfile: charityProfile,
      syllabusText: SYLLABUS,
      targetAqfLevel: 9,
      curriculumStandards: ['aacsb', 'acara'],
      skillTexts,
      apiKey: 'test-key'
    });
    assert.strictEqual(res.tokensCharged, 0, 'Charity Teachers pay 0');
    assert(res.course.units.length > 0, 'Fallback course is produced when the AI is unavailable');

    await ingestCourseSyllabusWithAI({
      currentUser: { uid: 'u_test' },
      userProfile: charityProfile,
      syllabusText: SYLLABUS,
      targetAqfLevel: 4,
      curriculumStandards: ['aacsb'],
      skillTexts,
      apiKey: 'test-key'
    });
  } finally {
    cap.restore();
  }
  // Each AI Assist call may try several Gemini models with the same prompt; keep one per call.
  const [pg, vocational] = [...new Set(cap.prompts)];
  assert(pg.includes('AACSB-RULES-MARKER') && pg.includes('ACARA-RULES-MARKER'));
  assert(!pg.includes('TEQSA-RULES-MARKER'), 'Unselected standards are not injected');
  assert(pg.includes('Ignore their consultation-workflow'));
  assert(!vocational.includes('AACSB-RULES-MARKER'), 'AACSB is skipped at AQF 4');
  assert(vocational.includes("Bloom's Taxonomy"));
  console.log('✅ Test 5 Passed: AI Assist follows the selected Curriculum Standards skill files.');

  // 6. A 0 fee is free for non-charity teachers (no balance lookup needed)
  const cap2 = captureAiPrompt();
  try {
    const free = await ingestCourseSyllabusWithAI({
      currentUser: { uid: 'u_std' },
      userProfile: { role: 'teacher' },
      syllabusText: SYLLABUS,
      costTokens: 0,
      apiKey: 'test-key'
    });
    assert.strictEqual(free.tokensCharged, 0);
  } finally {
    cap2.restore();
  }
  console.log('✅ Test 6 Passed: Super Admin fee of 0 makes AI Assist free.');

  console.log('\n🎉 All ✨ AI Assist tests passed.');
}

run().then(() => process.exit(0)).catch(err => {
  console.error('❌ Test failure:', err);
  process.exit(1);
});
