/**
 * ✨ AI Assist: Gemini Full-Course Generation & AQF Equivalence Pipeline
 * Parses raw text or syllabus files directly into full AQF Course, Unit, Lesson, Block, and Assessment schemas.
 * Guided by the course's selected Curriculum Standards (/skills/*.md).
 * Includes token metering (Super Admin fee, default 10 tokens; 0 for Charity Teachers and the Super Admin).
 * Spreadsheet uploads use courseSpreadsheetAiService.js; both share aiCourseShared.js.
 */

import { getAqfLevelMeta, createDefaultRubric, generateEntityId } from '../types/courseBuilderTypes.js';
import { DEFAULT_GEMINI_KEY } from './geminiCourseService.js';
import { generateGeminiJson, GEMINI_ERROR } from './geminiClient.js';
import {
  buildStandardsGuidance,
  checkAiAssistBalance,
  chargeAiAssistFee,
  createUrlPolicy,
  sanitizeAiUnit,
  sanitizeAiCourseFields,
  sanitizeAiAssessments,
  normalizeRubricWeights
} from './aiCourseShared.js';
import { extractUrls, normalizeKey } from './courseSpreadsheetSchema.js';
import { finalizeCourseDraft } from './courseSpreadsheetImport.js';

export { buildStandardsGuidance };

export const AI_INGEST_COST_TOKENS = 10;

const AI_ASSIST_TIMEOUT_MS = 90000;
const AI_ASSIST_DEADLINE_MS = 180000;

/**
 * Compiles a rich system prompt directing Gemini to generate AQF-compliant JSON
 */
function buildAqfIngestPrompt(syllabusText, targetAqfLevel, curriculumStandards = [], skillTexts = {}) {
  const aqfInfo = getAqfLevelMeta(targetAqfLevel ?? 0);
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

Structure: units hold lessons and content blocks only. The course has ONE "assessments" list (nominalWeight = % of the course grade, all tasks add up to 100; "unitCode" = the unit a task mainly assesses, or "" for the whole course). End each unit's last lesson with one "quiz" block of 4-6 questions ("multiple_choice" with "options" and zero-based "correct" indexes, "true_false" with "correctAnswer", "short_answer" with "acceptedAnswers", and one "open" question with a "modelAnswer").

Links: never invent URLs. Only use URLs that appear in the source material. Create "youtube_video" (YouTube Video), "google_drive_link" (Google Drive Resource) or "notebook_link" (Gemini Notebook) blocks only for such URLs, one block per link (a lesson may have several of each); otherwise suggest videos or resources inside the teacher_guide text.

You MUST respond with pure JSON only (no markdown quotes, no triple backticks, no preamble).
The JSON MUST follow this exact structure:
{
  "title": "Clear formal course title",
  "code": "Course Code e.g. BSB40120 or ICT50220",
  "aqfLevel": ${Number(targetAqfLevel) || 0},
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
      "learningOutcomes": ["Measurable unit outcome..."],
      "lessons": [
        {
          "title": "Lesson 1: Topic Title",
          "estimatedMinutes": 45,
          "blocks": [
            {
              "type": "text_description",
              "title": "Theoretical Foundations & Concepts",
              "content": "Rich instructional text explaining the concept in detail..."
            },
            {
              "type": "teacher_guide",
              "title": "Educator Facilitation & Pedagogy Tips",
              "content": "Pedagogical guidance, recommended discussion prompts, suggested video search terms, and classroom safety notices..."
            },
            {
              "type": "quiz",
              "title": "Unit quiz",
              "content": "Answer every question.",
              "questions": [
                { "type": "multiple_choice", "prompt": "Question text", "options": ["Option A", "Option B", "Option C"], "correct": [1], "points": 1 },
                { "type": "true_false", "prompt": "Statement", "correctAnswer": true, "points": 1 },
                { "type": "short_answer", "prompt": "Question", "acceptedAnswers": ["Expected answer"], "points": 1 },
                { "type": "open", "prompt": "Question", "modelAnswer": "What a good answer includes", "points": 5 }
              ]
            }
          ]
        }
      ]
    }
  ],
  "assessments": [
        {
          "title": "Formative Knowledge Check",
          "unitCode": "UNIT401",
          "type": "formative",
          "description": "Short scenario-based task assessing immediate comprehension of unit principles.",
          "dueDate": "",
          "nominalWeight": 20,
          "rubric": [
            {
              "criterionTitle": "Application of Core Principles",
              "weightPercentage": 50,
              "levels": [
                { "label": "Novice (0-49%)", "descriptor": "Requires prompting to state basic terms." },
                { "label": "Competent (50-74%)", "descriptor": "Applies key concepts accurately." },
                { "label": "Proficient (75-89%)", "descriptor": "Thorough analytical justification." },
                { "label": "Advanced (90-100%)", "descriptor": "Mastery with insightful evaluation." }
              ]
            },
            {
              "criterionTitle": "Evidence of Analytical Reasoning",
              "weightPercentage": 50,
              "levels": [
                { "label": "Novice (0-49%)", "descriptor": "Limited logical connection." },
                { "label": "Competent (50-74%)", "descriptor": "Coherent problem-solving method." },
                { "label": "Proficient (75-89%)", "descriptor": "Rigorous evidence-based approach." },
                { "label": "Advanced (90-100%)", "descriptor": "Exemplary critical synthesis." }
              ]
            }
          ]
        },
        {
          "title": "Summative Capstone Workplace Project",
          "unitCode": "",
          "type": "summative",
          "description": "Comprehensive practical demonstration of competence satisfying all performance criteria.",
          "dueDate": "",
          "nominalWeight": 80,
          "rubric": []
        }
  ]
}`;
}

/**
 * Resilient deterministic fallback generator when AI API is unavailable
 */
function generateFallbackAqfCourse(syllabusText, targetAqfLevel) {
  const aqfMeta = getAqfLevelMeta(targetAqfLevel ?? 0);
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
        unitCode: `UNIT-${aqfMeta.level}01`,
        unitTitle: 'Unit 1: Fundamental Principles & Practice',
        nominalHours: 45,
        description: 'Examines foundational theoretical knowledge and standard operating procedures.',
        lessons: [
          {
            title: 'Lesson 1: Introduction to Framework Principles',
            estimatedMinutes: 50,
            blocks: [
              {
                type: 'text_description',
                title: 'Core Concepts & Analytical Definitions',
                content: `This lesson introduces the primary concepts outlined in the syllabus. Students analyze baseline principles aligned with ${aqfMeta.credential} expectations.`
              },
              {
                type: 'teacher_guide',
                title: 'Instructor Pedagogy & Timing Recommendations',
                content: 'Dedicate the first 15 minutes to class discussion. Scaffold technical terminology using real-world case studies.'
              },
              {
                type: 'quiz',
                title: 'Unit quiz',
                content: 'Answer every question. Your teacher releases the results.',
                questions: [
                  { type: 'true_false', prompt: 'This unit introduces the foundational principles of the course.', correctAnswer: true, points: 1 },
                  { type: 'open', prompt: 'Explain one principle from this lesson and how you would apply it at work.', modelAnswer: 'Names a principle from the lesson, explains it accurately and gives a realistic workplace application.', points: 5 }
                ]
              }
            ]
          }
        ]
      }
    ],
    assessments: [
      {
        title: 'Assessment Task 1: Practical Demonstration & Portfolio',
        unitCode: '',
        type: 'summative',
        description: 'Learners apply core principles in a realistic simulation and submit evidence of competency.',
        nominalWeight: 100,
        rubric: createDefaultRubric()
      }
    ]
  };
}

/**
 * Top-level ✨ AI Assist Engine
 *
 * Rules:
 * 1. Checks token balance for the AI Assist fee (Charity Teacher / Super Admin / 0-fee bypass).
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
  targetAqfLevel = 0,
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

  // 1. Token Validation & Metering (Super Admin fee, default 10 tokens)
  const metering = await checkAiAssistBalance({ currentUser, userProfile, costTokens });
  const tokensCharged = await chargeAiAssistFee({ currentUser, cost: metering.cost, type: 'ai_assist_course' });

  // 2. Execute Gemini Ingestion (model fallback chain, timeouts, retries)
  let generatedData = null;
  const resolvedKey = apiKey || DEFAULT_GEMINI_KEY;
  if (resolvedKey) {
    try {
      const prompt = buildAqfIngestPrompt(syllabusText, targetAqfLevel, curriculumStandards, skillTexts);
      const res = await generateGeminiJson({
        prompt,
        apiKey: resolvedKey,
        maxOutputTokens: 32768,
        attemptTimeoutMs: AI_ASSIST_TIMEOUT_MS,
        deadlineMs: AI_ASSIST_DEADLINE_MS,
        label: 'syllabus course'
      });
      generatedData = res.data;
    } catch (err) {
      if (err?.code !== GEMINI_ERROR.ABORTED) console.warn('Gemini Ingestion note, using deterministic fallback:', err?.message || err);
    }
  }

  // Fallback if API returned nothing usable
  if (!generatedData || !Array.isArray(generatedData.units) || generatedData.units.length === 0) {
    generatedData = generateFallbackAqfCourse(syllabusText, targetAqfLevel);
  }

  // 3. Validate & normalise into the full Course schema with unique IDs (links: only those in the syllabus)
  const isUrlAllowed = createUrlPolicy(extractUrls(syllabusText));
  const fields = sanitizeAiCourseFields(generatedData, { isUrlAllowed });
  const rawUnits = generatedData.units.slice(0, 30);
  const units = rawUnits.map(u => sanitizeAiUnit(u, { isUrlAllowed })).filter(Boolean);
  // One course-level Assessments & Rubrics list (tasks Gemini still put inside units are lifted up).
  const unitIndexByCode = new Map(units.map((u, i) => [normalizeKey(u.unitCode), i]).filter(([key]) => key));
  const assessments = [
    ...sanitizeAiAssessments(generatedData.assessments, { isUrlAllowed }),
    ...rawUnits.flatMap(u => sanitizeAiAssessments(u?.assessments, { isUrlAllowed }).map(a => ({ ...a, unitCode: a.unitCode || u?.unitCode || '' })))
  ].map(({ unitCode, ...task }) => ({
    ...task,
    unitIndex: unitIndexByCode.get(normalizeKey(unitCode)) ?? -1,
    rubric: normalizeRubricWeights(task.rubric)
  }));
  const targetLevel = Number(targetAqfLevel);
  const level = Number.isInteger(targetLevel) && targetLevel >= 0 && targetLevel <= 9 ? targetLevel : (fields.aqfLevel ?? 0);

  const hydratedCourse = finalizeCourseDraft({
    course: {
      title: fields.title || 'AQF Certified Course',
      code: fields.code || `CRS-${level}01`,
      aqfLevel: level,
      category: fields.category || 'General Academic',
      description: fields.description,
      aqfEquivalenceNotes: fields.aqfEquivalenceNotes,
      learningOutcomes: fields.learningOutcomes
    },
    units,
    assessments
  }, {
    id: generateEntityId('course'),
    authorId: currentUser.uid,
    authorName: currentUser.displayName || currentUser.email?.split('@')[0] || 'Teacher',
    token_cost: 10,
    isPublished: false,
    tags: ['OzEdu', `AQF${level}`, 'AI-Ingested'],
    createdAt: Date.now()
  });

  const passNote = metering.isSuperadmin
    ? '(0 tokens - Super Admin UNL)'
    : metering.isCharity ? '(0 tokens - Charity Pass applied)' : `(Charged ${tokensCharged} tokens)`;
  return {
    course: hydratedCourse,
    tokensCharged,
    charityPassApplied: metering.isCharity,
    superadminPass: metering.isSuperadmin,
    message: `✨ Course built with AI Assist! ${passNote}`
  };
}
