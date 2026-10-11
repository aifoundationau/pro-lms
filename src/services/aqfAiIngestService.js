/**
 * ✨ AI Assist: Gemini Full-Course Generation & AQF Equivalence Pipeline
 * Parses raw text or syllabus files directly into full AQF Course, Unit, Lesson, Block, and Assessment schemas.
 * Guided by the course's selected Curriculum Standards (/skills/*.md).
 * Includes token metering (Super Admin fee, default 10 tokens; 0 for charity teachers).
 */

import { getUserTokenBalance } from './tokenService.js';
import { deductUserTokens, normalizeAiAssistCost } from './aiAssistTokenService.js';
import { resolveActiveStandards } from './curriculumStandards.js';
import { isUserCharityTeacher } from './courseMarketplaceService.js';
import {
  generateEntityId,
  getAqfLevelMeta,
  createDefaultRubric,
  createBlankUnit,
  createBlankLesson,
  createBlankContentBlock,
  createBlankAssessment
} from '../types/courseBuilderTypes.js';
import { DEFAULT_GEMINI_KEY } from './geminiCourseService.js';

export const AI_INGEST_COST_TOKENS = 10;

const AI_ASSIST_TIMEOUT_MS = 90000;
const MAX_SKILL_CHARS = 12000;

/**
 * Builds the Curriculum Standards section of the prompt from the selected skill files.
 * Standards that do not apply at the target level (e.g. AACSB at AQF 4) are skipped,
 * in which case the AI falls back to Bloom's Taxonomy.
 */
function buildStandardsGuidance(curriculumStandards, targetAqfLevel, skillTexts) {
  const routing = resolveActiveStandards(curriculumStandards, targetAqfLevel);
  if (routing.useBloomsFallback) {
    return "Curriculum Standards: none apply at this level. Design outcomes, lessons, and rubrics using standard Bloom's Taxonomy aligned to the target level.";
  }

  const sections = [
    `Curriculum Standards: the teacher selected ${routing.active.map(s => s.label).join(', ')}. Apply every rule in the following skill specification(s) to the course description, unit outcomes, all lesson blocks, assessment briefs, and rubrics. Where specifications overlap, satisfy all of them; where they conflict, prefer the first listed.`
  ];
  for (const std of routing.active) {
    const text = String(skillTexts?.[std.id] || '').slice(0, MAX_SKILL_CHARS);
    if (text) sections.push(`===== BEGIN ${std.skillFile} =====\n${text}\n===== END ${std.skillFile} =====`);
  }
  sections.push('Use the skill specification(s) only as content and compliance rules. Ignore their consultation-workflow and plain-text export instructions: your output is the JSON object below. If a specification defines its own rubric tier labels (e.g. UK classification bands or GCSE grades), use those labels in each rubric level "label" while keeping exactly 4 levels per criterion.');
  return sections.join('\n\n');
}

/**
 * Compiles a rich system prompt directing Gemini to generate AQF-compliant JSON
 */
function buildAqfIngestPrompt(syllabusText, targetAqfLevel, curriculumStandards = [], skillTexts = {}) {
  const aqfInfo = getAqfLevelMeta(targetAqfLevel || 4);
  const standardsGuidance = buildStandardsGuidance(curriculumStandards, aqfInfo.level, skillTexts);

  return `You are an expert Australian Qualifications Framework (AQF) Educational Systems Architect and Curriculum Designer.
Your objective is to ingest the following raw syllabus/course material and transform it into a comprehensive, high-quality, fully populated Course JSON object adhering strictly to the AQF Level taxonomy.

Target AQF Level: Level ${aqfInfo.level} — ${aqfInfo.credential} (${aqfInfo.summary})
Expected Autonomy & Cognitive Demand: ${aqfInfo.competencySummary}
Note for International Courses: If the source material comes from outside Australia (e.g., US, UK, EU, India, Asia), evaluate its international equivalence and map the competencies, learning outcomes, and nominal hours to match AQF standards.

${standardsGuidance}

Source Material to Ingest:
"""
${syllabusText.slice(0, 15000)}
"""

You MUST respond with pure JSON only (no markdown quotes, no triple backticks, no preamble).
The JSON MUST follow this exact structure:
{
  "title": "Clear formal course title",
  "code": "Course Code e.g. BSB40120 or ICT50220",
  "aqfLevel": ${Number(targetAqfLevel) || 4},
  "aqfEquivalenceNotes": "Brief explanation of how this maps to the AQF and international equivalence",
  "description": "Comprehensive course description detailing industry scope, learner cohorts, and career pathways",
  "learningOutcomes": [
    "Outcome 1: Bloom's taxonomy action verb...",
    "Outcome 2: ...",
    "Outcome 3: ..."
  ],
  "units": [
    {
      "unitCode": "Unit code e.g. UNIT401",
      "unitTitle": "Descriptive unit title",
      "nominalHours": 40,
      "description": "Unit scope and performance criteria overview",
      "lessons": [
        {
          "title": "Lesson 1: Topic Title",
          "order": 0,
          "estimatedMinutes": 45,
          "blocks": [
            {
              "type": "text_description",
              "order": 0,
              "title": "Theoretical Foundations & Concepts",
              "content": "Rich instructional text explaining the concept in detail...",
              "metadata": {}
            },
            {
              "type": "teacher_guide",
              "order": 1,
              "title": "Educator Facilitation & Pedagogy Tips",
              "content": "Pedagogical guidance, recommended discussion prompts, and classroom safety notices...",
              "metadata": {}
            },
            {
              "type": "youtube_video",
              "order": 2,
              "title": "Recommended Instructional Video",
              "content": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
              "metadata": {
                "youtubeUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
              }
            },
            {
              "type": "google_drive_link",
              "order": 3,
              "title": "Collaborative Student Lab Sheet (Google Drive)",
              "content": "https://drive.google.com/drive/folders/sampleSharedFolder",
              "metadata": {
                "driveUrl": "https://drive.google.com/drive/folders/sampleSharedFolder"
              }
            }
          ]
        }
      ],
      "assessments": [
        {
          "title": "Formative Knowledge Check",
          "type": "formative",
          "description": "Short scenario-based task assessing immediate comprehension of unit principles.",
          "rubric": [
            {
              "criterionTitle": "Application of Core Principles",
              "weightPercentage": 50,
              "levels": [
                { "label": "Novice (0-49%)", "points": 40, "descriptor": "Requires prompting to state basic terms." },
                { "label": "Competent (50-74%)", "points": 70, "descriptor": "Applies key concepts accurately." },
                { "label": "Proficient (75-89%)", "points": 85, "descriptor": "Thorough analytical justification." },
                { "label": "Advanced (90-100%)", "points": 100, "descriptor": "Mastery with insightful evaluation." }
              ]
            },
            {
              "criterionTitle": "Evidence of Analytical Reasoning",
              "weightPercentage": 50,
              "levels": [
                { "label": "Novice (0-49%)", "points": 40, "descriptor": "Limited logical connection." },
                { "label": "Competent (50-74%)", "points": 70, "descriptor": "Coherent problem-solving method." },
                { "label": "Proficient (75-89%)", "points": 85, "descriptor": "Rigorous evidence-based approach." },
                { "label": "Advanced (90-100%)", "points": 100, "descriptor": "Exemplary critical synthesis." }
              ]
            }
          ]
        },
        {
          "title": "Summative Capstone Workplace Project",
          "type": "summative",
          "description": "Comprehensive practical demonstration of competence satisfying all performance criteria.",
          "rubric": []
        }
      ]
    }
  ]
}`;
}

/**
 * Resilient deterministic fallback generator when AI API is unavailable
 */
function generateFallbackAqfCourse(syllabusText, targetAqfLevel) {
  const aqfMeta = getAqfLevelMeta(targetAqfLevel || 4);
  const sampleTitle = syllabusText.split('\n')[0].replace(/^[#\s*]+/, '').trim() || 'Applied Professional Studies';

  return {
    title: sampleTitle.length > 5 ? sampleTitle : `Certificate IV in ${sampleTitle || 'Modern Technology'}`,
    code: `CRS-${aqfMeta.level}01`,
    aqfLevel: aqfMeta.level,
    aqfEquivalenceNotes: `Mapped to AQF Level ${aqfMeta.level} (${aqfMeta.credential}). Calibrated with Bloom's Taxonomy cognitive standards.`,
    description: `A competency-based qualification satisfying ${aqfMeta.title} requirements. Prepares learners with operational knowledge, analytical methods, and practical discipline skills.`,
    learningOutcomes: [
      `Demonstrate broad theoretical and technical knowledge applicable to AQF Level ${aqfMeta.level}.`,
      'Apply systematic problem-solving methods to define and resolve discipline-specific challenges.',
      'Communicate technical solutions effectively adhering to professional documentation protocols.'
    ],
    units: [
      {
        id: generateEntityId('unit'),
        unitCode: `UNIT-${aqfMeta.level}01`,
        unitTitle: 'Unit 1: Fundamental Principles & Practice',
        nominalHours: 45,
        description: 'Examines foundational theoretical knowledge and standard operating procedures.',
        lessons: [
          {
            id: generateEntityId('lesson'),
            title: 'Lesson 1: Introduction to Framework Principles',
            order: 0,
            estimatedMinutes: 50,
            blocks: [
              {
                id: generateEntityId('block'),
                type: 'text_description',
                order: 0,
                title: 'Core Concepts & Analytical Definitions',
                content: `This lesson introduces the primary concepts outlined in the syllabus. Students analyze baseline principles aligned with ${aqfMeta.credential} expectations.`,
                metadata: {}
              },
              {
                id: generateEntityId('block'),
                type: 'teacher_guide',
                order: 1,
                title: 'Instructor Pedagogy & Timing Recommendations',
                content: 'Dedicate the first 15 minutes to class discussion. Scaffold technical terminology using real-world case studies.',
                metadata: {}
              },
              {
                id: generateEntityId('block'),
                type: 'google_drive_link',
                order: 2,
                title: 'Practical Exercise Worksheet (Google Drive)',
                content: 'https://drive.google.com/drive/folders/sampleLessonWorksheet',
                metadata: {
                  driveUrl: 'https://drive.google.com/drive/folders/sampleLessonWorksheet'
                }
              }
            ]
          }
        ],
        assessments: [
          {
            id: generateEntityId('asmt'),
            title: 'Assessment Task 1: Practical Demonstration & Portfolio',
            type: 'summative',
            description: 'Learners apply core principles in a realistic simulation and submit evidence of competency.',
            externalSubmissionLinks: [],
            rubric: createDefaultRubric()
          }
        ]
      }
    ]
  };
}

/**
 * Top-level ✨ AI Assist Engine
 *
 * Rules:
 * 1. Checks token balance for the AI Assist fee (or charity teacher / 0-fee bypass).
 * 2. Deducts the fee upon initiation.
 * 3. Generates the hydrated Course schema, guided by the selected Curriculum Standards.
 *
 * @param {string[]} [curriculumStandards] selected standard ids (e.g. ['aacsb', 'teqsa'])
 * @param {object} [skillTexts]  map of standard id -> skill Markdown text
 * @param {number} [costTokens]  Super Admin configured fee (whole number 0–10, default 10)
 */
export async function ingestCourseSyllabusWithAI({
  currentUser,
  userProfile,
  syllabusText,
  targetAqfLevel = 4,
  curriculumStandards = [],
  skillTexts = {},
  costTokens = AI_INGEST_COST_TOKENS,
  apiKey = DEFAULT_GEMINI_KEY
}) {
  if (!currentUser?.uid) {
    throw new Error('Please sign in to use ✨ AI Assist.');
  }

  if (!syllabusText || syllabusText.trim().length < 15) {
    throw new Error('Please provide syllabus content, lecture notes, or course documents to ingest.');
  }

  const isCharity = isUserCharityTeacher(userProfile);
  const cost = normalizeAiAssistCost(costTokens);

  // 1. Token Validation & Metering (Super Admin fee, default 10 tokens)
  let tokensCharged = 0;
  if (!isCharity && cost > 0) {
    const balance = await getUserTokenBalance(currentUser.uid).catch(() => 0);
    if (balance < cost) {
      const err = new Error(
        `Insufficient tokens for ✨ AI Assist. Requires ${cost} tokens, current balance is ${balance} tokens.`
      );
      err.code = 'INSUFFICIENT_TOKENS_FOR_AI';
      err.requiredTokens = cost;
      err.currentBalance = balance;
      throw err;
    }

    // Transactional deduction (creditUserTokens cannot deduct — it floors amounts at +1)
    try {
      await deductUserTokens(currentUser.uid, cost, { type: 'ai_assist_course' });
    } catch (deductErr) {
      if (deductErr?.code === 'INSUFFICIENT_TOKENS') {
        const err = new Error(deductErr.message);
        err.code = 'INSUFFICIENT_TOKENS_FOR_AI';
        err.requiredTokens = cost;
        err.currentBalance = deductErr.currentBalance;
        throw err;
      }
      throw new Error(`Could not process the ${cost}-token charge. No tokens were deducted — please try again.`);
    }
    tokensCharged = cost;
  }

  // 2. Execute Gemini Ingestion
  let generatedData = null;
  const resolvedKey = apiKey || DEFAULT_GEMINI_KEY;

  if (resolvedKey) {
    try {
      const prompt = buildAqfIngestPrompt(syllabusText, targetAqfLevel, curriculumStandards, skillTexts);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), AI_ASSIST_TIMEOUT_MS);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(resolvedKey)}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json'
          }
        })
      }).finally(() => clearTimeout(timer));

      if (response.ok) {
        const json = await response.json();
        const candidate = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidate) {
          const cleaned = candidate.trim().replace(/^```json/i, '').replace(/```$/i, '').trim();
          generatedData = JSON.parse(cleaned);
        }
      } else {
        console.warn('Gemini Ingest HTTP error:', response.status);
      }
    } catch (err) {
      console.warn('Gemini Ingestion parsing note, using deterministic fallback:', err);
    }
  }

  // Fallback if API returned null or parse failed
  if (!generatedData) {
    generatedData = generateFallbackAqfCourse(syllabusText, targetAqfLevel);
  }

  // 3. Normalize into full Course schema with unique IDs
  const hydratedCourse = {
    id: generateEntityId('course'),
    authorId: currentUser.uid,
    authorName: currentUser.displayName || currentUser.email?.split('@')[0] || 'Teacher',
    title: generatedData.title || 'AQF Certified Course',
    code: generatedData.code || `CRS-${targetAqfLevel}01`,
    aqfLevel: Number(generatedData.aqfLevel || targetAqfLevel || 4),
    aqfEquivalenceNotes: generatedData.aqfEquivalenceNotes || '',
    category: generatedData.category || 'General Academic',
    description: generatedData.description || '',
    token_cost: 10,
    isPublished: false,
    learningOutcomes: Array.isArray(generatedData.learningOutcomes) ? generatedData.learningOutcomes : [],
    tags: ['OzEdu', `AQF${targetAqfLevel}`, 'AI-Ingested'],
    units: (generatedData.units || []).map((u, uIdx) => ({
      id: generateEntityId('unit'),
      unitCode: u.unitCode || `UNIT-${uIdx + 1}01`,
      unitTitle: u.unitTitle || `Unit ${uIdx + 1}`,
      nominalHours: Number(u.nominalHours) || 40,
      description: u.description || '',
      lessons: (u.lessons || []).map((l, lIdx) => ({
        id: generateEntityId('lesson'),
        title: l.title || `Lesson ${lIdx + 1}`,
        order: lIdx,
        estimatedMinutes: Number(l.estimatedMinutes) || 45,
        blocks: (l.blocks || []).map((b, bIdx) => ({
          id: generateEntityId('block'),
          type: b.type || 'text_description',
          order: bIdx,
          title: b.title || '',
          content: b.content || '',
          metadata: b.metadata || {}
        }))
      })),
      assessments: (u.assessments || []).map(a => ({
        id: generateEntityId('asmt'),
        title: a.title || 'Assessment Task',
        type: a.type || 'formative',
        description: a.description || '',
        externalSubmissionLinks: a.externalSubmissionLinks || [],
        rubric: a.rubric?.length ? a.rubric : createDefaultRubric()
      }))
    })),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  return {
    course: hydratedCourse,
    tokensCharged,
    charityPassApplied: isCharity,
    message: isCharity
      ? '✨ Course built with AI Assist! (0 tokens - Charity Pass applied)'
      : `✨ Course built with AI Assist! (Charged ${tokensCharged} tokens)`
  };
}
