# OzEdu LMS — Fill-Out Forms Guide (for AI agents)

This guide lists every field a person can fill in on the OzEdu website, grouped by screen. For each field
it gives the exact on-screen label, the input type and rules, what the field means, how to fill it in, and
why it matters. The last sections cover the spreadsheet templates the site accepts as uploads, and screens
that exist in the code but cannot be reached.

**How to read the tables**

- **Field** is the exact visible label (or placeholder text when there is no label). A `#id` or
  `aria-label` after it is a stable selector for browser automation.
- **Input** gives the control type, then the rules: **Required** means the form will not save without it;
  "marked \*" means the screen shows an asterisk but does not enforce it; limits are the hard maximums.
- Defaults are listed where a form opens pre-filled.

---

## 1. Rules for the agent (read first)

1. **Never invent personal or official data.** Identity numbers (USI, SSN, ULN, passport, visa/CoE),
   health-cover policies, phone numbers, addresses and emails must come from the person. If unknown,
   leave the field blank, or choose an option such as "Prefer not to say" / "Do not wish to disclose".
2. **Ask the human before any action that costs money or tokens, cannot be undone, or reaches other
   people:** Stripe checkouts, ✨ AI Assist (charges tokens), Content Exchange imports (1 token), giving
   tokens, approving teachers, changing roles, deleting courses or students, submitting assessments or
   quizzes, sending messages, releasing quiz results, and publishing a course.
3. **Replace pre-filled sample values.** The student enrolment wizard, a new course (learning outcomes)
   and every new assessment (sample rubric) open with example content. Overwrite it or clear it.
4. **Links must start with `https://`.** Google Drive files must be shared as "Anyone with the link can
   view", or students cannot open them. Gemini never invents links; it only uses links you supply.
5. **Dates use `YYYY-MM-DD`** (the date pickers produce this). Spreadsheet uploads also accept
   Australian day-first dates, but `YYYY-MM-DD` is safest.
6. **Use the person's Google sign-in email.** Enrolment, messaging, token grants and the Student Panel
   all match people by the email they sign in with.
7. **Save explicitly.** The Course Builder auto-saves drafts (every 60 s by default), but press
   **📝 Save Draft** before leaving. **← Back** with unsaved changes offers Save Draft & Exit, Discard &
   Exit, or Keep Editing; closing the browser tab also warns.
8. **Some content is never shown to students:** Teacher Guide blocks, quiz correct answers, accepted
   answers and model answers.

---

## 2. Roles, access and navigation

New accounts start as **Supporter**. A Supporter who is added to a course becomes a **Student**
automatically. The Super Admin assigns every other role.

| Role | What they can open |
| --- | --- |
| Supporter / Student | 🎓 Student Panel, Global Search, 📮 Join as Teacher, 💛 Token Fund, 🪙 Tokens (buy), 💬 Messages |
| Teacher | My Courses (Course Builder), Student Registration, Global Search, Token Fund, Tokens, Messages; 🎓 Student Panel when enrolled in a course or when Draft courses are available to preview |
| Admin Staff, CEO, COO, CFO | Same as Teacher (staff). Financial Team: staff screens, but cannot enrol students |
| Super Admin (support@aifoundation.net.au) | Everything above, plus 🛡️ Super Admin Control; tokens shown as **UNL** (unlimited, never charged) |

**Desktop and laptop:** every menu item is a button in the header.

**Android and iPhone (screens 768 px wide or less):**

- Signed out: **Sign in with Google** is at the top right of the header. **Contact** is in the footer,
  next to About David.
- Signed in: the top right shows the **Google button** (the Google "G", your photo or initial, and ▾).
  Tap it to open the menu. The **first item is always the role status**: name, email and role (for
  example "TEACHER"). The items after it depend on the role, and **Logout** is last. Tap outside the
  menu, tap the Google button again, or press Escape to close it.

Phone menu items by role (after the role status):

| Screen | Supporter / Student | Teacher / staff | Super Admin |
| --- | --- | --- | --- |
| Admin panel | 🎓 Student Panel, Global Search, 📮 Join as Teacher, 💛 Token Fund, 🪙 Tokens (+Buy), Logout | My Courses, (🎓 Student Panel when enrolled or previewing drafts), Student Registration (not Financial Team), Global Search, 💛 Token Fund, 🪙 Tokens (+Buy), Logout | Teacher items with 🪙 UNL Tokens, then 🛡️ Super Admin Control, Logout |
| Front page (after tapping the logo) | Contact, 🛡️ Go to Admin, 💛 Token Fund, Logout | same | same |

**Sign in:** press **Sign in with Google** (or **Register with Google** in Contact). It opens Google's
account chooser; there are no OzEdu fields to fill. Contact and About David contain no fields.

---

## 3. Messages (💬 dock at the bottom of every signed-in screen)

Who can message whom: everyone can message the Super Admin. Students can message a teacher only about
one of that teacher's courses. Teachers and staff can message the Super Admin, other teachers, and
students enrolled in their courses. The Super Admin can message anyone.

### 3.1 ✏️ New message

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **To** `#md-to` | Select | The recipient. Lists 🛡️ Super Admin, your teachers or students, and teachers of Global Search courses. Staff also get "✉️ Other registered teacher / email…". | Pick the person. Students must choose a teacher from the list (typed addresses are not allowed for students). | Messages are delivered by email address; the wrong recipient never sees it. |
| **Recipient email** (`aria-label="Recipient email"`) | Email; **Required** when "Other registered teacher / email…" is chosen (staff only) | Address for someone not in the list. | Type the person's Google sign-in email, e.g. `teacher@example.com`. | The message reaches the inbox of the account that signs in with this email. |
| **Course** `#md-course` | Select; appears when messaging a teacher or student | The course the message is about. Filled in automatically. | Keep the suggested course, or pick another shared course. The Super Admin may choose "— No course —". | Student–teacher messages must name the teacher's course; the teacher sees which class it concerns. |
| **Subject (optional)** `#md-subject` | Text, max 150 characters | Short topic line. | e.g. `Question about Assessment 2`. | Helps the recipient find the conversation. |
| **Message** `#md-body` | Textarea, **Required**, max 4,000 characters (counter shown) | The message body. Links become clickable. | Plain, complete sentences; include course and assessment names where relevant. | The only content the recipient reads. |

Press **Send message**. Buttons such as 💬 Contact Teacher to Enrol, 💬 Inquire About Course,
💬 Message teacher, 💬 Message student and 💬 Message the Super Admin open this form already filled in.

### 3.2 Reply (inside a conversation)

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **Write a reply…** (`aria-label="Reply"`) | Textarea, **Required**, max 4,000 characters | Your answer in the open conversation. The last course named in the thread is reused. | Type and press **Send**. | Keeps the whole exchange in one thread. |

### 3.3 🪙 Request tokens (everyone except the Super Admin)

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **Tokens needed (1–999)** `#md-amount` | Whole number 1–999, **Required**, default 50 | Tokens you are asking the Super Admin for. | Enter only what is needed. | The Super Admin's **🎁 Grant** button gives exactly this amount. |
| **Why do you need them? (optional)** `#md-reason` | Textarea, max 1,000 characters | Your reason. | e.g. `To use ✨ AI Assist to build my Certificate IV course`. | Requests with a clear purpose are approved faster. |

Press **Send request**. It arrives as an amber "Token Request" message.

**Super Admin only, inside a conversation:** **🎁 Grant N tokens** (re-checks Stripe first for purchases;
at most 999 per grant) and **➕ Add N tokens to the fund** for donations. Both ask for confirmation.

---

## 4. Tokens and payments

### 4.1 💛 Token Fund (header button)

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **Student's Email Address** (Sponsor a Student) | Email, **Required**, must be a valid address | The student whose year of access you sponsor. | The student's Google sign-in email. Press **Fund Account** to open Stripe. | Identifies who receives the sponsorship. It is a fixed one-year payment (currently A$52, shown on the Stripe page). Confirm with the human first. |

**Donate to Token Fund** opens the purchase form in 4.2 with nothing filled in.

### 4.2 🪙 Tokens (+Buy) — buy or donate tokens

Opened by the 🪙 Tokens button (non–Super Admin) or Donate to Token Fund. Price per token is set by the
Super Admin (default A$1.00).

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **Where should these tokens go?** | Two choice buttons | 🌍 **Accumulated Fund** (a donation for redistribution) or 👤 **My Account Balance** (a purchase for yourself). | Choose the purpose. | Purchases are credited to you after the Super Admin verifies the Stripe payment. Donations go to the Emergency Token Fund. |
| **Select Token Quantity (Minimum 50 tokens)** | Preset buttons: 50, 100, 250, 500 | Quick amounts. | Pick one, or use the custom box. | Sets the total charged. |
| **Or enter custom token amount (no limit, min 50)** | Number, minimum 50 | Any amount. Values under 50 become 50. | Whole number, e.g. `75`. Clears the preset. | The total shown is tokens × price. |
| **Your Name (Optional)** | Text; pre-filled from Google | Name on the Stripe checkout. | Keep, or correct it. | Appears on the receipt. |
| **Receipt Email (Optional)** | Email; pre-filled from Google | Where Stripe sends the receipt. | A real inbox. | Proof of payment, if credit is ever queried. |

**Checkout via Stripe (N Tokens • $X AUD)** leaves the site for Stripe. Card details are entered on
Stripe, never on OzEdu. Always confirm with the human first. On return, the site verifies the payment and
messages the Super Admin automatically.

---

## 5. Global Search (all signed-in users)

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **Search by title, author, or subject...** | Text | Filters published OzEdu courses and the curated catalog. | Keywords, e.g. `marine` or a teacher's name. | Narrows 900+ catalog courses. |
| **All Subjects (N)** | Select | Subject filter. | Choose a subject, or All Subjects. | Shows one discipline at a time. |

Card buttons: staff see **+ Copy to My Courses**, which makes a private Draft copy and records who copied
it and when. Students and Supporters see **🔒 Enrolment by Teacher Only** and **💬 Contact Teacher to Enrol**
or **💬 Inquire About Course**, which open a pre-filled message (section 3.1).

---

## 6. 📮 Join as Teacher (Supporters and Students)

A single postcard form. One application per account; after posting, the screen shows its status.

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **Full Legal Name** | Read-only | Taken from the Google account. | Nothing to type. To change it, change the Google account name. | Shown to the Super Admin as the applicant name. |
| **Primary Teaching Specialty / Subject Area \*** | Text, **Required**, max 200 characters | Your main subject. | e.g. `Applied Machine Learning`. | Tells the Super Admin which courses you can teach. |
| **Proposed First Course Title \*** | Text, **Required**, max 300 characters | The first course you plan to build. | A clear, specific title, e.g. `Practical Deep Learning with Python`. | Shows concrete intent; it is part of the review. |
| **Course Token Cost for Students (🪙 Tokens to Enroll)** `#proposed-token-rate` | Whole number ≥ 0, **Required**, default 10 | Your proposed price for the course. | Enter `0` for a **FREE** course: a green **FREE** badge appears beside the box, and the price is saved as 0 and shown as "FREE" on your postcard, the Super Admin's review card and the message-board copy. Otherwise enter the tokens, e.g. `12` (shown as "🪙 12 Tokens"). | Informs the Super Admin of your pricing intent (course enrolment itself is free in the current site). |
| **Teaching Philosophy & Academic Bio \*** | Textarea, **Required**, max 8,000 characters | Background, credentials and approach. | 1–3 short paragraphs: qualifications, experience, who you want to teach. | The main evidence the Super Admin uses to approve you. |
| **Upload Identification Document** (optional) `#id-file-upload` | Image file (photo or scan) | Gemini checks the ID and returns a confidence score. The photo itself is **not stored**. | A clear, well-lit photo of a passport, driver licence or teacher card. Very large images are refused with a message; retake closer or smaller. | Speeds up verification. Without an AI key or on outage the result is honestly "Not verified — manual review needed". |
| **Link to your original document** `#id-document-url` | URL, optional, must start with `https://`, max 2,000 characters | Link to the original ID file. | Upload to Google Drive, OneDrive or Dropbox, share as "Anyone with the link can view", paste the link. | The Super Admin can see the real document. A link not starting with `https://` blocks posting. |

Press **Post Teacher Application 📮**. It is disabled while the ID check runs. A copy goes to the Super
Admin's message board.

---

## 7. 🎓 Student Panel (students; staff when enrolled)

The panel lists enrolled courses as cards; **Open course** shows the course. Registered students may also
preview Draft courses, but cannot submit work in them.

### 7.1 Course switcher

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **Course:** `#sl-view-course-dropdown` | Select; shown with 2+ courses | Switches the open course. | Pick the course. | Each course has its own tasks and quizzes. |

### 7.2 Assessment submission box (one per assessment)

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **Your answer or submission notes** `#ans-<assessmentId>` | Textarea, max 20,000 characters (counter shown) | The written answer, or notes for the teacher. Kept on this device while typing. | The answer itself, or a summary of what the link contains. | This is what the teacher grades. Either this or a link is required. |
| **Link to your work (optional)** `#link-<assessmentId>` | URL, must start with `https://` | A link to longer work. | A Google Docs/Drive link shared as "Anyone with the link can view". | Use for work over 20,000 characters or for files. |

Buttons: **💾 Save Draft** (saved privately; the teacher does not see it), and **Submit** or **Resubmit**
(the teacher sees it). Submission is locked in Draft courses ("Locked in Draft") and closes once the work is
graded. Submitting reaches the teacher, so confirm with the human first.

### 7.3 Unit quiz (❓ Quiz & Questions blocks)

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| Multiple choice question | Radio buttons, or checkboxes when "Select all that apply" | Pick the correct option(s). | Choose based on the unit content. | Marked automatically. |
| True / False question | Radio: True or False | — | Choose one. | Marked automatically. |
| Short answer (**Your answer**) | Text, max 500 characters | A word or short phrase. | Spelling matters; capitals, extra spaces and a final full stop do not. | Compared with the teacher's accepted answers. |
| Open question (**Write your answer**) | Textarea, max 5,000 characters | A written response. | Full sentences answering every part. | Marked by the teacher. |

**Submit quiz** / **Resubmit quiz** works until the teacher releases results; unanswered questions score
0. After release, the score, per-question marks and feedback are shown.

---

## 8. My Courses and the Course Builder (teachers and staff)

**My Courses** has no fields. Its buttons: **⚡ Upload Sheet (AI)** (new course, opens 📊 Spreadsheet),
**+ Create Course** (blank course), and on each card **👥 Students & People** (section 9), **📥 Submissions**
(section 10), **✏️ Edit Draft** / **Manage** (Course Builder), and **Delete**. Delete moves the course to
the Archive for 28 days; **Restore Course** brings it back.

### 8.1 Builder header

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **⏱️ Auto-save:** `#builder-autosave-select` | Select: Off (Manual), Every 30s, Every 60s (Recommended), Every 2m | How often unsaved edits are saved as a draft. Remembered on this device. | Keep 60s. | Protects work if the browser closes. |

Header buttons: **📝 Save Draft** saves to the cloud as a Draft (registered students can preview it, but
cannot submit). **🚀 Publish** removes the Draft tag and lists the course in Global Search for every teacher
and student; confirm first. Also: **🇦🇺 AQF Guide** (8.7), **🔍 Content Exchange** (8.8), **📊 Spreadsheet**
(8.6), **✨ AI Assist** (8.5), **👥 Add People** (section 9).

### 8.2 📋 Course Specifications

A new course starts as: title `New Course`, code `CRS-100`, Level 0, category `Information Technology`,
year `<this year> Semester 1`, start date today, and two generic sample outcomes. Replace them all.

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **Course Title** `#spec-title` | Text | Full course or qualification name. | e.g. `Diploma of Cyber Security`. | Shown on every card, in Global Search, in messages and to students. |
| **Course Code** `#spec-code` | Text | Your code, or a national qualification code. | e.g. `ICT50220`. Set it **before** adding units. | **+ Add Unit** numbers units from it (`ICT50220-1`, `-2`, …). Searchable in Global Search. |
| **Level Taxonomy** `#spec-level` | Select: 0 International / Unassigned, or AQF Levels 1–9 | The qualification level. The hint under it summarises what that level demands. | 0 for non-AQF or school courses; otherwise the AQF level (4 Cert IV, 5 Diploma, 7 Bachelor, 9 Masters). | Sets the difficulty ✨ AI Assist writes at, and decides which Curriculum Standards apply. |
| **Curriculum Standards (AI Alignment)** | Checkboxes: 🎓 AACSB, 🇦🇺 TEQSA, 🇦🇺 ACARA (F–12), 🇬🇧 UK QAA / FHEQ, 🇬🇧 UK Ofsted (KS3–5) | Accreditation rules ✨ AI Assist follows. | Tick only the frameworks that apply. AACSB and TEQSA apply only at AQF 7–9 (skipped otherwise, with a warning). ACARA, UK QAA and Ofsted are meant for Level 0 but still apply. None ticked = Bloom's Taxonomy. | Makes generated outcomes, tasks and rubrics match the framework. |
| **Course Description** `#spec-description` | Textarea | Who the course is for, what it covers, where it leads. | 2–4 sentences. | First thing students and teachers read about the course. |
| **Category** `#spec-category` | Text | Subject area. | e.g. `Information Technology`. | Shown on course cards and used by Global Search filters. |
| **Year / Semester** `#spec-year` | Text | When the course runs. | e.g. `2026 Semester 1`. | Shown to students. |
| **Start Date** `#spec-start` | Date (`YYYY-MM-DD`) | First day of teaching. | Pick from the calendar. | Shown on cards ("Starts …") and in the Student Panel. |
| **Course Learning Outcomes (one per line)** `#spec-outcomes` | Textarea; each line is one outcome | What a learner can do at the end. | 3–8 lines, each starting with a measurable verb (Analyse…, Apply…, Evaluate…). Delete the two sample lines. | Guides assessments and ✨ AI Assist; shown to students. |
| **Assumed Knowledge / Prerequisites** `#spec-knowledge` | Textarea | What learners should know already. | e.g. `Year 12 English or equivalent workplace experience`. | Helps students judge readiness. |
| **Level Equivalence Notes** `#spec-equivalence` | Textarea | How the course maps to AQF or international frameworks. | e.g. `Equivalent to a UK Level 5 HND`. | Helps international teachers and students compare levels. |
| **Cover Image URL** `#spec-cover` | URL | Link to a cover image. | An `https://` image link. | Stored with the course and exported to the spreadsheet; not shown on cards yet. |

### 8.3 🎯 Course Assessments & Rubrics

One list for the whole course. **+ Formative Task** adds a practice task (title "Formative Task", weight
20%); **+ Summative Task** adds a graded task (title "Summative Task", weight 50%). Each starts with a
sample rubric for its type. Press ▶ / **Expand** on a task to edit its details. The header shows
Σ of all weightings; it should be 100%.

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| Type (`aria-label="Assessment type"`) | Select: FORMATIVE / SUMMATIVE | Practice (feedback) or graded (evidence). | Choose the purpose. An untouched sample rubric switches to the other type's sample; an edited rubric is kept. | Students see the type; it shapes the rubric. |
| **Assessment Title** | Text | Task name. | e.g. `Workplace Sustainability Audit`. | Shown in the Student Panel, Submissions and messages. |
| **Task brief, submission requirements, and evidence portfolio...** | Textarea | What students do and submit. | Steps, length (e.g. 1,500 words), format, and what evidence to include. | Students' instructions; vague briefs produce weak submissions. |
| **Due Date** | Date (`YYYY-MM-DD`) | Deadline. | Pick from the calendar. | Drives the Student Panel's due and overdue list. |
| **Weighting (% of course)** | Number 0–100 (clamped) | Share of the course grade. | Whole numbers; all tasks should total 100. | Tells students how much each task counts. |
| **Covers** (`aria-label="Units covered"`) | Select: Whole course, or one unit | The unit the task assesses. | Pick a unit, or Whole course. | Links the task to unit content for students and in Submissions. |
| **External Submission Link (Google Forms / Canvas / Teams)** | Text (one link) | Optional external place to submit. | An `https://` link. Text that is not a web link is not shown to students. | Use when work must be lodged elsewhere; students still get the OzEdu submission box. |

**📊 Assessment Rubric Matrix** (inside each task). Rows are criteria; columns are performance levels
(default Novice 0–49%, Competent 50–74%, Proficient 75–89%, Advanced 90–100%; uploaded rubrics may use 2–10
levels, e.g. HD/D/C/P/F).

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **Criterion Title** | Text | What is judged. | e.g. `Analysis of current practice`. | Students see exactly how they are marked ("How this is marked"). |
| **% weight** | Number | The criterion's share of this task. | Criterion weights in one rubric should total 100 (Σ is shown green at 100). | Sets how marks combine. |
| Level descriptor (one box per level) | Textarea | What work at that level looks like. | One or two observable sentences per level, from lowest to highest. | Makes marking consistent and transparent. |

Buttons: **+ Add Criterion Row** (copies the rubric's levels), **×** removes a row, **⬆ Upload Rubric**
(spreadsheet, see 13.4; then **Replace rubric** or **➕ Add to current rubric**), **⬇ Rubric (.xlsx)**.
Older text rubrics show **Convert to a rubric matrix**.

### 8.4 📚 Units of Study

**+ Add Unit** creates a unit (code `<Course Code>-<n>`) and opens it. A unit holds its fields, then its
blocks (max 150 blocks per unit). Delete with 🗑️ (confirmation).

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **Unit Code** `#unit-code-<unitId>` | Text; auto-filled | Unique unit code. | Keep the automatic code or enter a national code, e.g. `BSBTEC301`. | Identifies the unit in tasks, quizzes, marking and spreadsheets. |
| **Unit Title** `#unit-title-<unitId>` | Text | Unit name. | e.g. `Design and produce business documents`. | Shown to students as the unit heading. |
| **Nominal Hours** `#unit-hours-<unitId>` | Number ≥ 1 ("hrs") | Guided study hours for the unit. | Whole number, e.g. `40`. | Shows students the expected workload. |
| **Unit Description** `#unit-description-<id>` | Textarea | What the unit is about, who it is for, what learners will do. Shown above Performance Criteria. | 2–4 sentences. Add more with **Add Block → 📝 Unit Description**; × removes one. | Students' introduction to the unit. |
| **Performance Criteria** `#unit-performance-criteria-<unitId>` | Textarea | What a learner must demonstrate to be competent. | Observable statements, e.g. `Explains sustainability principles and applies systems thinking`. | Defines competence for teacher and student. |
| **Unit Learning Outcomes (one per line)** `#unit-outcomes-<unitId>` | Textarea; one outcome per line | What the learner can do after this unit. | 2–5 lines starting with verbs. | Aligns content, quizzes and tasks. |
| **Unit Content** `#unit-content-<unitId>` | Textarea, max 50,000 characters | The lesson paragraphs students read. | Explanations, examples and activities in plain language, with blank lines between paragraphs. | The core teaching text of the unit. |

**Add Block** (each block has its own **Title** box with a type-specific placeholder):

| Block | Field | How to fill it in | Why it matters |
| --- | --- | --- | --- |
| 🧑‍🏫 **Teacher Guide** | Textarea "Classroom timings, discussion scaffolding, common misconceptions..." | Facilitation notes for teachers. | **Never shown to students.** |
| ▶️ **YouTube Video** | Text "Paste YouTube Video URL" | A `youtube.com/watch?v=…`, `youtu.be/…`, `/shorts/`, `/embed/` or `/live/` link. "▶️ YouTube Streaming Embed Active" confirms it was recognised. | Plays inside the Student Panel. |
| 📁 **Google Drive Resource** | Text "Paste Google Drive shared link" | A Docs, Slides, Sheets, file or folder link shared as "Anyone with the link can view". | Students open the resource; private links fail. |
| 📓 **Gemini Notebook** | URL "Paste the Gemini Notebook share link" | An `https://notebooklm.google.com/notebook/…` (or other Google notebook) share link. A warning appears if it does not look like one; "📓 Gemini Notebook link ready" confirms it. | Gives students guided AI study notes. |
| 📎 **Direct File Attachment** | Disabled ("Soon") | Use a Google Drive Resource instead. Older attachment blocks still show a URL box. | — |
| ❓ **Quiz & Questions** | See 8.4.1 | — | Auto-marked unit quiz. |
| 📝 **Unit Description** | Adds another Unit Description box | — | — |

#### 8.4.1 Quiz editor (inside a ❓ Quiz & Questions block)

Up to 100 questions. "🔒 Answers hidden from students": correct answers are stored separately for teachers.
The summary shows the question count, total points and how many are marked automatically.

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| Instructions (`aria-label="Quiz instructions"`) | Textarea, optional | Shown above the questions. | e.g. `Answer all questions. You can resubmit until results are released.` | Sets expectations. |
| Question type (`aria-label="Question N type"`) | Select: Multiple choice, True / False, Short answer, Open question (teacher-marked) | — | Changing the type keeps the question text. | Closed types are marked automatically. |
| Points (`aria-label="Question N points"`) | Number 0–100, step 0.5; default 1 (open questions 5) | Marks for the question. | Weight harder questions higher. | Sets the score. |
| Question (`aria-label="Question N"`) | Textarea, max 2,000 characters | The question students see. | One clear question. | — |
| Option A, B, … (`aria-label="Question N option A"`) | Text, max 500 characters; 2–10 options; **+ Option**, × removes | Answer choices. | Plausible, distinct options. | — |
| Correct option (`aria-label="Option A is correct"`) | Radio (one) or checkbox (several) | The answer key. | **Tick the correct answer**; a warning shows until you do. | Without it the question is not auto-marked. |
| **More than one correct answer** | Checkbox | Allows several correct options. | Tick for "select all that apply". | Students then see checkboxes. |
| Correct answer (True / False) | Radio: True / False | The answer key. | Choose one. | Auto-marking. |
| Accepted answers (`aria-label="Question N accepted answers"`) | Textarea, one per line, max 20, not case-sensitive | Answers counted as correct. | Every acceptable spelling or variant, e.g. `Canberra` and `canberra city`. Blank = teacher marks it. | Auto-marking; the teacher can still override. |
| Model answer (`aria-label="Question N model answer"`) | Textarea, max 5,000 characters, teachers only | What a good answer includes. | Key points and a marking guide. | Shown to the teacher during bulk marking. |

### 8.5 ✨ AI Assist (Gemini) — builds a complete course

The cost badge shows the fee (default 10 tokens, set by the Super Admin; free for Charity Teachers and the
Super Admin). Confirm with the human before generating.

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **📝 Syllabus text / 📊 Spreadsheets** | Tabs | Source to build from. | Syllabus text for notes or outlines; Spreadsheets for a completed course spreadsheet (8.6 panel). | — |
| **Target Level** `#ai-target-level` | Select: Level 0–9 | Level the AI writes at (Spreadsheets: used when the spreadsheet sets none). | Match the course's Level Taxonomy. | Sets depth and difficulty. |
| **Syllabus / Course Outline** | Textarea; at least 15 characters; the first 15,000 are used | Raw outline, lecture schedule, topic list or objectives. | Paste the real syllabus, including any links students should get. | The AI only uses links found here. |

**Generate Course (N Tokens)** replaces the course's content (details, units, blocks, assessments, rubrics)
with the result; the course ID, owner and Curriculum Standards are kept. **The syllabus fee is charged when
you press Generate**; if Gemini is unavailable, a basic template course is built from your text instead.
On the Spreadsheets tab, the fee is charged only after Gemini returns content. Review the result, then
**📝 Save Draft**.

### 8.6 📊 Course Spreadsheet window

1. **Get the spreadsheet:** ⬇ Blank template (.xlsx), ⬇ Worked example, ⬇ This course (export).
2. **Upload your completed spreadsheet(s)** (file field, or drag and drop): `.xlsx`, `.xlsm`, `.xls`,
   `.ods`, `.csv`, `.tsv` or `.txt`; at most 10 files, 10 MB each. Several CSV tabs may be uploaded
   together. Column reference: section 13.1.
3. **Check and build:** review the counts and any ⚠️ notes, then press **📥 Import into Course Builder
   (free)** or **✨ Build out with Gemini AI (N tokens)**. Import replaces this course's units with the
   spreadsheet's and fills the details provided (blank details keep their current values). Gemini keeps every
   value you typed, fills the blanks, and never invents links. Very large courses (over ~900 KB) get a
   warning that saving may fail; split them into two courses.

### 8.7 🇦🇺 AQF Guide

No fields. Each level card has **Select**, which sets Level Taxonomy.

### 8.8 🔍 Content Exchange (import units from published courses)

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **Search by topic, unit code, or keyword...** | Text (Enter searches) | Searches published courses. | Topic words or a unit code. | Finds reusable units. |
| **All Levels** | Select: All Levels or a level | Level filter. | Match your course's level. | Keeps imports at the right difficulty. |
| **Reason for free request** (only when tokens are insufficient) | Textarea, optional | Message to the unit's author asking for free access. | Your school and students' situation, e.g. `Teaching at an under-resourced school in regional Australia`. If blank, a standard reason is sent. | Authors decide free requests based on this. |

**Import (1 Token)** copies a unit (with fresh IDs and its quiz answers) into this course; it is 0 tokens
for Charity Teachers and the Super Admin. Confirm with the human first.

---

## 9. 👥 Add People / Students & People (teachers, admin staff, CEO, COO, CFO, Super Admin)

Opened from a course card (**👥 Students & People**) or the builder (**👥 Add People**). Enrolment is free.
Each newly enrolled person with an email gets a welcome message. The course appears in a student's
🎓 Student Panel when they sign in with that email.

### 9.1 ➕ Add Person by Name/Email

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **Full Name** | Text | The person's name. | As it should appear on the roster. | Shown to the teacher. |
| **Email Address** | Email; must be valid when given | Their Google sign-in email. | Required in practice: without it the person cannot see the course. | Enrolment is matched by email. A name or an email is required. |
| **Role in Course** | Select: 🎓 Student (Enrolled Learner), 👨‍🏫 Teacher (Co-Instructor / Facilitator), 👁️ Guest / Observer (Audit Access) | Their role in this course. | Usually Student. | Teachers can co-facilitate; guests only observe. |

Press **✓ Enrol to Course (0 Tokens)**.

### 9.2 📋 Bulk / Spreadsheet

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **Paste student emails** `#bulk-emails` | Textarea | Many people at once. | One per line or comma-separated; names optional, e.g. `Jane Doe <jane@school.edu>` or `mia@example.com, Mia Chen`. Invalid entries are listed and skipped. | Enrols a class in one step. |
| **⬆ Upload spreadsheet (.xlsx / .csv)** | File(s) | A roster file (13.3). | Needs an Email column; Name, or First/Last name, optional. **⬇ Roster template** gives the layout. | Merged with the pasted list; duplicates removed. |
| **Role in course** `#bulk-role` | Select: Students, Co-teachers, Guests / Observers | Role for everyone in this batch. | Usually Students. | — |

The summary shows how many will be enrolled, how many are already enrolled and how many are invalid.
**✓ Enrol N (0 Tokens)** accepts at most 2,000 people at a time.

### 9.3 Pick Registered Students and Enrolled Roster

- **Search registered students by name or email...** (text) filters Student Registration records;
  **+ Add (0 🪙)** enrols one.
- **👥 Enrolled Roster** has no fields; **Remove** takes a person off the course (confirmation).

---

## 10. 📥 Submissions (teachers)

### 10.1 📥 Assessments tab (one card per submission)

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **Grade** (`aria-label="Grade"`) | Text, **Required**, max 60 characters | The result. | Any scale, e.g. `85%`, `Competent`, `HD`. | Students see it immediately; graded work can no longer be resubmitted. |
| **Feedback for the student (optional)** (`aria-label="Feedback"`) | Textarea, max 5,000 characters | Comments. | What was done well, and what to improve. | Shown with the grade. |

Press **Save grade**. **💬 Message student** opens a pre-filled message. Drafts are labelled
"✏️ Draft (not submitted)".

### 10.2 ❓ Unit quizzes tab (bulk marking)

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **Quiz** `#qm-quiz` | Select | The unit quiz to mark. | Pick one; the submitted count is shown. | — |
| Score per answer (`aria-label="Score for <student>, question N"`) | Number 0–question points, step 0.5 | Mark for open (and short) answers. Short answers are pre-marked from accepted answers. | Use the model answer. **Full marks to all answered** or **Clear scores** act on a whole question. | An attempt is "Ready" only when every answer has a mark. |
| **Note to the student** (`aria-label="Feedback for <student>"`) | Text, max 5,000 characters | Optional feedback per student. | Short and specific. | Released with the score. |

**✅ Release results to all ready (N)** sends scores to students; confirm first. **⬇ Export results (.xlsx)**
downloads the marks.

---

## 11. Student Registration — Academic Registry (teachers, admin staff, CEO, COO, CFO, Super Admin)

### 11.1 Roster filters

| Field | Input | Description |
| --- | --- | --- |
| **Search by student name, email, student ID, USI or degree...** | Text | Filters the roster. |
| **All Residencies** | Select: All Residencies, Domestic Citizens & PR, International (Visa 500) | Residency filter. |
| **All Degree Programs** | Select: All, or a degree in use | Program filter. |

Row buttons: **👁️ Dossier** (read-only, with **🖨️ Print / Save Dossier PDF**), **✏️** (edit), **🗑️** (delete,
confirmation).

### 11.2 + Enrol Student — 7-step wizard

**The wizard opens pre-filled with sample values** (for example date of birth `2005-04-12`, Gender Female,
IELTS Academic `7.5 Overall`, degree `Bachelor of Computer Science`, campus `Sydney Central Campus`, and every
declaration ticked). Replace every value with the student's real information or clear it. Only **Legal First
Name** and **Legal Family / Surname** are enforced on save; Personal Email and Date of Birth are checked for
format when filled. Fields marked \* should still be completed. Steps can be visited in any order; **✓
Complete & Save Enrolment** is on step 7. Sensitive fields (proof of identity, visa/CoE, national ID, health
cover, accessibility, Indigenous status, guardian details) are stored in a restricted record.

**Step 1 — Identity & Personal**

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **Legal First Name \*** | Text, **Required** | Given name as on official ID. | Exactly as on the passport or licence. | Official records and certificates. |
| **Legal Middle Name(s)** | Text | Middle names. | Leave blank if none. | Matches identity documents. |
| **Legal Family / Surname \*** | Text, **Required** | Family name as on ID. | Exactly as on ID. | Official records. |
| **Preferred Name (for class rosters & campus display)** | Text | Name used day to day. | e.g. `Chloe Campbell`. | Used on rosters and in course enrolment. |
| **Gender / Sex** | Select: Female (default), Male, Non-binary, Different identity, Prefer not to say | Self-identified gender. | Use what the student states; otherwise Prefer not to say. | Statutory reporting. |
| **Date of Birth (ISO 8601 YYYY-MM-DD)** | Date; must be `YYYY-MM-DD` | Birth date (a localised preview shows below). | From ID; change the sample default. | Age checks, including under-18 welfare. |
| **Residency & Citizenship Status \*** | Select: Australian / Domestic Citizen (default), Australian Permanent Resident, International Student (Visa 500), Humanitarian / Refugee Visa | Residency category. | From the student's visa or citizenship evidence. | Drives fees, reporting and the domestic/international counts. |
| **Proof of Identity Document** | Select: Driver's Licence (default), Australian Passport, International Passport, National Identity Card | Document type sighted. | The document actually checked. | Identity verification record. |
| **ID / Passport Document Number** | Text | Number on that document. | Copy exactly; never guess. | Verification. |
| **Confirmation of Enrolment (CoE) / Visa** | Text | International students' CoE or visa subclass. | e.g. `COE-991204 / Visa Subclass 500`; blank for domestic students. | Required reporting for student-visa holders. |

**Step 2 — Contact & Emergency**

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **Primary Mobile Phone \*** | Phone | Main contact number. | International format, e.g. `+61 412 345 678`. | Urgent contact. |
| **Personal Email Address \*** | Email; format checked | Student's email. | **Use the student's Google sign-in email.** | Courses ticked in step 5 are linked to this email, so it must match their sign-in. |
| **Permanent Home Address (Legal Residence)** | Textarea | Legal home address (overseas for international students). | Full postal address. | Official correspondence and residency evidence. |
| **Current / Term Residential Address (Local while studying)** | Textarea | Where the student lives during study. | Full address, or the residence name. | Welfare and local contact. |
| **Full Contact Name** (Next of Kin / Emergency Contact) | Text | Emergency contact person. | Full name. | Who to call in an emergency. |
| **Relationship** | Text | Their relationship to the student. | e.g. `Parent / Guardian`. | — |
| **Emergency Phone** | Phone | Emergency contact's number. | International format. | — |
| **Location / Country** | Text | Where the contact lives. | e.g. `Sydney, Australia`. | Time zones and response planning. |

**Step 3 — Academic History**

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **Prior Education Credentials & Qualifications** | Text | Highest prior study. | e.g. `NSW HSC (ATAR 92.40)` or `Bachelor of Science, Melbourne Uni`. | Admission eligibility. |
| **Credit Transfer / Recognition of Prior Learning (RPL)** | Text | Credit granted for prior study. | e.g. `12 Credit Points for Intro to Computing`, or `None requested`. | Avoids repeating completed study. |
| **Language Proficiency Evidence** | Select: Native English / Prior Medium of Instruction, IELTS Academic (default), TOEFL iBT, PTE Academic, Cambridge Advanced (CAE) | Type of English evidence. | The evidence actually provided. | Admission and visa compliance. |
| **Language Test Score / Verification** | Text | Score or exemption. | e.g. `7.5 Overall (min 7.0 in all bands)` or `Native`. | Proves the English requirement is met. |
| **Prerequisite Compliance Notes** | Text | How course prerequisites are met. | e.g. `Maths Advanced Band 5 met`. | Records eligibility. |

**Step 4 — Regulatory & Identifiers**

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **Jurisdiction** | Select: Australia (USI) (default), United States (SSN / ITIN), United Kingdom (ULN), Other / International | Which national identifier applies. | The student's study jurisdiction. | Changes the next field's label. |
| **Australian Unique Student Identifier (USI) \*** / **National Student Identifier \*** | Text | Government student identifier. | Australia: the 10-character USI. Never invent one. | Mandatory government reporting. |
| **Indigenous / First Nations Status** | Select: Neither Aboriginal nor Torres Strait Islander (default), Aboriginal, Torres Strait Islander, Both Aboriginal and Torres Strait Islander, Not Applicable (International) | Self-identified status. | Only what the student states. | Statutory reporting and support programs. |
| **Language Spoken at Home** | Text | Main home language. | e.g. `Vietnamese`. | Equity reporting and support. |
| **Country of Birth** | Text | Birth country. | e.g. `India`. | Statutory reporting. |
| **Parents' Highest Level of Education** | Select: Postgraduate Degree, Bachelor Degree (default), Vocational / Diploma (TAFE / College), Year 12 or equivalent, Below Year 12, Do not wish to disclose | Equity indicator. | What the student states; otherwise Do not wish to disclose. | First-in-family reporting. |

**Step 5 — Program & Study Load**

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **Degree / Award Title \*** | Text | The award being studied. | e.g. `Master of Data Science`. | Roster grouping and the program filter. |
| **Major / Minor Specialisation** | Text | Specialisation. | e.g. `Artificial Intelligence & Software Systems`. | — |
| **Study Mode** | Select: On-campus (default), Online / Distance, Hybrid / Blended | How they study. | — | Delivery planning and reporting. |
| **Campus Location** | Text | Campus. | e.g. `Melbourne Docklands`. | — |
| **Attendance Load** | Select: Full-time (default), Part-time | Study load. | — | Visa compliance (international students are usually full-time). |
| **LMS Unit / Course Enrolments** | Checkboxes, one per course you manage ("🎓 Teacher Privilege: 0 Tokens Required") | OzEdu courses to enrol the student in. | Tick the courses. On save, the student is added to each newly ticked course roster by their Personal Email. | The course then appears in the student's 🎓 Student Panel. |

**Step 6 — Billing & Financial**

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **Tuition Payment Method \*** | Select: Government Loan (HECS-HELP / FEE-HELP) (default), Upfront Direct Payment, Institutional Instalment Plan, Employer / Embassy Sponsored, Scholarship | How fees are paid. | The agreed method. | Fee liability and reporting. |
| **Government Loan / Subsidy Selection** | Text | Loan or subsidy details. | e.g. `Commonwealth Supported Place (CSP) with HECS-HELP eCAF`, or `Not Applicable`. | — |
| **Formal Sponsorship / Financial Guarantee** | Text | Sponsor details. | e.g. `Employer Direct Billing`, or `N/A`. | Who is billed. |
| **Health Cover Provider (OSHC for International, Medicare for Domestic)** | Text | Health insurer. | e.g. `Medibank OSHC`, or `Medicare Domestic`. | OSHC is a visa condition for international students. |
| **Health Cover Policy / Membership Number** | Text | Policy or Medicare number. | Copy exactly; never guess. | Verification of cover. |

**Step 7 — Equity & Declarations**

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **Student requests Disability & Accessibility Support Services** | Checkbox; reveals a details box | Whether adjustments are needed. | Tick only if the student asked. | Triggers support planning. |
| Adjustment details ("Describe required adjustments…") | Textarea (when ticked) | The adjustments needed. | e.g. `15 mins extra per hour for written examinations`. | Staff can apply them. |
| **Under-18 Minor Welfare Arrangement Required** | Checkbox; reveals a details box | Student is under 18. | Tick when the date of birth shows under 18. | Legal welfare obligations. |
| Guardian details ("Guardian Name, Approved Homestay Registration Number & Contact...") | Text (when ticked) | Guardian or homestay information. | Name, registration number and contact. | Who is responsible for the minor. |
| **Student agrees to comply with the University Student Code of Conduct…** | Checkbox (ticked by default) | Conduct declaration. | Leave ticked only if the student has agreed. | Formal consent record. |
| **Student consents to the Privacy and Data Disclosure Policy…** | Checkbox (ticked by default) | Consent to statutory reporting (HEIMS / TCSI / PRISMS). | Only with the student's consent. | Legal basis for reporting. |
| **Student pledges commitment to Academic Integrity…** | Checkbox (ticked by default) | Integrity pledge. | Only if pledged. | — |
| **Student acknowledges official Census Dates, Tuition Fee Liability…** | Checkbox (ticked by default) | Fee liability acknowledgement. | Only if acknowledged. | Protects both parties on fees. |

### 11.3 ⚡ Bulk Upload (Sheet / CSV)

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **Paste comma or tab-delimited sheet data here (including header row)...** | Textarea | Many student records at once. | Paste rows with the template's header row (13.2). **📥 Download Official CSV Template** gives the headers; **📋 Load Sample Data** fills demo rows. | Fast registration of a whole intake. |

Press **🔍 Parse & Validate Students**, check the preview, then **✓ Enrol All N Students**. **Warning:**
blank or missing columns are filled with placeholder values (for example a random `USI-…` number, a random
`POL-…` policy number, `Residential Address Recorded`, or date of birth `2005-01-01`). Provide every column, or
correct each record afterwards with ✏️.

---

## 12. 🛡️ Super Admin Control (Super Admin only)

### 12.1 🎁 Give Tokens

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| Registered email (`aria-label="Registered email"`) | Email, **Required** | The account to credit. | The person's Google sign-in email (must be registered). | Tokens go to the account with this email. |
| Tokens to give (`aria-label="Tokens to give"`) | Whole number 1–999, **Required**, default 50 | Amount. | Split larger amounts into several grants. | Credited immediately, after confirmation. |
| **Note to the recipient (optional)** (`aria-label="Note"`) | Text, max 300 characters | Included in their "Token Grant" message. | e.g. `For your Certificate IV course build`. | Explains the grant. |

Press **🎁 Give N tokens**. **Fill form** on a listed token request copies its email and amount.

### 12.2 🪙 Token Economy & Price

| Field | Input | Description | How to fill it in | Why it matters |
| --- | --- | --- | --- | --- |
| **$ … AUD per token** | Number ≥ 0.01, step 0.01, **Required** | Value of one token in all Stripe checkouts. | e.g. `1.00`. | Changes every price on the site. Confirm first. |
| **tokens per ✨ AI Assist** (`aria-label="AI Assist fee in tokens"`) | Whole number 0–10, **Required** | Fee per ✨ AI Assist course build. | 0 makes AI Assist free for everyone. | Controls AI costs and access. |

Buttons: **Update Token Value**, **Update Field AI Rate**.

### 12.3 Other tabs (no typed fields)

- **🔄 Fund Redistribution:** one button tops up accounts below 26 tokens that signed in within 90 days
  (confirmation).
- **📮 Teacher Postcards:** review each application and press **Approve as Teacher ✅** (sets the role).
- **👥 Member Roles:** per member, a **role select** (supporter, student, teacher, admin staff, ceo, coo, cfo,
  financial team, superadmin; changes immediately), a **Charity Pass** toggle (0-token AI Assist and imports),
  and **🎁 Give** (fills 12.1). Confirm role changes with the human.

---

## 13. Upload templates (filled in outside the site)

### 13.1 OzEdu Course Spreadsheet v4 (Course Builder → 📊 Spreadsheet or ✨ AI Assist → Spreadsheets)

Every tab is optional. On Content Blocks, Quiz Questions and Rubrics, a blank Unit Code, Quiz Title or
Assessment # repeats the value from the row above. Several links can go in one cell, one per line
(Alt+Enter in Excel, Ctrl+Enter in Google Sheets), optionally as `Title | https://…`.

**Course tab** (Field | Value | Help layout):

| Field | How to fill it in |
| --- | --- |
| Course Title | Full course or qualification name, e.g. `Diploma of Sustainable Business Practice`. |
| Course Code | Course or national qualification code, e.g. `OZ-SBP5`. |
| Level Taxonomy (AQF 0-9) | 0 = International / Non-AQF; 1–9 AQF (4 Cert IV, 5 Diploma, 7 Bachelor, 9 Masters). Words such as "Diploma" also work. |
| Category | Subject area, e.g. `Business & Sustainability`. |
| Year / Semester | e.g. `2026 Semester 1`. |
| Start Date | `YYYY-MM-DD`. |
| Course Description | Who it is for, what it covers, where it leads. |
| Assumed Knowledge / Prerequisites | What learners should already know. |
| Curriculum Standards | Comma-separated: AACSB, TEQSA, ACARA (F–12), UK QAA / FHEQ, UK Ofsted (KS3–5), or `None`. |
| Level Equivalence Notes | Mapping to AQF or international frameworks. |
| Cover Image URL | `https://` image link. |

**Learning Outcomes tab:** Outcome # (optional order) | Learning Outcome (one measurable outcome per row,
starting with a verb).

**Units tab:** Unit # (optional) | Unit Code (unique; other tabs link to it) | Unit Title | Nominal Hours
(whole number) | Performance Criteria | Unit Learning Outcomes (one per line) | Unit Content (the lesson
paragraphs) | YouTube Video Links | Google Drive Resource Links | Gemini Notebook Links. Link columns become
blocks after the unit's Content Blocks rows (videos, then Drive, then notebooks). A row with only links adds
them to the unit above.

**Content Blocks tab:** Unit Code | Block # (optional order) | Block Type (Unit Description, Teacher Guide
(hidden from students), YouTube Video, Google Drive Resource, Gemini Notebook, Quiz & Questions) | Block
Title | Text (for Unit Description and Teacher Guide; for a Quiz & Questions row, the quiz instructions) |
Link URL (`https://`, for link blocks) | File Name (optional display name).

**Quiz Questions tab:** Unit Code | Quiz Title (the quiz block's title; a new title adds a quiz at the end
of the unit) | Question # | Question Type (Multiple choice, True / False, Short answer, Open question) |
Question | Options (multiple choice only, one per line: `A. People`) | Correct Answer (letters such as
`D` or `A, C`; `True`/`False`; or accepted answers one per line — never shown to students) | Points (default 1;
open questions 5) | Model Answer / Marking Guide (open questions; teachers only).

**Assessments tab:** Assessment # (1, 2, 3 …; the Rubrics tab uses it) | Assessment Title | Type
(Formative or Summative) | Weighting % (all tasks should total 100) | Due Date (`YYYY-MM-DD`) | Task
Description / Brief | External Submission Link (optional `https://`) | Covers Unit (optional Unit Code;
blank = whole course).

**Rubrics tab:** Assessment # | Criterion (one per row) | Weight % (each rubric should total 100) | one
column per performance level (rename the headings, or use 2–10 level columns). To give one rubric its own
level names, repeat the header row directly above it.

### 13.2 Student enrolment CSV (Student Registration → ⚡ Bulk Upload)

Header row (exact names): `Legal First Name, Legal Middle Name, Legal Family Name, Preferred Name, Date of
Birth (YYYY-MM-DD), Gender, Residency Status, Passport or ID Number, Visa Subclass or CoE, Primary Phone,
Personal Email, Permanent Address, Next of Kin Name, Emergency Phone, Prior Education, English Proficiency,
National Student ID (USI/SSN/ULN), Country of Birth, Degree Title, Major Specialisation, Campus Location,
Study Mode, Tuition Payment Method, Health Insurance (OSHC/Medicare)`.

Use one row per student. Quote any value that contains a comma. Use the wizard's option wording for
Residency Status, Study Mode and Tuition Payment Method. Fill every column (blanks become placeholder
values; see 11.3).

### 13.3 Course roster (Add People → 📋 Bulk / Spreadsheet → ⬇ Roster template)

Columns: **Name** | **Email** (the student's Google sign-in email). The reader also recognises "Email
Address", "Student Email", First/Last Name columns, and, without headers, any cell that looks like an email.

### 13.4 Rubric spreadsheet (assessment → ⬆ Upload Rubric / ⬇ Rubric (.xlsx))

Columns: **Criterion** | **Weight %** | one column per performance level (2–10), each cell describing that
level for the criterion. Any number of criterion rows. Weights should total 100.

---

## 14. Screens in the code that cannot be reached

These contain fields, but nothing in the current interface opens them. Do not look for them.

- **Legacy course builder** (old Course Info / Assessments / Modules form). Replaced by the Course Builder.
- **Import Course from Google Sheet** (AI import modal with a Gemini API key box). Use 📊 Spreadsheet or
  ✨ AI Assist instead.
- **Media Library** (image upload to ImgBB).
- **Superadmin Member Role Management** window. Use 🛡️ Super Admin Control → 👥 Member Roles.
- **Incoming free-content requests** window for authors.

---

## 15. Common messages and what to do

| Message | Meaning | What to do |
| --- | --- | --- |
| "Links must start with https://" / "Use a web address that starts with https://" | A link field holds a non-web address. | Paste the full `https://` share link. |
| "Write an answer or add a link before submitting." | Submission box is empty. | Fill the answer or the link. |
| "Choose a teacher from the list…" | A student tried to message someone not listed. | Pick a listed teacher, or message the Super Admin. |
| "Request between 1 and 999 tokens." / "Give between 1 and 999 tokens at a time" | Amount out of range. | Use a whole number from 1 to 999; split larger amounts. |
| "⚠️ Insufficient tokens (X/Y …)" | Not enough tokens for ✨ AI Assist or an import. | Request tokens (3.3), buy tokens (4.2), import without AI (free), or send a free request to the author. |
| "The course was NOT saved to the cloud…" | Save failed (offline or permissions). | Edits are still on screen; check the connection and press 📝 Save Draft again. |
| "Saved on this device only — the database could not be reached." | Enrolment saved locally only. | Retry when online. |
| "Legal first name is required." / "Personal email looks invalid." | Student wizard validation. | Fix the field on step 1 or 2 and save again. |
| "Assessments cannot be submitted while the course is in draft mode." | The teacher has not published the course. | Save a draft instead; submit after publishing. |
