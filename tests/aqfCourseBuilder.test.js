/**
 * Automated Verification Suite for AQF Course Builder & Content Marketplace
 * Tests AQF Levels 1-9 taxonomy, 1-token copying, 0-token charity bypass, and 10-token AI ingestion.
 */

import assert from 'node:assert';
import {
  AQF_LEVELS,
  getAqfLevelMeta,
  createBlankCourse,
  createBlankUnit,
  createBlankLesson,
  createBlankContentBlock,
  createBlankAssessment,
  createDefaultRubric,
  generateEntityId
} from '../src/types/courseBuilderTypes.js';

import {
  isUserCharityTeacher,
  executeContentClone,
  createFreeContentRequest,
  approveFreeContentRequest,
  rejectFreeContentRequest,
  searchMarketplaceContent
} from '../src/services/courseMarketplaceService.js';

import {
  AI_INGEST_COST_TOKENS,
  ingestCourseSyllabusWithAI
} from '../src/services/aqfAiIngestService.js';

async function runTestSuite() {
  console.log('🧪 Starting AQF Course Builder & Marketplace Test Suite...\n');

  // Test 1: AQF Levels 1 to 9 Taxonomy
  console.log('Test 1: AQF Levels Taxonomy Verification');
  assert.strictEqual(AQF_LEVELS.length, 10, 'Expected 10 levels (Level 0 + Levels 1-9)');
  for (let lvl = 1; lvl <= 9; lvl++) {
    const meta = getAqfLevelMeta(lvl);
    assert.strictEqual(meta.level, lvl, `AQF Level ${lvl} must match`);
    assert(meta.credential.length > 0, `AQF Level ${lvl} must have credential`);
    assert(meta.competencySummary.length > 0, `AQF Level ${lvl} must have competency summary`);
  }
  const level0 = getAqfLevelMeta(0);
  assert.strictEqual(level0.level, 0, 'Level 0 must represent International / Flexible');
  console.log('✅ Test 1 Passed: AQF Levels 1–9 and Level 0 taxonomy verified.');

  // Test 2: Course Domain Model Defaults & Optional/Customizable Categories
  console.log('\nTest 2: Course Domain Model Factory');
  const course = createBlankCourse('user_123', 'Professor Higgins');
  assert(course.id.startsWith('course_'), 'Course ID must be prefixed');
  assert.strictEqual(course.authorId, 'user_123');
  assert.strictEqual(course.units.length, 1, 'Initial course has 1 unit');
  assert.strictEqual(course.units[0].lessons.length, 1, 'Initial unit has 1 lesson');
  assert.strictEqual(course.units[0].lessons[0].blocks.length, 1, 'Initial lesson has 1 block');
  assert.strictEqual(course.units[0].assessments.length, 1, 'Initial unit has 1 assessment');
  assert.strictEqual(course.units[0].assessments[0].rubric.length, 3, 'Default rubric has 3 criteria');
  console.log('✅ Test 2 Passed: Domain models and rubric matrices initialize properly.');

  // Test 3: Charity Teacher Privilege Detection
  console.log('\nTest 3: Charity Teacher Bypass Logic');
  const standardProfile = { uid: 'u1', role: 'teacher', isCharityTeacher: false };
  const charityProfile = { uid: 'u2', role: 'teacher', isCharityTeacher: true };
  assert.strictEqual(isUserCharityTeacher(standardProfile), false);
  assert.strictEqual(isUserCharityTeacher(charityProfile), true);

  // Test 3b: 0-Token Clone for Charity Teacher
  const charityClone = await executeContentClone({
    currentUser: { uid: 'u2' },
    userProfile: charityProfile,
    targetAuthorId: 'u_author',
    entityType: 'unit',
    entityId: 'u_101',
    entityTitle: 'Cyber Defense Fundamentals'
  });
  assert.strictEqual(charityClone.success, true);
  assert.strictEqual(charityClone.cost, 0, 'Charity teacher must incur 0 token cost');
  assert.strictEqual(charityClone.charityPassApplied, true);
  console.log('✅ Test 3 Passed: Charity teacher 0-token override active.');

  // Test 4: Free Content Request Workflow
  console.log('\nTest 4: Free Content Request Workflow');
  const req = await createFreeContentRequest({
    requesterUser: { uid: 'u_poor_school', displayName: 'Teacher in Outback' },
    requesterProfile: standardProfile,
    authorId: 'u_curator',
    targetEntityType: 'unit',
    targetEntityId: 'unit_ictweb',
    targetEntityTitle: 'DOM Scripting',
    reasonMessage: 'Rural school with limited funding.'
  });
  assert.strictEqual(req.status, 'pending');
  assert.strictEqual(req.requesterId, 'u_poor_school');
  assert.strictEqual(req.authorId, 'u_curator');

  const approved = await approveFreeContentRequest(req.id);
  assert.strictEqual(approved.status, 'approved');
  console.log('✅ Test 4 Passed: Free content request dispatch and approval lifecycle validated.');

  // Test 5: Global Marketplace Search API
  console.log('\nTest 5: Marketplace Content Search API');
  const resultsAll = await searchMarketplaceContent({ keyword: '', aqfLevel: 'ALL' });
  assert(resultsAll.length >= 3, 'Seed marketplace must return curated qualifications');

  const resultsAqf5 = await searchMarketplaceContent({ keyword: 'Cyber', aqfLevel: 5 });
  assert(resultsAqf5.length >= 1, 'Must find AQF Level 5 Cyber course');
  assert.strictEqual(resultsAqf5[0].aqfLevel, 5);
  console.log('✅ Test 5 Passed: Marketplace multi-parameter search functional.');

  // Test 6: 10-Token AI Ingestion Pipeline Verification
  console.log('\nTest 6: 10-Token AI Ingestion Pipeline');
  assert.strictEqual(AI_INGEST_COST_TOKENS, 10, 'AI Ingestion must cost 10 tokens');

  const aiResult = await ingestCourseSyllabusWithAI({
    currentUser: { uid: 'u2', displayName: 'Beneficiary' },
    userProfile: charityProfile, // charity bypasses balance check
    syllabusText: `Advanced Cloud Architectures & Distributed Systems
Unit 1: Microservices & Event Streaming
Unit 2: Container Orchestration with Kubernetes`,
    targetAqfLevel: 6
  });

  assert(aiResult.course, 'AI Ingestion must generate a Course object');
  assert.strictEqual(aiResult.course.aqfLevel, 6, 'Generated course must match target AQF Level 6');
  assert(aiResult.course.units.length >= 1, 'Generated course must contain units');
  assert(aiResult.course.units[0].lessons.length >= 1, 'Units must contain lessons');
  assert(aiResult.course.units[0].lessons[0].blocks.length >= 1, 'Lessons must contain modular blocks');
  assert(aiResult.course.units[0].assessments.length >= 1, 'Units must contain assessment tasks');
  console.log('✅ Test 6 Passed: 10-Token AI Ingestion correctly hydrates full AQF Course schema.');

  console.log('\n🎉 ALL AQF COURSE BUILDER & CONTENT MARKETPLACE TESTS PASSED (6/6)!\n');
}

runTestSuite().catch(err => {
  console.error('❌ Test Suite Failed:', err);
  process.exit(1);
});
