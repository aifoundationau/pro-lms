# Data Contracts & System Integrity Specification: Architectural Guide & Template

> **Purpose**: A **Data Contracts & System Integrity Specification** establishes explicit operational boundaries, data schemas, security invariants, and regulatory policies for a website before engineering begins. It ensures that system administrators, development teams, third-party integrations, and automated AI assistants process information securely, reliably, and lawfully.

---

# PART I: DESIGN INSTRUCTIONS & ARCHITECTURAL PROTOCOL

To establish a system specification for any new web application or digital platform, execute the following four steps in sequence.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       SYSTEM INTEGRITY LIFECYCLE                            │
│                                                                             │
│   [ Step 1: Legal Invariants ] ──────► [ Step 2: Domain Modeling ]          │
│   • Partition Key Rules               • Identity & Access                   │
│   • PCI DSS Out-of-Scope              • Courses & Units of Study            │
│   • Statutory Retention Rules         • Assessments & Rubrics               │
│                                       • Billing & Token Fund                │
│                                       • Comms & Messaging                   │
│                                       • AI / Autonomous Ops                 │
│                                                   │                         │
│                                                   ▼                         │
│   [ Step 4: Verification Checklists ] ◄── [ Step 3: Field Contracts ]       │
│   • Pre-Deployment Verification       • Data Classifications                │
│   • Autonomous Agent Guardrails       • Types, Regex & Range Limits         │
│   • Periodic Compliance Audits        • Encryption & Storage Rules          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 1: Establish System Boundaries & Legal Invariants

Define the non-negotiable operational boundaries and statutory requirements that cannot be bypassed or compromised under any technical or operational circumstance.

### 1.1 Data Partitioning & Isolation
- When multiple business units, client organizations, schools, or brands share a database or cloud bucket (multi-tenancy), define a **mandatory partition key** (e.g., `tenantId`, `orgId`, `tag: 'lms'`, `businessId`).
- Every insert, update, query, and AI retrieval must strictly enforce this key to prevent data leakage across organizational boundaries.

### 1.2 Payment Handling Boundaries (PCI DSS Scope Minimization)
- Under no circumstances may raw cardholder data (Primary Account Number [PAN], CVV/CVC, or expiration date) enter or traverse your servers, logs, or databases.
- Require tokenized payment flows (e.g., Stripe Elements, PayPal Smart Buttons, Apple Pay) operating under **PCI DSS SAQ A** compliance.
- System records may only store payment tokens (`pi_*`, `cs_*`, `ch_*`), provider references, timestamps, and currency amounts.

### 1.3 Statutory Retention & Scheduled Disposal
- Identify legal recordkeeping minimums according to governing corporate law (e.g., 7-year statutory retention for financial transactions and tax records under the Australian Corporations Act 2001 s 286 / IRS / HMRC).
- Distinguish financial audit requirements from general contact inquiries, marketing leads, and chat histories.
- Mandate automated scrubbing or irreversible pseudonymization for non-critical Personal Identifiable Information (PII) once the retention window expires.

---

## Step 2: Categorize Core Operating Domains

Group the application's functionality into discrete, decoupled operating domains:

1. **Identity & Accounts**: Who accesses the system, their assigned roles (`guest`, `student`, `supporter`, `teacher`, `admin`, `superadmin`), authentication credentials, and session tokens.
2. **Curriculum & Units of Study**: Educational architecture, course specifications, sequential unit codes, educator-authored titles, nominal hours, performance criteria, unit learning outcomes, and unit content paragraphs.
3. **Modular Lesson Stacks & Blocks**: Typed lesson block items (Unit Description, Teacher Guide, YouTube Video, Google Drive Resource, Direct File Attachment, Gemini Notebook, Quiz & Questions).
4. **Assessments & Rubric Matrices**: Course-level formative/summative tasks, criterion title definitions, weight percentages summing strictly to 100%, and multi-level qualitative rubrics.
5. **Financial Contributions & Token Fund**: Billing logs, receipts, token balances, Stripe server-verified checkouts, currency settings, and transaction states.
6. **Inquiries & Communication**: Lead capture, contact form submissions, message docks, and category-tagged communications.
7. **Automated & AI Operations**: Constraints on input values, categories, model fallback chains, token fee deductions, and parameter boundaries handled by autonomous tools or bots.

---

## Step 3: Define Field-Level Data Standards

For every domain, define the exact structure of incoming data:

- **Classification**:
  - `Public`: Freely viewable on client surfaces.
  - `Internal Audit`: Restricted to operational staff and system logging.
  - `Personal Information (PII)`: Subject to privacy legislation (e.g., Australian Privacy Principles, GDPR, CCPA).
  - `Financial`: Billing data, whole currency values, and payment statuses.
  - `System Credential`: Authentication tokens, cryptographic keys, and secrets (never exposed to clients or logged).
- **Format & Constraints**:
  - Exact data types (String, Integer, Boolean, ISO 8601 Timestamp, URI).
  - Minimum/maximum lengths, strict regex pattern validation, and permitted enumeration values.
  - Currency values stored as whole numbers in smallest currency units (e.g., cents) or whole dollars, rejecting arbitrary decimal floating-point numbers.
- **Lifecycle & Security**:
  - Transit encryption (TLS 1.3 mandatory).
  - At-rest encryption (AES-256).
  - Ephemeral buffers vs. permanent 7-year audit retention.

---

## Step 4: Institute Audit & Verification Checklists

Create recurring checklists to guarantee continuous compliance across all operations, audits, and automated systems:
- Pre-flight deployment and database rule validation.
- Autonomous AI agent tool-call and parameter guardrails.
- Periodic data retention scrubbing and partition audits.

---

# PART II: SYSTEM INTEGRITY SPECIFICATION: PRO-LMS PLATFORM

**Platform Name**: Pro-LMS / AQF Course Builder  
**Specification Version**: `1.2.0-STABLE`  
**Classification**: Single Source of Truth (SSOT)  
**Effective Date**: October 2026  
**Auditor**: Lead System Integrity Engineer  
**Mandatory Retention Period**: **7 Years** *(Corporations Act 2001 s 286 / Statutory Tax Compliance / APP 11)*

---

## 1. System Invariants & Non-Negotiable Boundaries

### 1.1 Multi-Tenant Data Partitioning Invariant
- **Rule**: Every record stored in Firestore collections (`courses`, `users`, `messages`, `submissions`, `transactions`) **MUST** include the immutable partition key:
  ```json
  {
    "tag": "lms"
  }
  ```
- **Query Restriction**: Queries executed across shared collections must include an explicit equality predicate (`where("tag", "==", "lms")`) to prevent cross-tenant exposure.

### 1.2 Zero-Cardholder Payment Boundary (PCI DSS SAQ A)
- **Rule**: Under no circumstances may raw card numbers, CVVs, or card expiries touch application servers or datastores.
- **Execution**: All payments are handled via Stripe Elements or vendor-hosted iframes. The system only stores provider transaction tokens (`pi_*`, `cs_*`), amounts, and statuses.

### 1.3 Uniform 7-Year Lifecycle & Retention Governance
- **Statutory Audit Invariant**: All financial transactions, token grants, student assessments, and formal grade submissions are retained immutably for **7 years** (2,557 days) pursuant to Corporations Act 2001 (s 286).
- **Scrubbing Routine**: Inactive non-financial inquiries and draft messages are scrubbed after **24 months**.

---

## 2. Operating Domain Specifications

```
                     ┌────────────────────────────────┐
                     │    PRO-LMS OPERATING DOMAINS   │
                     └───────────────┬────────────────┘
                                     │
         ┌──────────────┬────────────┼─────────────┬─────────────┐
         ▼              ▼            ▼             ▼             ▼
    [ Domain 1 ]   [ Domain 2 ]  [ Domain 3 ]  [ Domain 4 ]  [ Domain 5 ]
      Identity       Course        Units of      Course        Token Fund
     & Accounts      Specs          Study      Assessments     & Billing
```

---

### Domain 1: Identity & Accounts (`users/{uid}`)

Governs student, teacher, supporter, and administrator authentication, roles, and token allocations.

| Field Name | Type | Ingestion Method | Classification | Invariants & Constraints | Storage & Security |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `uid` | String | Firebase Auth | Internal Audit | Unique alphanumeric identifier. | Document ID. Indexed. |
| `tag` | String Enum | System Injected | Partition Key | **Constant**: `'lms'`. Mandatory on all reads/writes. | Root field. Indexed. |
| `email` | String | User Input / OAuth | PII | RFC 5322 standard. Lowercased, max 254 characters. | Encrypted at rest (AES-256). Indexed. |
| `displayName` | String | User Input / OAuth | Public | Length: 1–100 characters. HTML special characters sanitized. | Plaintext root field. |
| `role` | String Enum | System Assignment | Access Control | Allowed values: `['student', 'supporter', 'teacher', 'admin', 'superadmin']`. | Enforced via server-side security rules. |
| `tokens` | Integer | System Grant | Financial | Non-negative integer. Super Admin balance displays as `UNL` (`999999`). | Numeric integer. |
| `isCharityTeacher`| Boolean | Admin Verification | Privilege Flag | `true` grants 0-token marketplace cloning and free AI assist. | Root field. |
| `createdAt` | Timestamp | System Generated | Internal Audit | UTC ISO 8601 string or numeric timestamp. | Read-only timestamp. |
| `lastLoginAt` | Timestamp | System Generated | Internal Audit | UTC ISO 8601 string. | 7-year audit retention. |

---

### Domain 2: Course Specifications (`courses/{courseId}`)

Defines top-level course metadata, taxonomy, and curriculum framework alignment.

| Field Name | Type | Ingestion Method | Classification | Invariants & Constraints | Storage & Security |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | String | System Generated | Internal Audit | Pattern: `^course_[a-zA-Z0-9_-]{8,32}$`. | Primary key. Indexed. |
| `tag` | String Enum | System Injected | Partition Key | **Constant**: `'lms'`. Mandatory partition discriminator. | Root field. Indexed. |
| `title` | String | Teacher Input | Public | Length: 1–200 characters. Defaults to `'New Course'`. | Indexed string. |
| `code` | String | Teacher Input | Public | Course identifier (e.g., `'CRS-100'`, `'BSB-301'`). Used as prefix for unit codes. | Indexed string. |
| `aqfLevel` | Integer | Taxonomy Picker | Public | Range: `0 <= aqfLevel <= 9`. Level 0 = International / Unassigned; 1–9 = AQF levels. | Numeric integer. |
| `curriculumStandards`| Array<String> | Checkbox Selection| Public | Permitted ids: `['aqf_framework', 'teqsa_standards', 'asqa_vet', 'aacsb_international', 'bloom_revised']`. | Array of strings. |
| `category` | String | Category Dropdown | Public | Must match recognized LMS category list. Defaults to `'Information Technology'`. | Indexed string. |
| `year` | String | Input Field | Public | e.g., `'2026 Semester 1'`. | Root field. |
| `startDate` | String (Date) | Date Picker | Public | ISO 8601 date string `YYYY-MM-DD`. | Root field. |
| `description` | String | Textarea | Public | Length: 0–10,000 characters. Course summary. | Plaintext string. |
| `learningOutcomes` | Array<String> | Textarea (lines) | Public | Course Learning Outcomes (CLOs). Split on newline, trimmed. | Array of strings. |
| `isDraft` | Boolean | Toggle | Public Status | `true` indicates draft mode. Draft courses block student assessment submissions. | Indexed boolean. |
| `isPublished` | Boolean | Toggle | Public Status | `true` makes course discoverable to enrolled members. | Indexed boolean. |
| `units` | Array<Unit> | System / Teacher | Structural Domain | **Invariant**: Starts empty `[]`. Teacher clicks `+ Add Unit` to create units. | Embedded array of Unit objects. |
| `assessments` | Array<Asmt> | System / Teacher | Structural Domain | **Invariant**: Consolidated at course level; starts empty `[]`. | Embedded array of Assessment objects. |

---

### Domain 3: Units of Study (`course.units[i]`)

The primary modular instructional structure. Holds lesson content, performance criteria, and modular block stacks.

#### 3.1 Structural Invariants
1. **No Default Units**: New courses initialize with `units: []`. The educator explicitly begins the curriculum by clicking **`+ Add Unit`**.
2. **Automated Unit Code Derivation**: When clicking `+ Add Unit`, the unit code is automatically generated based on the Course Code:
   $$\text{UnitCode} = \text{CourseCode} + \text{"-"} + (\text{NextSequenceNumber})$$
   *Example*: If Course Code is `CRS-100`, the first unit is `CRS-100-1`, the second is `CRS-100-2`, and so on. If Course Code is changed to `BSB-301`, new units follow as `BSB-301-1`, `BSB-301-2`.
3. **Educator-Authored Unit Title**: The Unit Title initializes empty (`''`) with placeholder `"e.g. Design and produce business documents"` so the teacher enters their own title.
4. **No Multiple Lessons**: Each unit contains exactly one unified Modular Lesson Stack. There are no sub-lessons.

#### 3.2 Data Fields Specification
| Field Name | Type | Ingestion Method | Classification | Invariants & Constraints | Storage & Security |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | String | System Generated | Internal Audit | Unique unit identifier `^unit_[a-zA-Z0-9_-]{8,32}$`. | Sub-entity ID. |
| `unitCode` | String | Automated / Edit | Public | Automated as `${courseCode}-${n}`. Teacher editable. | Sub-entity string. |
| `unitTitle` | String | Teacher Input | Public | Educator-authored title. Length: 0–200 characters. | Sub-entity string. |
| `nominalHours` | Integer \| String | Teacher Input | Public | Nominal Guided Learning Hours. Optional (empty string `''` by default). | Number or empty string. |
| `description` | String | Teacher Input | Public | **Performance Criteria**: What learners must demonstrate to be competent. | Plaintext string. |
| `learningOutcomes`| Array<String> | Textarea (lines) | Public | **Unit Learning Outcomes (one per line)**. Parsed into string array. | Array of strings. |
| `content` | String | Teacher Input | Public | **Unit Content**: Main lesson paragraphs, explanations, and student activities (max 50,000 characters). | Plaintext string. |
| `tag` | String Enum | System Injected | Partition Key | **Constant**: `'lms'`. | Sub-entity field. |
| `blocks` | Array<Block> | Toolbar Buttons | Structural Stack | Modular block list (max 150 blocks per unit). | Array of content block objects. |

---

### Domain 4: Modular Lesson Stack Content Blocks (`unit.blocks[j]`)

Typed, ordered instructional components added via the **`Add Block:`** toolbar.

| Block Type | Icon | Label | Target Metadata / Content | Validation & Behavior |
| :--- | :---: | :--- | :--- | :--- |
| `text_description` | 📝 | **Unit Description** | `block.content` (Markdown) | Markdown instructional content, core theory, or student notes. Rendered above Performance Criteria. |
| `teacher_guide` | 🧑‍🏫 | **Teacher Guide** | `block.content` (Markdown) | Internal pedagogy notes, lesson timings, facilitator secrets. Hidden from student view. |
| `youtube_video` | ▶️ | **YouTube Video** | `metadata.youtubeUrl` | Validated YouTube URL (`youtube.com/watch?v=...` or `youtu.be/...`). Stripped of script tags. |
| `google_drive_link`| 📁 | **Google Drive Resource** | `metadata.driveUrl` | Validated Google Drive / Docs / Sheets URL. Max length 2,048 chars. |
| `file_upload` | 📎 | **Direct File Attachment** | `metadata.fileUrl` | **Disabled (Soon)**: Displays badge. Button click prevented until direct cloud storage upload is released. |
| `notebook_link` | 📓 | **Gemini Notebook** | `metadata.notebookUrl` | Validated Gemini Notebook / NotebookLM link (`notebooklm.google.com/notebook/...`). |
| `quiz` | ❓ | **Quiz & Questions** | `block.quiz` | Unit quiz containing multiple choice, true/false, short answer, and open questions. Answer keys isolated. |

---

### Domain 5: Course-Level Assessments & Rubrics (`course.assessments[k]`)

Single source of truth for formative and summative course assessment tasks.

#### 5.1 Structural Invariants
1. **Consolidated Course Scope**: Assessments live once at course level (`course.assessments`), never duplicated inside individual units.
2. **No Default Assessment**: New courses have `assessments: []`. The teacher adds each task using `+ Add Formative Task` or `+ Add Summative Task`.
3. **Weight Sum Invariant**: Total assessment weights across the course must sum to **100%**.
4. **Sample Rubric Matrix**: Each new task starts with a 3-criterion sample rubric tailored to its type (formative vs. summative), with 4 performance levels (Fail, Pass, Credit, Distinction / High Distinction).

#### 5.2 Data Fields Specification
| Field Name | Type | Ingestion Method | Classification | Invariants & Constraints | Storage & Security |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | String | System Generated | Internal Audit | Unique identifier `^asmt_[a-zA-Z0-9_-]{8,32}$`. | Sub-entity ID. |
| `type` | String Enum | Selector | Assessment Type | Allowed values: `'formative'` \| `'summative'`. | Sub-entity field. |
| `title` | String | Teacher Input | Public | Task title (e.g. `'Formative Task 1: Practical Lab'`). | Sub-entity string. |
| `unitId` | String | Unit Link Selector| Alignment | Optional reference to a specific unit ID. | Sub-entity string. |
| `weightPercentage`| Integer | Teacher Input | Financial / Grade | Integer between `1` and `100`. Sum across course must equal `100`. | Numeric integer. |
| `rubric` | Array<Criterion>| Rubric Matrix | Evaluation Spec | List of evaluation criteria with qualitative descriptors. | Embedded array. |

---

### Domain 6: Token Fund, Grants & Stripe Payments (`transactions/{id}`)

Governs platform token purchases, sponsorship funding, and Super Admin grants.

| Field Name | Type | Ingestion Channel | Classification | Invariants & Constraints | Storage & Security |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `transactionId` | String | Stripe Webhook / System | Internal Audit | Pattern: `^pi_[a-zA-Z0-9]+$` or `^grant_[0-9]{13}$`. | Firestore Document ID. |
| `tag` | String Enum | System Injection | Partition Key | **Constant**: `'lms'`. Mandatory partition key. | Root field. Indexed. |
| `userId` | String | Authenticated Session | Identity | Recipient user UID. | Root field. Indexed. |
| `tokens` | Integer | System Grant / Stripe | Token Economy | Range: `1 <= tokens <= 999` for grants. Super Admin displays `UNL`. | Numeric integer. |
| `amount` | Integer | Stripe Session | Financial | Strictly positive integer (in whole AUD cents). Decimals rejected. | Numeric integer. |
| `currency` | String Enum | Server Default | Financial | Three-letter ISO code: `'aud'`. | Root field. |
| `status` | String Enum | Server Verification | Audit State | State flow: `'initiated'` → `'processing'` → `'succeeded'` \| `'failed'`. | Root field. Indexed. |
| `recordedAt` | Timestamp | Server Generated | Internal Audit | UTC ISO 8601 string. | 7-year statutory retention. |

---

### Domain 7: Automated & AI Operations (Gemini AI Assist)

Governs AI syllabus ingestion, Course Spreadsheet parsing, and rubric generation.

| Slot / Parameter | Type | Channel | Classification | Validation & Hallucination Traps | Fail-Safe Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `tokenFee` | Integer | System Config | Financial | Range: `0 <= fee <= 10`. Configurable by Super Admin. 0 = free. | Revert to default `10` on error. |
| `syllabusText` | String | Teacher Input | Content | Length: 50–50,000 characters. Sanitized text. | Block request if `< 50` characters. |
| `curriculumRouting`| Array<String>| Standards Selector | System Rule | If AQF Level >= 7, route to TEQSA/AACSB standards. Otherwise, default to Bloom's taxonomy. | Fallback to Bloom's Revised Taxonomy. |
| `teacherUrlSafety` | Array<URI> | AI Merge Engine | System Rule | **Invariant**: Links and YouTube URLs provided by teachers are immutably preserved. Invented URLs are stripped. | Reject AI-generated fake URLs. |

---

## 3. Regulatory Alignment & Compliance Mapping

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          REGULATORY ALIGNMENT                               │
│                                                                             │
│   [ Privacy Act 1988 & APPs ]         ──► Data Minimization & AES-256       │
│   [ PCI DSS v4.0 (SAQ A) ]            ──► Zero Raw Cardholder Storage       │
│   [ Corporations Act 2001 (s 286) ]   ──► Mandatory 7-Year Retention        │
│   [ ASQA / TEQSA AQF Guidelines ]     ──► Clear Outcomes & Rubric Matrices  │
└─────────────────────────────────────────────────────────────────────────────┘
```

1. **Australian Privacy Principles (APP 1, 3, 5, 11)**:
   - Data collection limited strictly to educational and account provisioning needs.
   - Enforce TLS 1.3 in transit and AES-256 at rest across all datastores.
2. **PCI Data Security Standard (PCI DSS v4.0 SAQ A)**:
   - System servers never process or store raw card numbers, CVVs, or expirations.
   - All checkouts use secure Stripe tokenization.
3. **Statutory Corporate Recordkeeping**:
   - Course submissions, student attempts, invoices, and token ledger transactions are retained immutably for **7 years** (Corporations Act 2001, s 286).

---

## 4. Verification Checklists

### 4.1 Development & Pre-Flight Deployment Checklist
- [x] **Partition Key Enforcement**: All Firestore reads/writes enforce `tag: 'lms'`.
- [x] **Units of Study Invariant**: Blank courses initialize with `units: []`; clicking `+ Add Unit` generates sequential `CRS-100-1`, `CRS-100-2` codes.
- [x] **Unit Field Completeness**: All 7 unit fields present in order (`Unit Code`, `Unit Title`, `Nominal Hours`, `Unit Description`, `Performance Criteria`, `Unit Learning Outcomes`, `Unit Content`).
- [x] **Modular Block Toolbar**: All 7 blocks supported (📝, 🧑‍🏫, ▶️, 📁, 📎 Soon, 📓, ❓).
- [x] **Course Assessments Scope**: Tasks live at course level; weightings strictly sum to 100%.
- [x] **Zero Cardholder Storage**: No database field or log file holds raw credit card numbers or CVVs.

### 4.2 Autonomous AI & Automated Agent Checklist
- [x] **Model Fallback Chain**: Gemini requests handle 503/429 errors gracefully with deterministic fallbacks.
- [x] **Link Protection Invariant**: Teacher URLs survive AI merges; hallucinated links are discarded.
- [x] **Fee Boundary**: Token fee deduction checks balance and prevents negative balances.

### 4.3 Periodic Operations & Audit Checklist
- [x] **Quarterly Retention Scrub**: Non-financial inquiry logs older than 24 months purged automatically.
- [x] **Statutory Financial Integrity**: 7-year transaction and assessment audit trails verified intact.

---

*Ratified as the foundational Data Contracts & System Integrity Specification for the Pro-LMS platform.*
