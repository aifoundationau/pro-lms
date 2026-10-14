/**
 * AQF Taxonomy & Course Domain Data Models
 * Australian Qualifications Framework (AQF Levels 1–9) + International Flexible Reference
 */

export const AQF_LEVELS = [
  {
    level: 0,
    title: 'International / Unassigned',
    shortTitle: 'Flexible International',
    credential: 'Non-AQF / Bespoke Curriculum',
    summary: 'Custom global curriculum not mapped to the Australian national qualifications framework. Every category is fully customizable.',
    competencySummary: 'Flexible learning outcomes tailored to custom institutional or international frameworks.'
  },
  {
    level: 1,
    title: 'AQF Level 1 — Certificate I',
    shortTitle: 'Level 1 (Cert I)',
    credential: 'Certificate I',
    summary: 'Foundational knowledge and skills for initial work, community involvement, and further study.',
    competencySummary: 'Under direct supervision; routine, predictable tasks; basic literacy and numeracy.'
  },
  {
    level: 2,
    title: 'AQF Level 2 — Certificate II',
    shortTitle: 'Level 2 (Cert II)',
    credential: 'Certificate II',
    summary: 'Knowledge and skills for work in defined contexts and pathways to further learning.',
    competencySummary: 'Procedural and routine tasks; operational knowledge; limited autonomy under general supervision.'
  },
  {
    level: 3,
    title: 'AQF Level 3 — Certificate III',
    shortTitle: 'Level 3 (Cert III)',
    credential: 'Certificate III',
    summary: 'Skilled work and apprenticeship pathways requiring theoretical and practical knowledge.',
    competencySummary: 'Skilled trades and technical roles; autonomous discretion in standard operating procedures.'
  },
  {
    level: 4,
    title: 'AQF Level 4 — Certificate IV',
    shortTitle: 'Level 4 (Cert IV)',
    credential: 'Certificate IV',
    summary: 'Specialized technical knowledge and supervisory competencies for broad industry sectors.',
    competencySummary: 'Supervisory leadership, technical problem-solving, quality assurance, team guidance.'
  },
  {
    level: 5,
    title: 'AQF Level 5 — Diploma',
    shortTitle: 'Level 5 (Diploma)',
    credential: 'Diploma',
    summary: 'Paraprofessional technical, business, and creative competencies bridging vocational and tertiary study.',
    competencySummary: 'Complex cognitive and technical skills; initiative in planning, resource management, and team leadership.'
  },
  {
    level: 6,
    title: 'AQF Level 6 — Advanced Diploma / Associate Degree',
    shortTitle: 'Level 6 (Adv Dip / Assoc)',
    credential: 'Advanced Diploma / Associate Degree',
    summary: 'Senior paraprofessional and specialized diagnostic, technical, and operational mastery.',
    competencySummary: 'Broad theoretical foundations, high-level analysis, strategic operational execution.'
  },
  {
    level: 7,
    title: 'AQF Level 7 — Bachelor Degree',
    shortTitle: 'Level 7 (Bachelor)',
    credential: 'Bachelor Degree',
    summary: 'Broad and coherent body of professional knowledge with depth in underlying principles.',
    competencySummary: 'Professional autonomy, critical enquiry, evidence-based reasoning, lifelong learning capability.'
  },
  {
    level: 8,
    title: 'AQF Level 8 — Bachelor Honours / Grad Certificate / Grad Diploma',
    shortTitle: 'Level 8 (Honours / Grad Dip)',
    credential: 'Bachelor Honours / Grad Cert / Grad Diploma',
    summary: 'Advanced specialized knowledge and research preparation building on undergraduate foundations.',
    competencySummary: 'Advanced scholarship, research methodology, systematic critical analysis.'
  },
  {
    level: 9,
    title: 'AQF Level 9 — Masters Degree',
    shortTitle: 'Level 9 (Masters)',
    credential: 'Masters Degree',
    summary: 'Mastery of expert specialized practice, research investigation, or high-level professional execution.',
    competencySummary: 'Independent research, strategic intellectual leadership, novel contribution to professional discipline.'
  }
];

export const CONTENT_BLOCK_TYPES = [
  {
    type: 'text_description',
    label: 'Content Description',
    icon: '📝',
    description: 'Rich explanatory text, lesson overview, and markdown instructional notes.'
  },
  {
    type: 'teacher_guide',
    label: 'Teacher Guide',
    icon: '🧑‍🏫',
    description: 'Internal pedagogy guidance, facilitation tips, lesson timings, and educator secrets.'
  },
  {
    type: 'youtube_video',
    label: 'YouTube Video',
    icon: '▶️',
    description: 'Interactive streaming video with automatic timestamping and player integration.'
  },
  {
    type: 'google_drive_link',
    label: 'Google Drive Resource',
    icon: '📁',
    description: 'Shared slide decks, assignment briefs, spreadsheets, and shared folders.'
  },
  {
    type: 'file_upload',
    label: 'Direct File Attachment',
    icon: '📎',
    description: 'Downloadable PDF handouts, workbooks, code archives, and supplementary files.',
    // Not offered in the Add Block toolbar yet; existing attachment blocks still display.
    disabled: true,
    disabledReason: 'Direct file attachments are coming soon. Use a Google Drive Resource link for now.'
  },
  {
    type: 'notebook_link',
    label: 'Gemini Notebook',
    icon: '📓',
    description: 'Gemini Notebook (or NotebookLM) share link for guided study and AI-assisted notes.'
  },
  {
    type: 'quiz',
    label: 'Quiz & Questions',
    icon: '❓',
    description: 'Multiple choice, true/false, short answer and open questions. Closed questions are marked automatically; open answers are marked in bulk by the teacher.'
  }
];

// ---------- Unit quizzes (the "Quiz & Questions" block) ----------

/** Question types: closed ones have a fixed answer and are marked automatically; open ones by the teacher. */
export const QUIZ_QUESTION_TYPES = Object.freeze([
  Object.freeze({ type: 'multiple_choice', label: 'Multiple choice', closed: true }),
  Object.freeze({ type: 'true_false', label: 'True / False', closed: true }),
  Object.freeze({ type: 'short_answer', label: 'Short answer', closed: true }),
  Object.freeze({ type: 'open', label: 'Open question', closed: false })
]);

/** Answer-key fields: stored only in the staff-only lms_quiz_keys collection, never in the course. */
export const QUIZ_KEY_FIELDS = Object.freeze(['correctOptionIds', 'correctAnswer', 'acceptedAnswers', 'modelAnswer']);

export const QUIZ_LIMITS = Object.freeze({ questions: 100, options: 10, prompt: 2000, option: 500, answer: 5000, points: 100 });

/** A new question of the given type, with sensible defaults (answer key fields included). */
export function createQuizQuestion(type = 'multiple_choice') {
  const base = { id: generateEntityId('q'), type, prompt: '', points: 1 };
  switch (type) {
    case 'true_false':
      return { ...base, correctAnswer: true };
    case 'short_answer':
      return { ...base, acceptedAnswers: [] };
    case 'open':
      return { ...base, points: 5, modelAnswer: '' };
    default: {
      const options = ['', '', '', ''].map(() => ({ id: generateEntityId('opt'), text: '' }));
      return { ...base, type: 'multiple_choice', options, allowMultiple: false, correctOptionIds: [options[0].id] };
    }
  }
}

export function createBlankQuiz() {
  return { instructions: '', questions: [createQuizQuestion('multiple_choice')] };
}

/** Block types whose content is a link (stored in `content` and in block.metadata). */
export const LINK_BLOCK_METADATA_KEYS = Object.freeze({
  youtube_video: 'youtubeUrl',
  google_drive_link: 'driveUrl',
  file_upload: 'fileUrl',
  notebook_link: 'notebookUrl'
});

/**
 * True for an https Gemini Notebook / NotebookLM link: a Google host (google.com or the .google
 * domain) with "notebook" in the host name or path, e.g. https://notebooklm.google.com/notebook/…,
 * https://notebook.google.com/…, https://notebooklm.google/…, https://gemini.google.com/notebook/…
 */
export function isGoogleNotebookUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const host = url.hostname.toLowerCase();
    const googleHost = host === 'google.com' || host.endsWith('.google.com') || host.endsWith('.google');
    return url.protocol === 'https:' && googleHost && (host.includes('notebook') || /\/notebooks?(\/|$)/i.test(url.pathname));
  } catch {
    return false;
  }
}

let entityIdCounter = 0;

/**
 * Creates a unique ID with an optional prefix
 */
export function generateEntityId(prefix = 'ent') {
  // The counter keeps ids made in the same millisecond unique (e.g. a spreadsheet import creating many blocks).
  entityIdCounter = (entityIdCounter + 1) % 1679616; // 36^4
  return `${prefix}_${Date.now().toString(36)}_${entityIdCounter.toString(36)}${Math.random().toString(36).substring(2, 7)}`;
}

/**
 * Default rubric performance levels (lowest first). A rubric may use 2–10 levels with
 * its own labels, e.g. HD/D/C/P/F bands imported from a spreadsheet.
 */
export const DEFAULT_RUBRIC_LEVEL_LABELS = ['Novice (0-49%)', 'Competent (50-74%)', 'Proficient (75-89%)', 'Advanced (90-100%)'];
export const MIN_RUBRIC_LEVELS = 2;
export const MAX_RUBRIC_LEVELS = 10;

/** Points per level, lowest first: 40/70/85/100 for the default 4 tiers, otherwise evenly spaced. */
export function defaultLevelPoints(count) {
  const n = Math.max(1, Math.floor(Number(count) || 0));
  if (n === 4) return [40, 70, 85, 100];
  return Array.from({ length: n }, (_, i) => Math.round(((i + 1) / n) * 100));
}

/**
 * Default Rubric Matrix Criteria structure
 */
export function createDefaultRubric() {
  return [
    {
      id: generateEntityId('rubric'),
      criterionTitle: 'Knowledge Application & Conceptual Understanding',
      weightPercentage: 40,
      levels: [
        { label: 'Novice (0-49%)', points: 40, descriptor: 'Superficial understanding; requires guidance to apply core concepts.' },
        { label: 'Competent (50-74%)', points: 70, descriptor: 'Accurately applies key principles to routine and moderately complex scenarios.' },
        { label: 'Proficient (75-89%)', points: 85, descriptor: 'Demonstrates thorough analytical grasp with coherent justifications.' },
        { label: 'Advanced (90-100%)', points: 100, descriptor: 'Exemplary critical synthesis and novel conceptual integration.' }
      ]
    },
    {
      id: generateEntityId('rubric'),
      criterionTitle: 'Practical Execution & Evidence of Skills',
      weightPercentage: 40,
      levels: [
        { label: 'Novice (0-49%)', points: 40, descriptor: 'Incomplete implementation with frequent operational inconsistencies.' },
        { label: 'Competent (50-74%)', points: 70, descriptor: 'Functional execution satisfying all primary task requirements.' },
        { label: 'Proficient (75-89%)', points: 85, descriptor: 'Robust, polished implementation adhering to professional industry standards.' },
        { label: 'Advanced (90-100%)', points: 100, descriptor: 'Flawless execution exceeding expectations with elegant efficiency.' }
      ]
    },
    {
      id: generateEntityId('rubric'),
      criterionTitle: 'Communication & Documentation',
      weightPercentage: 20,
      levels: [
        { label: 'Novice (0-49%)', points: 40, descriptor: 'Disorganized presentation; unclear terminology.' },
        { label: 'Competent (50-74%)', points: 70, descriptor: 'Clear, structured explanation with appropriate academic terminology.' },
        { label: 'Proficient (75-89%)', points: 85, descriptor: 'Well-articulated, polished documentation with rigorous citations.' },
        { label: 'Advanced (90-100%)', points: 100, descriptor: 'Publication-quality communication tailored to diverse audiences.' }
      ]
    }
  ];
}

/**
 * Creates a blank ContentBlock
 */
export function createBlankContentBlock(type = 'text_description', order = 0) {
  const block = {
    id: generateEntityId('block'),
    type,
    order,
    title: '',
    content: '',
    metadata: {
      youtubeUrl: '',
      driveUrl: '',
      drivePermissionVerified: false,
      fileUrl: '',
      fileName: '',
      fileSize: 0,
      mimeType: '',
      notebookUrl: ''
    },
    tag: 'lms'
  };
  if (type === 'quiz') {
    block.title = 'Unit Quiz';
    block.quiz = createBlankQuiz();
  }
  return block;
}

/**
 * Creates a blank Lesson
 */
export function createBlankLesson(order = 0, title = 'Lesson 1: Introduction') {
  return {
    id: generateEntityId('lesson'),
    title,
    order,
    estimatedMinutes: 45,
    tag: 'lms',
    blocks: [
      createBlankContentBlock('text_description', 0)
    ]
  };
}

/**
 * Creates a blank Assessment
 */
export function createBlankAssessment(type = 'formative', title = 'Assessment Task 1') {
  return {
    id: generateEntityId('asmt'),
    title,
    type, // 'formative' | 'summative'
    description: '',
    dueDate: '',
    nominalWeight: type === 'summative' ? 50 : 20,
    externalSubmissionLinks: [],
    tag: 'lms',
    rubric: createDefaultRubric()
  };
}

/**
 * Creates a blank Unit of Competency / Study Unit
 */
export function createBlankUnit(unitCode = 'UNIT-101', unitTitle = 'Unit 1: Fundamentals') {
  return {
    id: generateEntityId('unit'),
    unitCode,
    unitTitle,
    nominalHours: 40,
    description: '',
    learningOutcomes: [],
    tag: 'lms',
    // Units hold lessons & blocks only; assessments live once, at course level (course.assessments).
    lessons: [createBlankLesson(0, 'Lesson 1: Core Concepts')]
  };
}

/**
 * Moves assessments still stored inside units (older courses) up to the single course-level
 * Assessments & Rubrics list. Ids are kept (so existing submissions stay linked) and each moved
 * task remembers its unit in `unitId`. Pure and idempotent; never mutates the input.
 */
export function moveUnitAssessmentsToCourse(course) {
  if (!course || typeof course !== 'object') return course;
  const units = Array.isArray(course.units) ? course.units : [];
  const base = Array.isArray(course.assessments) ? course.assessments.filter(a => a && typeof a === 'object') : [];
  const hasUnitAssessments = units.some(u => u && typeof u === 'object' && 'assessments' in u);
  if (!hasUnitAssessments) {
    return Array.isArray(course.assessments) && base.length === course.assessments.length ? course : { ...course, assessments: base };
  }
  const seen = new Set(base.map(a => String(a.id ?? '')).filter(Boolean));
  const moved = [];
  for (const unit of units) {
    for (const a of Array.isArray(unit?.assessments) ? unit.assessments : []) {
      if (!a || typeof a !== 'object') continue;
      const id = String(a.id ?? '');
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      moved.push({ ...a, unitId: a.unitId || unit.id || '' });
    }
  }
  return {
    ...course,
    assessments: [...base, ...moved],
    units: units.map(u => {
      if (!u || typeof u !== 'object' || !('assessments' in u)) return u;
      const { assessments: _moved, ...rest } = u;
      return rest;
    })
  };
}

/**
 * Creates a full blank Course
 */
export function createBlankCourse(authorId = 'anonymous', authorName = 'Educator') {
  return {
    id: generateEntityId('course'),
    authorId,
    authorName,
    title: 'New Course',
    code: 'CRS-100',
    aqfLevel: 0, // Default: International / Unassigned (teachers pick an AQF level when relevant)
    category: 'Information Technology',
    year: `${new Date().getFullYear()} Semester 1`,
    startDate: new Date().toISOString().split('T')[0],
    description: '',
    token_cost: 10,
    isDraft: true,
    isPublished: false,
    status: 'draft',
    visibility: 'site',
    learningOutcomes: [
      'Analyse fundamental principles and solve discipline-specific problems.',
      'Demonstrate technical proficiency adhering to safety and quality protocols.'
    ],
    tag: 'lms',
    tags: ['lms', 'Draft', 'OzEdu', 'AQF'],
    units: [createBlankUnit('UNIT-101', 'Unit 1: Foundation Knowledge')],
    // The course's one Assessments & Rubrics section.
    assessments: [createBlankAssessment('formative', 'Knowledge Check 1')],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

/**
 * Looks up AQF metadata for a given level (0-9)
 */
export function getAqfLevelMeta(level) {
  const num = Number(level);
  return AQF_LEVELS.find(l => l.level === num) || AQF_LEVELS[0];
}
