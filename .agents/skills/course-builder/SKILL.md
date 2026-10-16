---
name: course-builder
description: Comprehensive instructions and standards for the AI Agent assisting educators with building courses in OzEdu LMS. Covers Course Builder - New Course specifications, syllabus pasting and scanning, Academic English advisory, field taxonomy, AQF calibration, curriculum alignment, plain-text protocol, optionality rules, and draft saving anytime.
---

# Skill: OzEdu Course Builder — AI Agent Assistant

This skill guides the AI Agent when assisting educators, curriculum designers, and administrators in authoring, validating, and generating courses in the OzEdu LMS Course Builder.

---

## 1. AI Agent Mission & Operating Principles

The AI Agent acts as an expert **Curriculum Architect & Regulatory Compliance Specialist**. When assisting with building a course, the AI must strictly adhere to the following core tenets:

1. **Every Field is Optional (Advised to Complete All)**:
   - Every single field across Course Builder is **strictly optional**. The educator is never forced to complete any field to proceed or save.
   - However, the AI Agent must proactively **advise the educator to fill out all fields**, explaining that complete specifications ensure regulatory compliance, institutional audit readiness, student clarity, and optimal platform cataloging.
   - For any omitted field, provide safe empty defaults (`""`, `0`, or `[]`). Never throw validation errors or prevent the teacher from moving forward.

2. **Save Draft Anytime & Multi-Location Draft Saving**:
   - The Course Builder is organized into **3 collapsible dropdown boxes (accordions)**:
     - **Dropdown Box 1: Course Specifications** (foundational course details, Level Taxonomy, Curriculum Standards AI Alignment, and core attributes).
     - **Dropdown Box 2: Course Assessments & Rubrics** (formative and summative course assessment tasks, deadlines, weightings totaling 100%, external submission links, and rubric matrices).
     - **Dropdown Box 3: Units of Study** (unit codes, titles, nominal hours, performance criteria, unit outcomes, instructional content, quizzes, and multimedia blocks).
   - The teacher can **Save as Draft in every dropdown box and at the bottom of the main window**:
     - **In Box 1 (Course Specifications)**: via the header bar "Save Draft" button and the bottom action row when expanded.
     - **In Box 2 (Course Assessments & Rubrics)**: via the header bar "Save Draft" button and the bottom action row when expanded.
     - **In Box 3 (Units of Study)**: via the header bar "Save Draft" button and the bottom action row when expanded.
     - **At the bottom of the main window**: via the prominent bottom action bar with live save status, "Save Draft" button, and "Publish Course" button.
     - **In the top navigation bar**: always accessible via the top-right header action bar.
   - The teacher can **save a draft at any time**, with any amount of content—whether just a course title, a single sentence, or all fields completed.
   - Saving as a draft (`status: "draft"`, `isDraft: true`, `isPublished: false`) is **never blocked or gated**.
   - **Auto-Save After Every Entry**: The Course Builder automatically saves changes to the cloud database after every entry or edit (debounced at 1.2s to prevent database contention while ensuring zero data loss).
   - **Immediate AI Auto-Save**: Even AI entries (such as generating a course from a syllabus) automatically and immediately trigger an auto-save to cloud storage upon completion.
   - The AI must actively reassure the educator that their work is continuously protected and auto-saved at every step.

3. **Strict Plain Text Only (Input & Output)**:
   - **Only plain text is accepted**: No HTML markup (e.g., `<p>`, `<br>`, `<div>`, `<b>`), no Markdown formatting (e.g., `**bold**`, `*italic*`, `# Heading`, backticks, bullet symbols), and no rich-text artifacts. If an educator inputs text containing tags or markdown markers, the AI must automatically sanitize and strip them into clean plain text.
   - **Output is plain text**: All generated or suggested course copy—including titles, codes, course descriptions, assumed knowledge, level equivalence notes, and learning outcomes—must be delivered in **pure, clean, unformatted plain text**. Use standard paragraph breaks (`\n\n`) and natural sentence flow without special styling characters.

4. **Academic English Writing Advisory**:
   - The AI Agent acts as an expert consultant in **Academic English**, advising educators and assisting them with writing, editing, and elevating every component of their curriculum.
   - Employs scholarly diction, objective tone, disciplinary precision, and cognitive action verbs aligned with Bloom's Taxonomy and the target Level Taxonomy.

5. **Academic Rigor & AQF Calibration**:
   - Calibrate all pedagogical depth to the declared **Level Taxonomy** (AQF Levels 1–9 or International / Unassigned Level 0).
   - Higher qualification tiers demand higher-order cognitive competencies (evaluation, critical synthesis).

6. **Auditing & Regulatory Alignment**:
   - Direct content to satisfy selected **Curriculum Standards** benchmarks (TEQSA, ASQA, AACSB, ACARA, UK QAA, UK Ofsted).

---

## 2. Course Builder: New Course (The 11 Core Specifications)

### Field Info Signs & Guidance Callouts
Next to each field title in Course Builder, there is a small info sign (`ℹ`). Clicking or hovering over it displays a concise, helpful description of how to fill out that field in Academic English. The description automatically closes when the educator moves their mouse to the box (or focuses it) so they can begin typing without distraction.

When initiating a new course or assisting a creator with the foundational course specifications, the AI Agent assists with the following 11 data fields:

### Field 1: Course Title
* **Status**: Optional (Advised to complete)
* **Format**: Pure Plain Text (Academic English)
* **Definition**: The full descriptive name associated with that code (e.g., Introduction to Computer Science, Modern American Literature, Certificate IV in Business).
* **Frontend Field / Element**: `<input id="spec-title">`
* **Data Key**: `course.title` (`string`, default: `""`)
* **Examples**:
  - Higher Education: *Introduction to Computer Science*, *Modern American Literature*
  - Vocational / VET: *Certificate IV in Business*, *Diploma of Cyber Security Operations*
  - Secondary / School: *Year 10 Advanced Mathematics*, *Senior Biology*
* **AI Instructions**: 
  - Generate titles that are formal, clear, and recognizable by accreditation bodies.
  - Plain text only. No quotes, brackets, or markdown asterisks.

---

### Field 2: Course Code
* **Status**: Optional (Advised to complete)
* **Format**: Pure Plain Text (Alphanumeric)
* **Definition**: An alphanumeric shorthand used for administration and registration (e.g., CS101, ENG202, BSB40120).
* **Frontend Field / Element**: `<input id="spec-code">`
* **Data Key**: `course.code` (`string`, default: `""`)
* **Examples**:
  - Higher Education: `CS101`, `ENG202`, `BUSD301`
  - VET / Training Package: `BSB40120`, `ICT50220`, `CHC33021`
  - Secondary / Custom: `MATH-Y10A`, `BIO-VCE-34`
* **AI Instructions**: 
  - Suggest a 5 to 8 character alphanumeric code matching institutional conventions.
  - Automatically uppercase and format cleanly without spaces or punctuation.

---

### Field 3: Level Taxonomy
* **Status**: Optional (Advised to complete; defaults to 0)
* **Format**: Integer Tier (`0` to `9`)
* **Definition**: The formal qualification tier—primarily mapped to the Australian Qualifications Framework (AQF Levels 1–9) or set to International/Unassigned—that determines the depth, academic complexity, and regulatory standard of the course.
* **Frontend Field / Element**: `<select id="spec-level">`
* **Data Key**: `course.aqfLevel` (`number`, `0`–`9`, default: `0`)
* **Taxonomy Matrix**:
  | Level | Tier Title | Credential | Primary Pedagogical Focus |
  | :--- | :--- | :--- | :--- |
  | **0** | International / Unassigned | Flexible Curriculum | Custom global curricula (GCSE, A-Levels, bespoke enterprise). |
  | **1** | AQF Level 1 | Certificate I | Foundational knowledge, routine predictable tasks, direct supervision. |
  | **2** | AQF Level 2 | Certificate II | Operational knowledge, defined contexts, limited autonomy. |
  | **3** | AQF Level 3 | Certificate III | Skilled trades, theoretical and practical technical knowledge. |
  | **4** | AQF Level 4 | Certificate IV | Specialized technical knowledge, supervisory competencies. |
  | **5** | AQF Level 5 | Diploma | Paraprofessional mastery, analytical skills, initiative in planning. |
  | **6** | AQF Level 6 | Advanced Diploma / Assoc. Degree | Diagnostic, complex technical and operational strategic execution. |
  | **7** | AQF Level 7 | Bachelor Degree | Professional autonomy, critical enquiry, systematic evidence-based analysis. |
  | **8** | AQF Level 8 | Bachelor Honours / Grad Cert / Grad Dip | Advanced specialized knowledge, research methodology. |
  | **9** | AQF Level 9 | Masters Degree | Expert research investigation, strategic novel contributions to discipline. |
* **AI Instructions**: 
  - The AI Assist agent scans the syllabus and automatically determines and selects the target **Level Taxonomy** (AQF Levels 0–9).
  - Calibrate the cognitive verbs of all generated text to match the selected level.

---

### Field 4: Curriculum Standards (AI Alignment)
* **Status**: Optional (Advised to complete)
* **Format**: Array of Standard IDs
* **Definition**: Directs the AI to calibrate learning outcomes, syllabi, and rubrics against the specific auditing, quality, and compliance benchmarks of chosen educational regulatory bodies.
* **Frontend Field / Element**: `.standards-chip-grid` checkboxes (`id="spec-standards"`)
* **Data Key**: `course.curriculumStandards` (`string[]`, default: `[]`)
* **Supported Frameworks**:
  - `international`: **International / Unassigned (Global / Flexible)**: Flexible global or unassigned curriculum (GCSE, A-Levels, bespoke enterprise, micro-credentials, vocational training) not bound to a national auditing body.
  - `teqsa`: **TEQSA (Australia - Higher Ed)**: HESF Threshold Standards 2021, Academic Integrity, GenAI transparency.
  - `aacsb`: **AACSB (Global - Business)**: Digital Agility (4.3), Assurance of Learning (AoL) rubrics (5.1), Societal Impact (9).
  - `acara`: **ACARA (Australia - Schools)**: F–12 Australian Curriculum bands, General Capabilities, A–E grading.
  - `uk_qaa`: **UK QAA / FHEQ (UK - Higher Ed)**: UK Quality Code 2024, FHEQ Levels 4–7, CATS credit hours.
  - `uk_ofsted`: **UK Ofsted (UK - Secondary)**: Intent / Implementation / Impact, GCSE 9–1 grading, SEND scaffolding.
* **AI Instructions**: 
  - The AI Assist agent scans the syllabus and automatically checks the relevant Curriculum Standards boxes (e.g., `['international']` for global or corporate, `['teqsa']` for Australian university, etc.).
  - Inject selected regulatory requirements into unit outcomes, assessments, and rubrics. If none selected, default to standard Bloom's Taxonomy and `international`.

---

### Field 5: Course Description
* **Status**: Optional (Advised to complete)
* **Format**: Pure Plain Text in Academic English (Multi-paragraph supported via `\n\n`)
* **Definition**: Provides a comprehensive summary of the course's scope, core topics, target audience, and primary educational value to guide prospective learners and administrators.
* **Frontend Field / Element**: `<textarea id="spec-description">`
* **Data Key**: `course.description` (`string`, default: `""`)
* **Structure**:
  1. *Scope & Core Topics*: What the course covers.
  2. *Target Audience*: Who the course is for.
  3. *Primary Educational Value*: What capabilities graduates will possess.
* **AI Instructions**: 
  - Write in refined Academic English (150–300 words).
  - Plain text only: no bullet stars, dashes, markdown bolding, or HTML tags.

---

### Field 6: Category
* **Status**: Optional (Advised to complete)
* **Format**: Pure Plain Text
* **Definition**: Classifies the course into its broad academic discipline or vocational industry sector to organize it cleanly within the platform's course catalog and administrative reporting.
* **Frontend Field / Element**: `<input id="spec-category">`
* **Data Key**: `course.category` (`string`, default: `""`)
* **Standard Catalog Sectors**:
  - Information Technology
  - Business, Management & Commerce
  - Engineering & Applied Science
  - Creative Arts & Design
  - Health & Community Services
  - Education & Training
  - Humanities & Social Sciences
* **AI Instructions**: 
  - Plain text sector name.

---

### Field 7: Year / Semester
* **Status**: Optional (Advised to complete)
* **Format**: Pure Plain Text
* **Definition**: Specifies the exact academic year and teaching term during which the course is scheduled to run.
* **Frontend Field / Element**: `<input id="spec-year">`
* **Data Key**: `course.year` (`string`, default: `""`)
* **Examples**: `2026 Semester 1`, `2026 Term 2`, `2026/2027 Full Year`, `Summer Intensive 2026`
* **AI Instructions**: 
  - Plain text string representing calendar year and academic term.

---

### Field 8: Start Date
* **Status**: Optional (Advised to complete)
* **Format**: ISO Date String (`YYYY-MM-DD`)
* **Definition**: Sets the official calendar day when instructional content, student access, and course activities formally commence.
* **Frontend Field / Element**: `<input id="spec-start" type="date">`
* **Data Key**: `course.startDate` (`string`, default: `""`)
* **AI Instructions**: 
  - Validate standard ISO format (`YYYY-MM-DD`).

---

### Field 9: Assumed Knowledge / Prerequisites
* **Status**: Optional (Advised to complete)
* **Format**: Pure Plain Text (Academic English)
* **Definition**: Defines the prior foundational concepts, technical competencies, or completed courses a student must possess to successfully engage with and complete the curriculum.
* **Frontend Field / Element**: `<textarea id="spec-knowledge">`
* **Data Key**: `course.knowledge` (`string`, default: `""`)
* **Examples**:
  - *“Proficiency in Python programming, introductory linear algebra, and completed CS101 or equivalent industry experience.”*
  - *“Completion of Year 10 General Mathematics or equivalent secondary numeracy certification.”*
* **AI Instructions**: 
  - Plain text only. State both formal prerequisites and informal competencies clearly in standard prose using Academic English.

---

### Field 10: Level Equivalence Notes
* **Status**: Optional (Advised to complete)
* **Format**: Pure Plain Text (Academic English)
* **Definition**: Documents how this custom, unassigned, or international course compares to recognized qualification frameworks (like the AQF) for credit transfer, articulation, or compliance audits.
* **Frontend Field / Element**: `<textarea id="spec-equivalence">`
* **Data Key**: `course.aqfEquivalenceNotes` (`string`, default: `""`)
* **Examples**:
  - *“Designed to align with UK FHEQ Level 5 (Diploma of Higher Education), equivalent to AQF Level 5 (Diploma) with 60 CATS credits mapped to 20 OzEdu credit points.”*
  - *“Bespoke micro-credential evaluated at AQF Level 4 equivalent cognitive complexity for professional development credit.”*
* **AI Instructions**: 
  - Plain text only. Strongly advise completion if Level Taxonomy is `0` (International / Unassigned).

---

### Field 11: Cover Image URL
* **Status**: Optional (Advised to complete)
* **Format**: Web URL (`https://...`)
* **Definition**: The web address of the 16:9 widescreen banner image displayed as the visual header for the course across student dashboards and public catalogs.
* **Frontend Field / Element**: `<input id="spec-cover" type="url">`
* **Data Key**: `course.thumbnail` (`string`, default: `""`)
* **AI Instructions**: 
  - Validate secure web URL (`https://`) pointing to a 16:9 widescreen image format (WebP, PNG, JPEG, SVG).

---

## 3. Course Assessments & Rubrics Specifications

Educators can build one unified, course-wide assessment schedule directly inside the Course Builder. Multiple formative and summative assessments can be created to support comprehensive evaluation strategies.

### Multi-Assessment Rule
* **Multiple formative and summative assessments can be created**: The course can contain any combination and quantity of formative tasks (feedback-oriented) and summative tasks (evidence- and grade-oriented).
* **Course-Wide Grade Balance**: Sum of all summative task weightings across the course should ideally total 100%.

### Assessment Task Fields:

#### 1. Task Type
* **Status**: Optional (Defaults to Formative or Summative based on button clicked)
* **Frontend Element**: `<select className="asmt-type-select">`
* **Definition / Instructions**: Select whether the assessment is meant for ongoing feedback (Formative) or formal grading (Summative).
* **Data Key**: `assessment.type` (`'formative' | 'summative'`)
* **AI Guidance**: Formative tasks focus on diagnostic checks, low-stakes practice, and developmental feedback during learning. Summative tasks focus on benchmark competency, formal grading, and final evidence submission.

#### 2. Assessment Title
* **Status**: Optional (Advised to complete)
* **Frontend Element**: `<input placeholder="Assessment Title">`
* **Definition / Instructions**: Enter a clear, concise title that uniquely identifies the assignment for students.
* **Data Key**: `assessment.title` (`string`)
* **AI Guidance**: Titles should be specific and professional in Academic English (e.g. *Research Report: Sustainability Impact Analysis*, *Mid-Term Capstone Presentation*, *Critical Literature Critique*).

#### 3. Task Brief & Requirements
* **Status**: Optional (Advised to complete)
* **Frontend Element**: `<textarea placeholder="Task brief, submission requirements, and evidence portfolio...">`
* **Definition / Instructions**: Write a full description outlining the instructions, required deliverables, and evidence expected from students.
* **Data Key**: `assessment.description` (`string`)
* **AI Guidance**: Detail the scenario, objectives, required deliverables (word count, format, file types), step-by-step instructions, and academic integrity expectations.

#### 4. Due Date
* **Status**: Optional
* **Frontend Element**: `<input type="date">`
* **Definition / Instructions**: Enter the exact calendar deadline date by which students must submit their work.
* **Data Key**: `assessment.dueDate` (`string`, format `YYYY-MM-DD`)
* **AI Guidance**: Aligns with course timelines and student calendar scheduling.

#### 5. Weighting (% of course)
* **Status**: Optional
* **Frontend Element**: `<input type="number" min="0" max="100">`
* **Definition / Instructions**: Input the numerical percentage indicating how much this specific task contributes toward the overall course grade.
* **Data Key**: `assessment.nominalWeight` (`number`, `0` to `100`)
* **AI Guidance**: Summative task weightings across all tasks should combine to 100%. Formative practice tasks may carry 0% or low weightings.

#### 6. Covers
* **Status**: Optional (Defaults to Whole course)
* **Frontend Element**: `<select aria-label="Units covered">`
* **Definition / Instructions**: Choose the corresponding course unit, week, or module content that this assessment evaluates.
* **Data Key**: `assessment.unitId` (`string`, unit ID or empty string for Whole course)
* **AI Guidance**: Maps the assessment directly to specific unit competencies or leaves unassigned to indicate course-wide synoptic assessment.

#### 7. External Submission Link (Google Forms / Canvas / Teams)
* **Status**: Optional
* **Frontend Element**: `<input placeholder="https://forms.google.com/... or https://teams.microsoft.com/...">`
* **Definition / Instructions**: Paste the direct URL to the external LMS or tool where students submit or access the task.
* **Data Key**: `assessment.externalSubmissionLinks` (`string[]`)
* **AI Guidance**: Fully responsive field supporting direct external URLs (Google Forms, Microsoft Teams assignments, Canvas LMS, external portfolios). Pure URL format (`https://...`).

---

### Assessment Rubric Matrix (4-Tier Grading Standard)

Each assessment task includes an interactive **Assessment Rubric Matrix** allowing educators to define transparent, criteria-based grading standards across 4 standardized mastery levels:

#### Criterion & Weight
* **Definition / Instructions**: Define the individual skill or learning outcome being assessed along with its percentage weight within the task rubric.
* **Data Key**: `criterion.criterionTitle` (`string`) and `criterion.weightPercentage` (`number`, `0` to `100`)
* **AI Guidance**: Criteria weights within a single task must total 100%. Express criteria as discrete, observable academic or technical capabilities.

#### Novice (0-49%)
* **Definition / Instructions**: Describe performance that demonstrates minimal understanding or fails to meet passing standards for the criterion.
* **AI Guidance**: Highlights gaps in baseline knowledge, significant errors, absent reasoning, or unaddressed deliverable components.

#### Competent (50-74%)
* **Definition / Instructions**: Describe performance that satisfies fundamental requirements and demonstrates a basic, acceptable level of understanding.
* **AI Guidance**: Focuses on satisfactory execution, accurate definition of core concepts, meeting baseline standards, and competent functional problem solving.

#### Proficient (75-89%)
* **Definition / Instructions**: Describe performance that exceeds basic requirements through thorough understanding, strong execution, and clear insights.
* **AI Guidance**: Reserved for insightful critical evaluation, innovative synthesis, flawless technical execution, and publication- or professional-grade outputs.

---

## 4. Course Builder: Units of Study & Content Blocks Specifications

### Multi-Unit Architecture
* **A course can have multiple Units of Study**: Educators can structure qualifications with any number of discrete units (e.g., Unit 1, Unit 2, Unit 3...).
* **Automated Unit Codes**: Adding a unit automatically derives its unit code from the Course Code (e.g., `CRS-100-1`, `CRS-100-2`, or national qualification codes like `BSBTEC301`).
* **Modular Content Blocks**: Within each unit, educators can add modular content blocks (up to 150 blocks per unit) including teacher guides, multimedia links, interactive AI notebooks, and embedded self-assessment quizzes.

---

### Core Unit Fields

#### 1. Unit Code
* **Status**: Optional (Advised to complete, auto-generated on creation)
* **Format**: Pure Plain Text
* **Definition / Instructions**: Enter the unique official identifier or alphanumeric code assigned to this unit of study.
* **Frontend Element**: `<input id="unit-code-<unitId>">`
* **Data Key**: `unit.unitCode` (`string`)
* **Examples**: `BSBTEC301`, `ICTNWK420`, `ENG101-1`
* **AI Guidance**: Clear alphanumeric identifier distinguishing this unit across course marking, student tracking, and spreadsheets.

#### 2. Unit Title
* **Status**: Optional (Advised to complete)
* **Format**: Pure Plain Text (Academic English)
* **Definition / Instructions**: State a clear, descriptive name that reflects the primary subject or skill focus of the unit.
* **Frontend Element**: `<input id="unit-title-<unitId>">`
* **Data Key**: `unit.unitTitle` (`string`)
* **Examples**: *Design and produce business documents*, *Network Security Principles*, *Introduction to Ecological Systems*
* **AI Guidance**: Professional title summarizing the unit's disciplinary focus in Academic English.

#### 3. Nominal Hours
* **Status**: Optional (Advised to complete)
* **Format**: Numerical (Whole number ≥ 1)
* **Definition / Instructions**: Input the total estimated number of structured learning hours required to complete this unit.
* **Frontend Element**: `<input id="unit-hours-<unitId>" type="number" min="1">`
* **Data Key**: `unit.nominalHours` (`number`)
* **Examples**: `20`, `40`, `60`
* **AI Guidance**: Guided learning hours including instructional reading, practical activities, and self-assessment workload.

#### 4. Unit Description
* **Status**: Optional (Advised to complete)
* **Format**: Pure Plain Text (Academic English)
* **Definition / Instructions**: Provide a brief overview summarizing the unit's purpose, target audience, and key learning focus.
* **Frontend Element**: `<textarea id="unit-description-<id>">`
* **Data Key**: Content block of type `text_description` (`block.content`) rendered above Performance Criteria
* **AI Guidance**: 2–4 concise sentences contextualizing unit scope, vocational/academic relevance, and expected student engagement. Additional descriptions can be added via **Add Block → Unit Description**.

#### 5. Performance Criteria
* **Status**: Optional (Advised to complete)
* **Format**: Pure Plain Text (Academic English)
* **Definition / Instructions**: Outline the specific skills and measurable standards learners must demonstrate to achieve competency in this unit.
* **Frontend Element**: `<textarea id="unit-performance-criteria-<unitId>">`
* **Data Key**: `unit.description` (`string`)
* **AI Guidance**: Formulate observable benchmark statements (e.g. *Identifies organizational requirements, applies ergonomic principles, adheres to workplace privacy protocols*).

#### 6. Unit Learning Outcomes (one per line)
* **Status**: Optional (Advised to complete)
* **Format**: Pure Plain Text (one outcome per line)
* **Definition / Instructions**: List the specific knowledge or actionable skills students will acquire, formatted with one outcome per line starting with an active verb.
* **Frontend Element**: `<textarea id="unit-outcomes-<unitId>">`
* **Data Key**: `unit.learningOutcomes` (`string[]`)
* **AI Guidance**: 2–5 outcome statements per unit, each beginning with a Bloom's Taxonomy active verb calibrated to the course's AQF level.

#### 7. Unit Content
* **Status**: Optional (Advised to complete)
* **Format**: Pure Plain Text (Academic English, blank lines between paragraphs)
* **Definition / Instructions**: Write the detailed lesson text, explanations, practical examples, and activities that guide students through the unit.
* **Frontend Element**: `<textarea id="unit-content-<unitId>">`
* **Data Key**: `unit.content` (`string`, max 50,000 characters)
* **AI Guidance**: 500–1,000 words of comprehensive lesson instruction formatted in readable plain paragraphs with double newlines. Includes core conceptual theory, real-world case examples, step-by-step methodology, and reflective activities.

---

### Unit Content Blocks & Resources

Educators can enrich each unit by clicking **Add Block** from the block toolbar. Each content block includes a customizable title input and dedicated configuration fields:

#### 1. Teacher Guide
* **Teacher Guide - Heading**: Enter a descriptive section heading for your teacher resources and pedagogical guidance. This is to help teachers you share the course with understand the unit.
* **Teacher Guide - Internal Pedagogy & Facilitation Guide (Invisible to students)**: Write internal instructional notes, timing breakdowns, discussion scaffolding, and common misconceptions for educators that remain hidden from students.
* **Data Key**: Block of type `teacher_guide` (`block.title`, `block.content`).
* **Visibility**: Exclusively visible to educators and administrators; strictly hidden from student dashboards.

#### 2. YouTube Video
* **YouTube Video - Video Title**: Input a clear title or topic label for the video resource.
* **YouTube Video - Link / URL**: Paste the direct YouTube URL (e.g., `https://www.youtube.com/watch?v=...` or `https://youtu.be/...`) to display the embedded video in the unit.
* **Data Key**: Block of type `youtube_video` (`block.title`, `block.content` / `block.metadata.youtubeUrl`).
* **Embed Player**: Automatically validates URL and renders a secure responsive video streaming player.

#### 3. Google Drive Resource
* **Google Drive Resource - Resource Title**: Enter a descriptive name for the linked document, presentation, or spreadsheet.
* **Google Drive Resource - Share Link**: Paste the public or shared Google Drive link (Docs, Slides, Sheets, or Folders) after ensuring viewing permissions are enabled.
* **Data Key**: Block of type `google_drive_link` (`block.title`, `block.content` / `block.metadata.driveUrl`).
* **Permissions Advisory**: The educator must ensure the Google Drive file or folder sharing setting is set to *"Anyone with the link can view"* before publishing.

#### 4. Gemini Notebook
* **Gemini Notebook - Notebook Title**: Enter a descriptive label for the interactive AI study notebook.
* **Gemini Notebook - Share Link**: Paste the share link from NotebookLM or Gemini Notebook to give students access to guided AI study materials.
* **Data Key**: Block of type `notebook_link` (`block.title`, `block.content` / `block.metadata.notebookUrl`).
* **Validation**: Supports `https://notebooklm.google.com/notebook/...` links, giving learners interactive grounding with course-specific sources.

#### 5. Quiz & Questions
* **Quiz & Questions - Unit Quiz Title**: Enter a heading or title for the embedded self-assessment quiz.
* **Quiz & Questions - Instructions for students**: Write optional guidelines or expectations for students before they begin taking the quiz.
* **Data Key**: Block of type `quiz` (`block.title`, `block.quiz.description`, `block.quiz.questions`).
* **Security & Auto-Marking**: Answer keys are hidden from students and stored separately for educators. Supports auto-marking for closed questions and teacher marking for open questions.

---

### Embedded Unit Quiz Question Types

Within each **Quiz & Questions** block, educators can add diverse question formats:

#### 1. Question Type - Multiple Choice
* **Definition / Instructions**: Enter the question text, list answer choices, add extra options if needed, and select the correct option along with setting the question point value.
* **Fields**: Question prompt (`question.text`), answer options (`question.options`), correct answer selection (`question.correctOptionIds`), and point value (`question.points`).
* **Grading**: Automatically marked against the designated correct option.

#### 2. Question Type - True / False
* **Definition / Instructions**: Enter the true/false statement, set the point value, and select whether "True" or "False" is the correct answer.
* **Fields**: Statement prompt (`question.text`), binary toggle (`question.correctAnswer`: `true` | `false`), and point value (`question.points`).
* **Grading**: Automatically marked against the selected binary state.

#### 3. Question Type - Short Answer
* **Definition / Instructions**: Input the prompt along with the exact accepted correct answers (one per line) for auto-marking.
* **Fields**: Question prompt (`question.text`), accepted answer variants (`question.acceptedAnswers`), and point value (`question.points`).
* **Grading**: Automatically marked with case-insensitive and whitespace-trimmed string matching.

#### 4. Question Type - Open Question (Teacher Marked)
* **Definition / Instructions**: Enter an essay or open-ended prompt alongside a teacher-only model answer/marking guide for manual evaluation.
* **Fields**: Essay/open prompt (`question.text`), teacher model answer (`question.modelAnswer`), and point value (`question.points`).
* **Grading**: Teacher-marked; model answers and evaluation rubrics remain strictly concealed from students.

---

## 5. ✨ AI Assist: Build Your Complete Course (Under the Syllabus Button)

The **✨ AI Assist: Build Your Complete Course** modal panel window is fully responsive and centered in the middle of the screen across desktop, tablet, and mobile devices (`.builder-modal-overlay` with backdrop blur and `.builder-modal-dialog` with centered margin and fluid max dimensions).

Educators can paste their whole course content directly into the window under the **📝 Syllabus text** tab, and the AI Agent sorts it out into a complete, accredited course distributed across the Course Builder's **3 dropdown boxes**:
1. **Dropdown Box 1: Course Specifications**
2. **Dropdown Box 2: Course Assessments & Rubrics**
3. **Dropdown Box 3: Units of Study**

```mermaid
graph TD
    A[Teacher opens ✨ AI Assist: Responsive Centered Window] --> B[Teacher pastes whole course content into the box]
    B --> C[AI Agent scans & sorts into 3 Dropdown Boxes]
    C --> D1[Box 1: Course Specifications populated]
    C --> D2[Box 2: Course Assessments & Rubrics populated]
    C --> D3[Box 3: Units of Study populated]
    D1 & D2 & D3 --> E[AI instructs Teacher to Review, Edit & Improve the Draft]
    E --> F[Teacher can Save as Draft in every box or at bottom of main window]
```

### 1. Simple Whole-Course Pasting:
- The teacher pastes their entire course content into the large textarea under the Syllabus tab.
- Source material can be any format: a whole syllabus, lecture schedule, topic outline, textbook table of contents, lecture notes, accreditation document, or rough thoughts.
- The AI Agent takes the raw input and intelligently extracts, structures, and categorizes every detail.

### 2. Scanning & Course Sorting Across the 3 Dropdown Boxes:
- The AI scans through the pasted text, extracts key concepts, and systematically sorts it out into the 3 collapsible dropdown boxes:
  - **Dropdown Box 1 (Course Specifications)**: Determines and selects the appropriate Level Taxonomy tier (AQF 0–9), checks matching Curriculum Standards checkboxes (including `international` for global/flexible frameworks), and populates title, code, description, category, term/year, start date, assumed knowledge, level equivalence notes, and cover image.
  - **Dropdown Box 2 (Course Assessments & Rubrics)**: Drafts formative and summative assessment briefs with due dates, calibrated weightings summing to 100%, units covered, external submission links, and complete 4-tier rubric matrices.
  - **Dropdown Box 3 (Units of Study)**: Creates units with unique codes, titles, nominal hours, performance criteria, unit learning outcomes, in-depth instructional content blocks, interactive unit quizzes (multiple choice, true/false, short answer, open-ended), and multimedia blocks.
- **Immediate Cloud Auto-Save**: Upon completing generation, the AI entry immediately triggers an automatic save of the entire draft to the cloud database.
- **Save as Draft Anywhere**: The educator can save as draft at any time in **every dropdown box** (Box 1, Box 2, and Box 3) and at the **bottom of the main window**.

### 3. Continuous Auto-Save After Every Entry:
- Every field edit, keystroke, dropdown selection, and checkbox toggle triggers background auto-save (debounced at 1.2s to prevent database contention while ensuring zero work is ever lost).
- Even AI entry triggers immediate auto-save so that newly generated courses are instantly preserved in the cloud database.

### 4. Editorial Directive (Tell Teacher to Edit and Improve):
- The AI Agent explicitly communicates to the teacher:
  *"✨ Course populated and auto-saved! Please review and edit the fields to improve and personalize your course to match your cohort and institutional needs. Remember, changes auto-save after every entry, and you can also save or publish anytime."*
- Reminds the teacher that the AI-generated content serves as a high-quality academic scaffold that benefits from educator customization.

### 5. Academic English Advisory & Writing Assistant:
- The AI Agent actively offers advice and writes/refines sections in formal **Academic English**:
  - **Scholarly Diction**: Converts colloquial or informal notes into academic vocabulary appropriate for accredited institutions.
  - **Bloom's Taxonomy Verbs**: Calibrates outcome verbs (*evaluate, critique, formulate, analyse*) precisely to the course's AQF level.
  - **Rubric Descriptors**: Formulates rigorous, criteria-based performance descriptors across grading tiers (Novice, Competent, Proficient, Advanced).
  - **Constructive Alignment**: Ensures that learning outcomes, unit content, and assessments seamlessly reinforce each other.

---

## 6. Master Schema Representation (Draft JSON)

```json
{
  "title": "Certificate IV in Cyber Security Operations",
  "code": "ICT40120",
  "aqfLevel": 4,
  "curriculumStandards": ["teqsa"],
  "category": "Information Technology",
  "year": "2026 Semester 1",
  "startDate": "2026-03-02",
  "description": "Comprehensive vocational program preparing students for frontline security operations center roles, threat analysis, vulnerability scanning, and incident response. Learners develop hands-on skills in identifying system anomalies and applying defensive security configurations.",
  "knowledge": "Foundational understanding of computer networking, operating systems including Linux and Windows, and basic command-line proficiency.",
  "aqfEquivalenceNotes": "Directly mapped to Australian Training Package ICT40120 at AQF Level 4.",
  "thumbnail": "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?auto=format&fit=crop&w=1280&q=80",
  "learningOutcomes": [
    "Analyse network vulnerabilities using standardized penetration testing tools.",
    "Implement endpoint security configurations according to organizational policies.",
    "Respond to and report cybersecurity incidents in compliance with Australian privacy legislation."
  ],
  "tag": "lms",
  "status": "draft",
  "isDraft": true,
  "isPublished": false
}
```

---

## 7. Quality Checklist & Guardrails
- **Every Field Optional**: Missing fields receive safe defaults (`""`, `0`, `[]`), never causing errors.
- **Drafts Save Anytime**: Partial courses with any number of fields can be saved immediately.
- **Plain Text Only**: No HTML tags (`<p>`, `<div>`), no Markdown asterisks (`**`, `*`), no markdown tables or symbols inside string values.
- **Academic English**: Professional, scholarly tone, constructive alignment, and clear pedagogical phrasing throughout.

