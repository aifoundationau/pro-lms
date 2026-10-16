/**
 * Multi-Standard Curriculum Registry & Skill Routing (Course Builder V2)
 *
 * Pure module (no Firebase, no Vite-only imports) so it can be unit-tested in Node.
 * Each standard maps to a Markdown skill file in /skills. The MD text itself is
 * loaded separately by curriculumSkillTexts.js (Vite ?raw imports).
 *
 * Routing rules:
 * - Standards with `enforceAqfLevels: true` (AACSB, TEQSA) only apply when the course
 *   AQF level is in `aqfLevels`. Otherwise generation falls back to Bloom's Taxonomy.
 * - International / school standards (UK QAA, UK Ofsted, ACARA) recommend AQF Level 0
 *   but still apply at other levels (the UI shows an advisory).
 * - No applicable standard selected -> framework-agnostic Bloom's Taxonomy.
 */

export const CURRICULUM_STANDARDS = [
  {
    id: 'aacsb',
    label: 'AACSB',
    flag: '🎓',
    region: 'Global (Business Schools)',
    description: 'AACSB business accreditation: Digital Agility (4.3), Research (4.5/8), Practice (4.4), AoL rubrics (5.1), Societal Impact (9).',
    skillFile: 'skills/aacsb-course-architect.md',
    aqfLevels: [7, 8, 9],
    enforceAqfLevels: true
  },
  {
    id: 'teqsa',
    label: 'TEQSA',
    flag: '🇦🇺',
    region: 'Australia (Higher Education)',
    description: 'HESF Threshold Standards 2021: academic integrity, Gen AI guidance, student wellbeing, transparent 4-tier rubrics.',
    skillFile: 'skills/teqsa-course-architect.md',
    aqfLevels: [7, 8, 9],
    enforceAqfLevels: true
  },
  {
    id: 'acara',
    label: 'ACARA (F–12)',
    flag: '🇦🇺',
    region: 'Australia (Schools)',
    description: 'Australian Curriculum: band calibration, General Capabilities, Cross-Curriculum Priorities, A–E achievement standards.',
    skillFile: 'skills/acara-course-architect.md',
    aqfLevels: [0],
    enforceAqfLevels: false
  },
  {
    id: 'uk_qaa',
    label: 'UK QAA / FHEQ',
    flag: '🇬🇧',
    region: 'United Kingdom (Higher Education)',
    description: 'UK Quality Code 2024, FHEQ Levels 4–7, CATS credits (1 credit = 10 hrs), UK degree classification rubrics.',
    skillFile: 'skills/uk-qaa-course-architect.md',
    aqfLevels: [0],
    enforceAqfLevels: false
  },
  {
    id: 'uk_ofsted',
    label: 'UK Ofsted (KS3–5)',
    flag: '🇬🇧',
    region: 'United Kingdom (Secondary)',
    description: 'Ofsted EIF Intent / Implementation / Impact, exam board AOs, GCSE 9–1 and A-Level grading tiers, SEND scaffolding.',
    skillFile: 'skills/uk-ofsted-secondary-architect.md',
    aqfLevels: [0],
    enforceAqfLevels: false
  },
  {
    id: 'international',
    label: 'International / Unassigned',
    flag: '🌐',
    region: 'Global / Flexible',
    description: 'Flexible global or unassigned curriculum (GCSE, A-Levels, bespoke enterprise, micro-credentials) not bound to a national auditing body.',
    skillFile: 'skills/international-unassigned.md',
    aqfLevels: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    enforceAqfLevels: false
  }
];

const STANDARD_IDS = new Set(CURRICULUM_STANDARDS.map(s => s.id));

export function getStandardMeta(id) {
  return CURRICULUM_STANDARDS.find(s => s.id === id) || null;
}

/**
 * Validates an untrusted list of standard ids (e.g. from a Firestore course doc).
 * Drops unknown ids and duplicates, preserving registry order.
 */
export function sanitizeStandardIds(ids) {
  if (!Array.isArray(ids)) return [];
  const wanted = new Set(ids.filter(id => typeof id === 'string' && STANDARD_IDS.has(id)));
  return CURRICULUM_STANDARDS.filter(s => wanted.has(s.id)).map(s => s.id);
}

/**
 * Resolves which selected standards actually apply at the given AQF level.
 *
 * @returns {{
 *   active: object[],      // standards whose skill MD will be injected into the prompt
 *   skipped: object[],     // enforced standards excluded because the AQF level is out of range
 *   advisories: string[],  // non-blocking UI hints (e.g. "recommends Level 0")
 *   useBloomsFallback: boolean
 * }}
 */
export function resolveActiveStandards(selectedIds, aqfLevel) {
  const level = Number.isFinite(Number(aqfLevel)) ? Number(aqfLevel) : 4;
  const selected = sanitizeStandardIds(selectedIds).map(getStandardMeta);

  const active = [];
  const skipped = [];
  const advisories = [];

  for (const std of selected) {
    const inRange = std.aqfLevels.includes(level);
    if (std.enforceAqfLevels && !inRange) {
      skipped.push(std);
      advisories.push(`${std.label} applies only to AQF Levels ${std.aqfLevels.join(', ')} — skipped at the current level (Bloom's Taxonomy used instead).`);
      continue;
    }
    if (!inRange) {
      advisories.push(`${std.label} recommends "Level 0: International / Non-AQF" — rules still applied.`);
    }
    active.push(std);
  }

  return {
    active,
    skipped,
    advisories,
    useBloomsFallback: active.length === 0
  };
}
