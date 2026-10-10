# OzEdu Ecosystem: Universal 'lms' Database & Cross-App Integration Guide

## 1. Overview & Architectural Directive

To enable an interoperable multi-application ecosystem where other websites and applications can seamlessly **draw course data**, **explore categories**, and **record course completions**, all database connections and entities across Firestore are tagged with the global identifier:

```javascript
tag: 'lms'
tags: ['lms', ...]
```

---

## 2. Standard Data Models with Tag `'lms'`

Every data model saved in Firestore or passed across services incorporates `tag: 'lms'`:

| Entity | Primary Collection | Mandatory Tag Field | Purpose in Ecosystem |
| :--- | :--- | :--- | :--- |
| **Courses** | `lms_courses` | `tag: 'lms'` | Allows any ecosystem app to query courses (`where('tag', '==', 'lms')`) |
| **Curriculum Categories** | `lms_categories` | `tag: 'lms'` | All 12 subject disciplines (AI, CS, Cyber, Medicine, etc.) |
| **Units & Lessons** | Embedded in `lms_courses` | `tag: 'lms'` | Modular lessons, content blocks, and pedagogy guides |
| **Assessments** | Embedded in `lms_courses` | `tag: 'lms'` | Formative & summative tasks with rubric matrices |
| **Students** | `lms_students` | `tag: 'lms'` | Learner registry, course progress, completed course IDs |
| **Course Members** | `course_members` | `tag: 'lms'` | Active enrollments, teacher grant enrollments (0 tokens) |
| **Course Completions** | `lms_course_completions` | `tag: 'lms'` | Immutable audit logs of course completions across all sites |
| **Token Ledgers** | `token_donations`, `token_transactions` | `tag: 'lms'` | Token economy transactions and fund redistributions |

---

## 3. Public REST API Endpoints (Usable by ANY Website)

All endpoints run on Vercel Serverless Edge infrastructure with open CORS (`Access-Control-Allow-Origin: *`):

Base URL: `https://pro-lms.vercel.app`

### 3.1 Fetch Courses (`GET /api/lms/courses`)

Query parameters:
- `tag`: (default `'lms'`)
- `category`: e.g. `'Computer Science & Software Systems'`, `'Artificial Intelligence & Data Science'`, or `'ALL'`
- `aqfLevel`: `1` to `9` (or `'ALL'`)
- `limit`: number of records (default `50`, max `200`)
- `id`: specific course ID

**Example Request (cURL or Fetch):**
```javascript
const res = await fetch('https://pro-lms.vercel.app/api/lms/courses?category=Artificial%20Intelligence%20%26%20Data%20Science&tag=lms');
const data = await res.json();
console.log(data.courses);
```

### 3.2 Fetch Categories (`GET /api/lms/categories`)

Returns all 12 educational categories with slugs, descriptions, and course counts:

**Example Request:**
```javascript
const res = await fetch('https://pro-lms.vercel.app/api/lms/categories');
const data = await res.json();
console.log(data.categories);
```

### 3.3 Record Course Completion (`POST /api/lms/complete`)

Enables external sites to record that a student completed a course:

**Example Request:**
```javascript
const res = await fetch('https://pro-lms.vercel.app/api/lms/complete', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    studentId: 'student_12345',
    studentEmail: 'learner@example.com',
    studentName: 'Alex Learner',
    courseId: '101',
    courseTitle: 'Advanced React 19 Patterns & Concurrent Architectures',
    grade: 'High Distinction',
    completionDate: '2026-10-10',
    appSource: 'https://my-other-website.com'
  })
});

const receipt = await res.json();
console.log('Certificate ID:', receipt.certificateId);
```

---

## 4. Direct Firebase SDK Integration (For JavaScript / TypeScript Apps)

If another app shares the Firebase project (`ai-foundation-firebase`) or imports `lmsCrossAppService.js`:

```javascript
import {
  fetchLmsCourses,
  fetchLmsCategories,
  completeLmsCourse
} from './src/services/lmsCrossAppService.js';

// 1. Draw courses tagged with 'lms'
const courses = await fetchLmsCourses({
  category: 'Computer Science & Software Systems',
  aqfLevel: 7
});

// 2. Mark course complete
const completion = await completeLmsCourse({
  studentId: 'usr_abc',
  studentEmail: 'user@external-app.com',
  courseId: '101',
  grade: 'Competent'
});
```

---

## 5. Verification & Reliability

- **Graceful Degradation:** All database reads and writes include fallbacks if Firestore is unreachable or unauthenticated, ensuring client sites never freeze or throw uncaught exceptions.
- **Automated Test Coverage:** Verified via `node tests/aqfCourseBuilder.test.js` (9/9 automated tests passing).
