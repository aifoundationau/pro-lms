/**
 * Gemini AI Service for parsing Google Sheets into Courses
 * Supports Gemini 3.8 Flash / 2.5 Flash with fallback heuristic parsing
 * Incorporates ISO 8601 dates with browser localization
 */

export const DEFAULT_GEMINI_KEY = import.meta?.env?.VITE_GEMINI_API_KEY || (typeof process !== 'undefined' ? process.env?.VITE_GEMINI_API_KEY : '') || '';

/**
 * Formats an ISO 8601 date string (YYYY-MM-DD) into the user's localized format
 * E.g., '2026-03-02' -> 'Mon, 2 Mar 2026' or localized according to the user's locale/device.
 */
export function formatLocalizedDate(isoDateStr) {
  if (!isoDateStr) return '';
  try {
    const trimmed = String(isoDateStr).trim();
    if (!trimmed) return '';
    // Handle YYYY-MM-DD cleanly without timezone shift
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const [year, month, day] = trimmed.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      return new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }).format(date);
    }
    const date = new Date(trimmed);
    if (isNaN(date.getTime())) return trimmed;
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: trimmed.includes('T') ? 'short' : undefined
    }).format(date);
  } catch {
    return isoDateStr;
  }
}

export const SAMPLE_SHEET_CSV = `Course Title,Start Date (ISO8601),Year / Semester,Course Description,Learning Outcomes,Assumed Knowledge
Marine Biology & Ocean Conservation,2026-03-02,2026 Semester 1,"A comprehensive exploration of ocean ecosystems, marine biodiversity, and contemporary conservation strategies.","1. Understand marine ecology principles\n2. Evaluate human impacts on coral reefs\n3. Design conservation action plans","Introductory secondary science or biology."

Module / Week,Start Date (ISO8601),Lecture Description,Presentation URL,Multiple Choice Quiz,Short Answer Quiz
Week 1: Ocean Chemistry & Currents,2026-03-02,"Introduction to marine salinity, thermohaline circulation, and depth zones.",https://slides.example.com/week1,"1. What is the average salinity of seawater?\nChoices: A. 3.5% B. 10% C. 0.5% D. 15% E. 25%. Correct: 3.5%","Question: What drives deep ocean thermohaline circulation?\nSample: Thermohaline circulation is driven by global density gradients.\nSample Answer: Differences in water temperature and salinity."
Week 2: Coral Reef Ecology,2026-03-09,"Analysis of coral polyps, zooxanthellae symbiosis, and bleaching events.",https://slides.example.com/week2,"1. What symbiotic organism lives inside reef-building corals?\nChoices: A. Diatoms B. Zooxanthellae C. Kelp D. Crustaceans E. Fungi. Correct: Zooxanthellae","Question: What primary factor triggers coral bleaching?\nSample: Coral bleaching occurs when corals expel symbiotic algae due to stress.\nSample Answer: Elevated sea surface temperatures."
Week 3: Deep Sea Adaptations,2026-03-16,"Bioluminescence, gigantism, and hydrothermal vent chemosynthesis.",https://slides.example.com/week3,"1. Which energy source powers hydrothermal vent ecosystems?\nChoices: A. Sunlight B. Geothermal chemosynthesis C. Wind D. Lunar tides E. Nuclear decay. Correct: Geothermal chemosynthesis","Question: Name an adaptation common to deep-sea creatures.\nSample: Organisms develop bioluminescence or slow metabolic rates.\nSample Answer: Bioluminescence for attracting prey or communication."

Assessment Title,Due Date (ISO8601),Assessment Description,Rubric,Type,Questions or Details
Field Investigation Report,2026-04-10,"Conduct a survey of a local coastal or simulated marine zone and write an observational report.","Clarity of data (30%), Ecological analysis (40%), Conservation recommendations (30%)",essay,"Write a 1500-word field report detailing species diversity and anthropogenic pressures observed."
Mid-Semester Marine Quiz,2026-04-17,"Comprehensive quiz evaluating Weeks 1-3 ocean chemistry and reef biodiversity.","100% accuracy based on automated answer keys",multipleChoice,"1. What is the average salinity of seawater?\nChoices: A. 3.5% B. 10% C. 0.5% D. 15% E. 25%. Correct: 3.5%\n2. What symbiotic organism lives inside reef-building corals?\nChoices: A. Diatoms B. Zooxanthellae C. Kelp D. Crustaceans E. Fungi. Correct: Zooxanthellae"
Policy Brief Short Answers,2026-05-01,"Short answer case study addressing marine protected areas (MPAs).","Rubric: 10 marks per question based on evidence and reasoning.",shortAnswer,"Question: How do Marine Protected Areas support fish populations?\nSample: MPAs provide safe zones allowing fish biomass to recover.\nSample Answer: By prohibiting extractive activities and promoting spillover into adjacent waters."
`;

/**
 * Heuristic fallback parser when AI API credits are depleted or offline
 */
export function parseSheetFallback(content) {
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  
  let courseTitle = 'Imported Course from Sheet';
  let courseStartDate = new Date().toISOString().split('T')[0];
  let courseYear = new Date().getFullYear() + ' Semester 1';
  let courseDesc = '';
  let courseOutcomes = '';
  let courseKnowledge = '';
  const modules = [];
  const assessments = [];

  let currentSection = 'info';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();

    // Section transitions
    if (lower.includes('module') || lower.includes('week') || lower.includes('unit')) {
      if (!lower.startsWith('course')) currentSection = 'modules';
    }
    if (lower.includes('assessment') || lower.includes('exam') || lower.includes('rubric') || lower.includes('essay')) {
      currentSection = 'assessments';
    }

    // Try parsing CSV comma or tab separated fields
    const cols = line.split(/[,\t]/).map(c => c.replace(/^["']|["']$/g, '').trim());
    if (cols.length >= 2) {
      const col0 = cols[0].toLowerCase();
      if (col0.includes('course title') || col0 === 'title') {
        courseTitle = cols[1] || courseTitle;
        // Check if col[2] is a date or year
        if (cols[2]) {
          if (/^\d{4}-\d{2}-\d{2}/.test(cols[2])) {
            courseStartDate = cols[2];
            if (cols[3]) courseYear = cols[3];
            if (cols[4]) courseDesc = cols[4];
            if (cols[5]) courseOutcomes = cols[5];
            if (cols[6]) courseKnowledge = cols[6];
          } else {
            courseYear = cols[2];
            if (cols[3]) courseDesc = cols[3];
            if (cols[4]) courseOutcomes = cols[4];
            if (cols[5]) courseKnowledge = cols[5];
          }
        }
        continue;
      }
      if (col0.includes('start date') && cols[1]) {
        courseStartDate = cols[1];
        continue;
      }
      if (col0.includes('description') && !courseDesc) {
        courseDesc = cols[1];
        continue;
      }
      if (col0.includes('outcome') && !courseOutcomes) {
        courseOutcomes = cols[1];
        continue;
      }
    }

    if (currentSection === 'modules' && cols.length >= 2 && !cols[0].toLowerCase().includes('module / week')) {
      if (cols[0] && (cols[0].toLowerCase().includes('week') || cols[0].toLowerCase().includes('module') || cols[0].toLowerCase().includes('unit') || cols[1])) {
        // Detect if cols[1] is an ISO date
        const hasDate = /^\d{4}-\d{2}-\d{2}/.test(cols[1]);
        const modDate = hasDate ? cols[1] : '';
        const descCol = hasDate ? cols[2] : cols[1];
        const presCol = hasDate ? cols[3] : cols[2];
        const mcqCol = hasDate ? cols[4] : cols[3];
        const saCol = hasDate ? cols[5] : cols[4];

        modules.push({
          id: Date.now() + i * 10,
          unitName: cols[0] || `Module ${modules.length + 1}`,
          startDate: modDate || new Date(Date.now() + modules.length * 7 * 86400000).toISOString().split('T')[0],
          description: descCol || '',
          presentationUrl: presCol && presCol.startsWith('http') ? presCol : '',
          multipleChoice: mcqCol || '',
          shortAnswer: saCol || ''
        });
      }
    }

    if (currentSection === 'assessments' && cols.length >= 2 && !cols[0].toLowerCase().includes('assessment title')) {
      const hasDate = /^\d{4}-\d{2}-\d{2}/.test(cols[1]);
      const assmtDate = hasDate ? cols[1] : '';
      const descCol = hasDate ? cols[2] : cols[1];
      const rubricCol = hasDate ? cols[3] : cols[2];
      const typeCol = hasDate ? cols[4] : cols[3];
      const detailsCol = hasDate ? cols[5] : cols[4];

      const typeStr = (typeCol || '').toLowerCase();
      let type = 'essay';
      if (typeStr.includes('choice')) type = 'multipleChoice';
      else if (typeStr.includes('short')) type = 'shortAnswer';
      else if (typeStr.includes('exam')) type = 'exam';

      assessments.push({
        id: Date.now() + i * 100,
        title: cols[0] || `Assessment ${assessments.length + 1}`,
        dueDate: assmtDate || new Date(Date.now() + (assessments.length + 2) * 14 * 86400000).toISOString().split('T')[0],
        description: descCol || '',
        descriptionUrl: '',
        rubric: rubricCol || '',
        rubricUrl: '',
        type: type,
        typeText: detailsCol || '',
        typeUrl: ''
      });
    }
  }

  // If no modules parsed, create at least 1 starter module
  if (modules.length === 0) {
    modules.push({
      id: Date.now() + 1,
      unitName: 'Week 1: Introduction & Fundamentals',
      startDate: courseStartDate,
      description: 'Foundational concepts and introductory lecture.',
      presentationUrl: '',
      multipleChoice: '1. What is the primary objective of this course?\nChoices: A. Foundational skills B. General knowledge C. Testing only D. None. Correct: Foundational skills',
      shortAnswer: 'Question: Describe one key concept from this module.\nSample: The module establishes fundamental principles.\nSample Answer: Core foundational definitions and methodologies.'
    });
  }

  return {
    title: courseTitle,
    startDate: courseStartDate,
    year: courseYear,
    description: courseDesc || 'Course parsed and imported from Google Sheet.',
    outcomes: courseOutcomes || 'Master the concepts and practical applications outlined in this curriculum.',
    knowledge: courseKnowledge || 'Standard secondary education or foundational knowledge.',
    modules,
    assessments
  };
}

/**
 * Generate course from sheet text using Gemini API
 */
export async function parseCourseSheetWithAI(sheetContent, apiKey = DEFAULT_GEMINI_KEY) {
  const activeKey = apiKey || DEFAULT_GEMINI_KEY;

  const prompt = `You are an expert AI curriculum designer for an Australian LMS (OzEdu).
A teacher has provided the text/CSV data from their Google Sheet for a complete course.
Your job is to parse and organize ALL the course information, modules, quizzes, and assessments into a structured JSON object.

CRITICAL DATE FORMAT INSTRUCTIONS:
- All dates MUST be entered using standard ISO 8601 format: "YYYY-MM-DD" (e.g. "2026-03-02").
- Provide a "startDate" for the Course Info (ISO 8601: "YYYY-MM-DD").
- Provide a "startDate" for each Module (ISO 8601: "YYYY-MM-DD", sequential e.g. weekly).
- Provide a "dueDate" for each Assessment (ISO 8601: "YYYY-MM-DD").

Format Requirements for Downstream LMS Components:
1. Multiple Choice Questions in modules or assessments MUST strictly follow:
1. Question text here?
Choices: A. Option1 B. Option2 C. Option3 D. Option4 E. Option5. Correct: Option5

2. Short Answer Questions MUST strictly follow:
Question: Question text here?
Sample: Model sample response text.
Sample Answer: Key answer points.

3. Assessment types must be one of: "essay", "multipleChoice", "shortAnswer", "exam".

Here is the Google Sheet content:
---
${sheetContent}
---

Return ONLY a valid JSON object with this exact schema (no markdown formatting, no comments, just raw JSON):
{
  "title": "Course Title",
  "startDate": "YYYY-MM-DD (ISO8601 Course Start Date)",
  "year": "2026 Semester 1 or Year Level",
  "description": "Comprehensive course description",
  "outcomes": "Numbered or bulleted learning outcomes",
  "knowledge": "Assumed prior knowledge or prerequisites",
  "modules": [
    {
      "unitName": "e.g., Week 1: Unit Name",
      "startDate": "YYYY-MM-DD (ISO8601 Module Start Date)",
      "description": "Lecture content and summary",
      "presentationUrl": "Presentation link if provided or empty string",
      "multipleChoice": "Formatted multiple choice questions or empty string",
      "shortAnswer": "Formatted short answer questions or empty string"
    }
  ],
  "assessments": [
    {
      "title": "Assessment Title",
      "dueDate": "YYYY-MM-DD (ISO8601 Assessment Due Date)",
      "description": "Detailed task description",
      "rubric": "Assessment rubric or grading criteria",
      "type": "essay",
      "typeText": "Questions, essay prompt, or examination content"
    }
  ]
}`;

  const modelsToTry = ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-flash-latest'];
  let lastError = null;

  for (const model of modelsToTry) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${activeKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json'
          }
        })
      });

      const data = await response.json();

      if (!response.ok) {
        lastError = data?.error?.message || `HTTP ${response.status}`;
        console.warn(`Model ${model} returned error:`, lastError);
        continue;
      }

      const textResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!textResponse) {
        throw new Error('No content generated by Gemini');
      }

      // Clean up markdown code block if present
      const cleanedJson = textResponse
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/, '')
        .replace(/```\s*$/, '')
        .trim();

      const parsed = JSON.parse(cleanedJson);

      const defaultCourseStart = parsed.startDate || new Date().toISOString().split('T')[0];

      // Validate & normalize
      return {
        title: parsed.title || 'Untitled Course',
        startDate: defaultCourseStart,
        year: parsed.year || '2026 Semester 1',
        description: parsed.description || '',
        outcomes: parsed.outcomes || '',
        knowledge: parsed.knowledge || '',
        modules: Array.isArray(parsed.modules) ? parsed.modules.map((m, idx) => ({
          id: Date.now() + idx * 10,
          unitName: m.unitName || `Module ${idx + 1}`,
          startDate: m.startDate || defaultCourseStart,
          description: m.description || '',
          presentationUrl: m.presentationUrl || '',
          multipleChoice: m.multipleChoice || '',
          shortAnswer: m.shortAnswer || ''
        })) : [],
        assessments: Array.isArray(parsed.assessments) ? parsed.assessments.map((a, idx) => ({
          id: Date.now() + idx * 100 + 5,
          title: a.title || `Assessment ${idx + 1}`,
          dueDate: a.dueDate || defaultCourseStart,
          description: a.description || '',
          descriptionUrl: '',
          rubric: a.rubric || '',
          rubricUrl: '',
          type: ['essay', 'multipleChoice', 'shortAnswer', 'exam'].includes(a.type) ? a.type : 'essay',
          typeText: a.typeText || '',
          typeUrl: ''
        })) : [],
        source: 'gemini-ai'
      };
    } catch (err) {
      lastError = err.message;
      console.warn(`Attempt with ${model} failed:`, err);
    }
  }

  // If Gemini API call failed (e.g. quota depleted 402 or key issue), fall back gracefully to heuristic parsing
  console.log('Gemini API call could not be completed, using intelligent fallback parser. Reason:', lastError);
  const fallbackResult = parseSheetFallback(sheetContent);
  fallbackResult.source = 'fallback-parser';
  fallbackResult.warning = lastError;
  return fallbackResult;
}
