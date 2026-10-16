/**
 * Bundles the curriculum skill Markdown files (/skills/*.md) as raw strings via Vite.
 * Keyed by the standard ids in curriculumStandards.js.
 * Browser/Vite only — Node tests should import curriculumStandards.js instead.
 */
import aacsbSkill from '../../skills/aacsb-course-architect.md?raw';
import teqsaSkill from '../../skills/teqsa-course-architect.md?raw';
import acaraSkill from '../../skills/acara-course-architect.md?raw';
import ukQaaSkill from '../../skills/uk-qaa-course-architect.md?raw';
import ukOfstedSkill from '../../skills/uk-ofsted-secondary-architect.md?raw';
import internationalSkill from '../../skills/international-unassigned.md?raw';

export const SKILL_TEXTS = {
  aacsb: aacsbSkill,
  teqsa: teqsaSkill,
  acara: acaraSkill,
  uk_qaa: ukQaaSkill,
  uk_ofsted: ukOfstedSkill,
  international: internationalSkill
};
