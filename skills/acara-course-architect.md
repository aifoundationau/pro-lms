---
name: acara-course-architect
description: Unified ACARA F-12 curriculum architect for the OzEdu Course Builder (AQFCourseBuilder.jsx).
---

# ACARA Universal Curriculum Architect

## 1. BAND CALIBRATION MATRIX
When the teacher specifies a year level, calibrate pedagogical depth, lesson pacing, and achievement expectations to the corresponding band:

| Band / Phase | Target Age | Cognitive & Pedagogical Focus | Assessment & Rubric Emphasis |
| :--- | :--- | :--- | :--- |
| **Foundation (F)** | 5–6 yrs | Play-based, oral language, concrete manipulatives, sensory inquiry. | Observational checklists, formative participation, foundational skills. |
| **Years 1–2** | 6–8 yrs | Foundational literacy/numeracy, guided inquiry, personal world exploration. | Simple 4-tier rubrics evaluating guided tasks and basic understanding. |
| **Years 3–4** | 8–10 yrs | Consolidating fluency, expanding vocabulary, regional/community contexts. | Multi-step problem solving, applied understanding, structured reflections. |
| **Years 5–6** | 10–12 yrs | Abstract concepts, critical analysis, digital literacy, national/global issues. | Independent inquiries, critical synthesis, project deliverables. |
| **Years 7–8** | 12–14 yrs | Disciplinary depth, specialized terminology, structured arguments, digital ethics. | Analytical essays, experimental design, cross-curricular projects. |
| **Years 9–10** | 14–16 yrs | Elective specialization, sophisticated analysis, ethical evaluation, senior prep. | Authentic problem briefs, research papers, autonomous portfolios. |
| **Years 11–12** | 16–18 yrs | Senior secondary units (Units 1–4), pre-tertiary rigor, state syllabus alignment. | High-stakes summative deliverables, complex analytical synthesis. |

## 2. THE THREE DIMENSIONS (MANDATORY IN EVERY COURSE)
For every course, the agent must integrate:
1. **Dimension 1: Learning Area**: English, Math, Science, HASS, Health & PE, Arts, Technologies, Languages.
2. **Dimension 2: General Capabilities**: Explicitly tag at least 2 in each lesson (Literacy, Numeracy, Digital Literacy, Critical & Creative Thinking, Personal & Social, Ethical Understanding, Intercultural Understanding).
3. **Dimension 3: Cross-Curriculum Priorities**: Weave in where applicable (Aboriginal & Torres Strait Islander Histories & Cultures, Asia & Australia's Engagement, Sustainability).

## 3. OZEDU UI MAPPINGS (`AQFCourseBuilder.jsx`)
- Set `aqfLevel: 0` (Flexible International / Non-AQF / Bespoke).
- Set `nominalHours` based on term length (typically 20–40 hrs).
- Populate the 5 native blocks: `text_description` (student theory & capabilities), `teacher_guide` (timings: 0-15m, 15-30m, 30-45m + differentiation notes), `youtube_video`, `google_drive_link`, and `file_upload`.
- Generate 4-tier rubrics aligned with ACARA's 5-point achievement standards (A–E equivalents).
