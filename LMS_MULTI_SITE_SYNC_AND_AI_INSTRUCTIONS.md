# Antigravity Multi-Site LMS Sync & AI Content Generator Specification

This document provides the standard drop-in protocol and instructions for any new or existing Antigravity web application to connect to the centralized **pro-lms** Firestore database.

---

## 1. Overview & Vision
This architecture allows any connected site to:
1. **Sync Courses & Data**: Read and publish courses to the central database under the unified `lms` namespace (`lms_courses`, `lms_students`, `lms_leads`).
2. **AI-Powered Discovery & Recommendations**: Query across all public/network courses to recommend matching curriculum based on user interests, career goals, or intake questions.
3. **AI Course Generation & Re-use**: Search previous courses, extract top-performing modules, lessons, and assessment structures, and synthesize new bespoke courses using proven existing curriculum blocks.

---

## 2. Environment Variables (.env)
Add the following configuration to each satellite project's `.env`:

```env
# Central Firebase Configuration (connects to pro-lms)
VITE_FIREBASE_API_KEY=AIzaSyC4T6H4jwgI7GKtJ4ys8qZLcykq_27kUBc
VITE_FIREBASE_AUTH_DOMAIN=pro-lms-c44d1.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=pro-lms-c44d1
VITE_FIREBASE_STORAGE_BUCKET=pro-lms-c44d1.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=254944616894
VITE_FIREBASE_APP_ID=1:254944616894:web:72e56e4c93212c8e47d9ef

# Gemini API Key (for AI course search, recommendations, and generation)
VITE_GEMINI_API_KEY=your_gemini_api_key_here

# Network Tag & Universal Identity
VITE_LMS_SITE_ID=lms
VITE_LMS_LEGACY_READ=false
```

---

## 3. Database Schema Conventions (`lms_*`)

### Collection: `lms_courses`
Documents represent master course definitions:
```typescript
interface LMSCourse {
  id: string;                    // Firestore Document ID (or course code)
  siteId: string;                // Universal tag: 'lms'
  visibility: 'global' | 'site'; // 'global' = shared across all sites; 'site' = scoped to siteId
  title: string;
  category: string;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  duration: string;              // e.g., "12 Weeks"
  price: number;
  featured: boolean;
  archived: boolean;
  shortDescription: string;
  fullDescription: string;
  targetAudience?: string;
  learningOutcomes: string[];
  prerequisites?: string[];
  
  // Curriculum blocks (used for AI synthesis)
  modules: Array<{
    id: string;
    title: string;
    duration: string;
    description: string;
    lessons: Array<{
      id: string;
      title: string;
      content: string;
      durationMinutes?: number;
      type: 'video' | 'reading' | 'quiz' | 'assignment';
    }>;
  }>;

  assessments: Array<{
    id: string;
    title: string;
    type: 'quiz' | 'project' | 'exam';
    weightPercentage: number;
    criteria?: string[];
  }>;

  students: number;              // Current enrollment counter
  createdAt: number;
  updatedAt: number;
  migratedFrom?: string;
}
```

---

## 4. Drop-in Client Module (`lmsClient.js`)
Place this file in `src/services/lmsClient.js` in your satellite project:

```javascript
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  setDoc, 
  updateDoc, 
  query, 
  where, 
  increment, 
  serverTimestamp 
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const CURRENT_SITE_ID = import.meta.env.VITE_LMS_SITE_ID || 'lms';

/**
 * Fetch courses available to this site:
 * Returns both global courses AND courses specific to this siteId.
 */
export async function getCourses({ includeArchived = false } = {}) {
  const col = collection(db, 'lms_courses');
  const snap = await getDocs(col);
  const list = [];
  
  snap.forEach(d => {
    const data = d.data();
    if (!includeArchived && data.archived) return;
    
    // Multi-tenant check: include if matches siteId OR is global
    if (data.siteId === CURRENT_SITE_ID || data.visibility === 'global') {
      list.push({ id: d.id, ...data });
    }
  });
  
  return list;
}

/**
 * Fetch ALL global courses in the network for AI index/cross-reference.
 */
export async function getAllNetworkCourses() {
  const col = collection(db, 'lms_courses');
  const snap = await getDocs(col);
  const list = [];
  
  snap.forEach(d => {
    const data = d.data();
    if (!data.archived) {
      list.push({ id: d.id, ...data });
    }
  });
  
  return list;
}

/**
 * Save or publish a course into the LMS database.
 */
export async function saveCourse(courseData) {
  const id = courseData.id || `CRS-${Date.now()}`;
  const ref = doc(db, 'lms_courses', id);
  const payload = {
    ...courseData,
    id,
    siteId: courseData.siteId || CURRENT_SITE_ID,
    visibility: courseData.visibility || 'site',
    updatedAt: Date.now()
  };
  await setDoc(ref, payload, { merge: true });
  return payload;
}
```

---

## 5. AI Service: Search, Recommendations & Course Builder (`lmsAiService.js`)
Install the Google GenAI SDK:
`npm install @google/genai`

Create `src/services/lmsAiService.js`:

```javascript
import { GoogleGenAI } from '@google/genai';
import { getAllNetworkCourses, saveCourse } from './lmsClient';

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });
const MODEL_NAME = 'gemini-2.5-flash';

/**
 * Helper to build an index of existing courses for AI context.
 */
async function buildCoursesKnowledgeContext() {
  const courses = await getAllNetworkCourses();
  return courses.map(c => ({
    id: c.id,
    title: c.title,
    category: c.category,
    level: c.level,
    description: c.shortDescription || c.fullDescription,
    modules: (c.modules || []).map(m => ({
      title: m.title,
      lessons: (m.lessons || []).map(l => l.title)
    }))
  }));
}

/**
 * 1. AI Recommendation Engine: Match user intake queries to existing courses.
 */
export async function recommendCourses(userGoalsOrQuery) {
  const courseCatalog = await buildCoursesKnowledgeContext();

  const prompt = `
You are an expert academic advisor and course recommendation engine.
Here is the catalog of available courses across our LMS network:
${JSON.stringify(courseCatalog, null, 2)}

User request or profile:
"${userGoalsOrQuery}"

Recommend the top 3 best matching courses. For each, return:
- courseId
- title
- reason: 1-2 sentences why it fits their goals
- recommendedModules: specific module titles they should focus on

Output strict JSON:
[
  { "courseId": "...", "title": "...", "reason": "...", "recommendedModules": [...] }
]
`;

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: prompt,
    config: { responseMimeType: 'application/json' }
  });

  return JSON.parse(response.text);
}

/**
 * 2. AI Course Builder: Synthesize a new course using existing database content.
 */
export async function generateCourseWithExistingContent({ topic, targetAudience, durationWeeks = 8 }) {
  const existingCatalog = await buildCoursesKnowledgeContext();

  const prompt = `
You are a master curriculum designer. You have access to our network's existing course modules and topics:
${JSON.stringify(existingCatalog, null, 2)}

Task: Design a comprehensive new course on the topic: "${topic}".
Target Audience: "${targetAudience}".
Target Duration: ${durationWeeks} weeks.

Guidelines:
1. Wherever applicable, adapt or borrow best practices, concepts, or lesson formats from the existing catalog.
2. Provide a cohesive, production-grade syllabus with modules, lessons, and assessment items.

Output strict JSON matching this schema:
{
  "title": "Course Title",
  "category": "Technology | Business | Creative | Healthcare | etc.",
  "level": "Beginner | Intermediate | Advanced",
  "duration": "${durationWeeks} Weeks",
  "shortDescription": "2-3 sentence overview",
  "fullDescription": "Full detailed course syllabus description",
  "learningOutcomes": ["Outcome 1", "Outcome 2", "Outcome 3", "Outcome 4"],
  "modules": [
    {
      "id": "mod-1",
      "title": "Module Title",
      "duration": "Week 1-2",
      "description": "Module summary",
      "lessons": [
        {
          "id": "les-1",
          "title": "Lesson Title",
          "content": "Detailed overview of the lesson topics and exercises",
          "type": "video"
        }
      ]
    }
  ],
  "assessments": [
    {
      "id": "ass-1",
      "title": "Practical Assessment 1",
      "type": "project",
      "weightPercentage": 50,
      "criteria": ["Rubric point 1", "Rubric point 2"]
    }
  ]
}
`;

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: prompt,
    config: { responseMimeType: 'application/json' }
  });

  const generatedCourse = JSON.parse(response.text);

  // Optional: Auto-save directly into the shared LMS database
  // const saved = await saveCourse({ ...generatedCourse, visibility: 'site' });
  return generatedCourse;
}
```

---

## 6. One-Click Copy-Paste Antigravity Agent Master Prompt
To connect any new or existing website to this LMS network, simply copy the entire prompt block below and paste it into the Antigravity chat:

```text
Please integrate this project with our central LMS network database. Follow these exact steps:

1. ENVIRONMENT & SECURITY:
   - Check if `.env` exists; if not, create it. Add the following keys (do not overwrite existing unrelated keys):
     VITE_FIREBASE_API_KEY=AIzaSyC4T6H4jwgI7GKtJ4ys8qZLcykq_27kUBc
     VITE_FIREBASE_AUTH_DOMAIN=pro-lms-c44d1.firebaseapp.com
     VITE_FIREBASE_PROJECT_ID=pro-lms-c44d1
     VITE_FIREBASE_STORAGE_BUCKET=pro-lms-c44d1.firebasestorage.app
     VITE_FIREBASE_MESSAGING_SENDER_ID=254944616894
     VITE_FIREBASE_APP_ID=1:254944616894:web:72e56e4c93212c8e47d9ef
     VITE_LMS_SITE_ID=lms
     VITE_LMS_LEGACY_READ=false
   - Ensure `.env*` is listed in `.gitignore` so keys are never committed.
   - Also create or update `.env.example` with dummy placeholders.

2. DEPENDENCIES:
   - Ensure `firebase` and `@google/genai` are installed (`npm install firebase @google/genai`).

3. DATABASE & AI CLIENT:
   - Implement `src/services/lmsClient.js` targeting the `lms_courses`, `lms_students`, and `lms_leads` collections in project `pro-lms-c44d1`.
   - Implement `src/services/lmsAiService.js` using `@google/genai` with model `gemini-2.5-flash` to:
     a) Search and recommend courses based on student profile or goals (`recommendCourses`).
     b) Synthesize new courses borrowing existing modules from the database (`generateCourseWithExistingContent`).

4. UNIVERSAL TAG:
   - The universal tag across all websites is strictly 'lms'.
   - All shared queries and document references must use the 'lms' namespace.
```

---

## 7. Security & Rules Notice
- `lms_courses` can be read globally by all satellite websites with client credentials.
- `lms_students/{studentId}/private/sensitive` contains PII (passports, USIs, health data) and must remain locked down so public frontends cannot query sensitive student documents directly.
- The Firebase web API key is safe to include in the prompt because client-side Firebase keys are public identifiers; actual access control is guarded by Firestore security rules.

