/**
 * Course Marketplace & Content Exchange Service
 * Manages token-metered cloning (1 token), charity teacher overrides (0 tokens),
 * free content request workflows, and cross-course discovery.
 */

import { getUserTokenBalance, creditUserTokens } from './tokenService.js';
import { generateEntityId } from '../types/courseBuilderTypes.js';

// Local storage key for fallback / offline simulation
const STORAGE_REQUESTS_KEY = 'ozedu_free_content_requests';
const STORAGE_MARKETPLACE_COURSES = 'ozedu_marketplace_courses';

// Safe memory storage fallback for Node.js / SSR / non-browser test environments
const memoryStorage = new Map();

function safeGetStorage(key) {
  try {
    if (typeof localStorage !== 'undefined' && localStorage && typeof localStorage.getItem === 'function') {
      return localStorage.getItem(key);
    }
  } catch {
    // fallback
  }
  return memoryStorage.get(key) || null;
}

function safeSetStorage(key, val) {
  try {
    if (typeof localStorage !== 'undefined' && localStorage && typeof localStorage.setItem === 'function') {
      localStorage.setItem(key, String(val));
      return;
    }
  } catch {
    // fallback
  }
  memoryStorage.set(key, String(val));
}

/**
 * Checks whether a teacher has charity privileges
 */
export function isUserCharityTeacher(userProfile) {
  if (!userProfile) return false;
  return Boolean(userProfile.isCharityTeacher || userProfile.is_charity_teacher || userProfile.role === 'charity_teacher');
}

/**
 * Executes a token-metered clone operation for a Unit, Lesson, or Block
 *
 * Rules:
 * - If user is a Charity Teacher -> 0 tokens
 * - Else if user has >= 1 token -> Deduct 1 from buyer, credit 1 to original author
 * - Else -> Throws InsufficientTokensError with option to submit a FreeContentRequest
 */
export async function executeContentClone({
  currentUser,
  userProfile,
  targetAuthorId,
  entityType = 'unit', // 'unit' | 'lesson' | 'block'
  entityId,
  entityTitle = 'Content Resource'
}) {
  if (!currentUser?.uid) {
    throw new Error('Please sign in to clone course content.');
  }

  const isCharity = isUserCharityTeacher(userProfile);

  // 1. Charity teacher override: 0 tokens
  if (isCharity) {
    return {
      success: true,
      cost: 0,
      charityPassApplied: true,
      message: `🎉 Charity Pass applied! Cloned "${entityTitle}" at 0 tokens.`
    };
  }

  // Self-cloning: 0 tokens
  if (currentUser.uid === targetAuthorId) {
    return {
      success: true,
      cost: 0,
      isSelfClone: true,
      message: `Cloned your own ${entityType} at 0 tokens.`
    };
  }

  // 2. Standard token verification & deduction (1 token)
  const balance = await getUserTokenBalance(currentUser.uid).catch(() => 0);
  if (balance < 1) {
    const error = new Error(`Insufficient tokens (Current balance: ${balance} tokens. 1 token required).`);
    error.code = 'INSUFFICIENT_TOKENS';
    error.requiredTokens = 1;
    error.canRequestFree = true;
    error.entityId = entityId;
    error.entityType = entityType;
    error.authorId = targetAuthorId;
    throw error;
  }

  // Deduct 1 token from buyer
  await creditUserTokens(currentUser.uid, -1);

  // Credit 1 token to original author if author exists
  if (targetAuthorId && targetAuthorId !== 'anonymous' && targetAuthorId !== 'system') {
    await creditUserTokens(targetAuthorId, 1).catch(err => {
      console.warn('Author credit notice:', err);
    });
  }

  return {
    success: true,
    cost: 1,
    charityPassApplied: false,
    message: `Transferred 1 token to author. "${entityTitle}" successfully imported into your course builder!`
  };
}

/**
 * Creates and dispatches a FreeContentRequest to the author
 */
export async function createFreeContentRequest({
  requesterUser,
  requesterProfile,
  authorId,
  authorName = 'Educator',
  targetEntityType = 'unit',
  targetEntityId,
  targetEntityTitle = 'Educational Resource',
  reasonMessage = ''
}) {
  if (!requesterUser?.uid) {
    throw new Error('Please sign in to request content.');
  }

  const newRequest = {
    id: generateEntityId('req'),
    requesterId: requesterUser.uid,
    requesterName: requesterUser.displayName || requesterUser.email?.split('@')[0] || 'Teacher',
    requesterEmail: requesterUser.email || '',
    authorId,
    authorName,
    targetEntityType,
    targetEntityId,
    targetEntityTitle,
    reasonMessage: reasonMessage.trim() || 'Requesting free educational access for under-resourced students.',
    status: 'pending', // 'pending' | 'approved' | 'rejected'
    createdAt: Date.now()
  };

  // Save to storage cache for instant cross-tab reactivity
  try {
    const raw = safeGetStorage(STORAGE_REQUESTS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    list.unshift(newRequest);
    safeSetStorage(STORAGE_REQUESTS_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn('Storage request cache note:', err);
  }

  return newRequest;
}

/**
 * Retrieves all incoming content requests for an author
 */
export async function listAuthorIncomingRequests(authorId) {
  if (!authorId) return [];
  try {
    const raw = safeGetStorage(STORAGE_REQUESTS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return list.filter(r => r.authorId === authorId);
  } catch {
    return [];
  }
}

/**
 * Retrieves outgoing requests sent by a requester
 */
export async function listUserOutgoingRequests(requesterId) {
  if (!requesterId) return [];
  try {
    const raw = safeGetStorage(STORAGE_REQUESTS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return list.filter(r => r.requesterId === requesterId);
  } catch {
    return [];
  }
}

/**
 * Approves a FreeContentRequest
 */
export async function approveFreeContentRequest(requestId) {
  try {
    const raw = safeGetStorage(STORAGE_REQUESTS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const item = list.find(r => r.id === requestId);
    if (!item) throw new Error('Request not found');
    item.status = 'approved';
    item.resolvedAt = Date.now();
    safeSetStorage(STORAGE_REQUESTS_KEY, JSON.stringify(list));
    return item;
  } catch (err) {
    throw new Error(err?.message || 'Could not approve request');
  }
}

/**
 * Rejects a FreeContentRequest
 */
export async function rejectFreeContentRequest(requestId) {
  try {
    const raw = safeGetStorage(STORAGE_REQUESTS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const item = list.find(r => r.id === requestId);
    if (!item) throw new Error('Request not found');
    item.status = 'rejected';
    item.resolvedAt = Date.now();
    safeSetStorage(STORAGE_REQUESTS_KEY, JSON.stringify(list));
    return item;
  } catch (err) {
    throw new Error(err?.message || 'Could not reject request');
  }
}

/**
 * Initial curated marketplace seed templates
 */
const SEED_MARKETPLACE_COURSES = [
  {
    id: 'mkt_aqf4_webdev',
    authorId: 'system_curator_1',
    authorName: 'Dr. Sarah Mitchell',
    title: 'Certificate IV in Information Technology: Web Development',
    code: 'ICT40120',
    aqfLevel: 4,
    description: 'Comprehensive AQF Level 4 qualification covering client-side JavaScript, responsive layout architectures, and RESTful API endpoints.',
    tags: ['Web Development', 'ICT40120', 'JavaScript', 'Frontend', 'AQF4'],
    token_cost: 10,
    units: [
      {
        id: 'u_ictweb441',
        unitCode: 'ICTWEB441',
        unitTitle: 'Produce client-side script for dynamic web pages',
        nominalHours: 50,
        description: 'Design and write client-side script that enhances web page interactivity and verifies data structures.',
        lessons: [
          {
            id: 'l_js_dom',
            title: 'Lesson 1: DOM Manipulation & Event Listeners',
            order: 0,
            blocks: [
              {
                id: 'b_js_intro',
                type: 'text_description',
                order: 0,
                title: 'Core Concepts of Modern DOM Architecture',
                content: 'The Document Object Model (DOM) provides a structured tree representation of web documents enabling dynamic scripting.',
                metadata: {}
              },
              {
                id: 'b_js_tg',
                type: 'teacher_guide',
                order: 1,
                title: 'Pedagogy Guide & Lab Instructions',
                content: 'Allocate 20 minutes for live coding before students attempt Exercise 1. Remind students that bubbling propagates upwards.',
                metadata: {}
              },
              {
                id: 'b_js_yt',
                type: 'youtube_video',
                order: 2,
                title: 'Interactive DOM Event Propagation Demo',
                content: 'https://www.youtube.com/watch?v=XF1_UKAPrsg',
                metadata: { youtubeUrl: 'https://www.youtube.com/watch?v=XF1_UKAPrsg' }
              }
            ]
          }
        ],
        assessments: [
          {
            id: 'asmt_ictweb441_proj',
            title: 'Project 1: Interactive Client Application',
            type: 'summative',
            description: 'Implement a fully responsive web application utilizing asynchronous data fetching and DOM mutation.',
            rubric: []
          }
        ]
      }
    ]
  },
  {
    id: 'mkt_aqf5_cyber',
    authorId: 'system_curator_2',
    authorName: 'Prof. Marcus Vance',
    title: 'Diploma of Information Technology: Cyber Security & Risk',
    code: 'ICT50220',
    aqfLevel: 5,
    description: 'AQF Level 5 Diploma curriculum focusing on threat modeling, vulnerability scanning, security compliance, and network defense.',
    tags: ['Cyber Security', 'ICT50220', 'Risk Assessment', 'AQF5'],
    token_cost: 15,
    units: [
      {
        id: 'u_ictnwk541',
        unitCode: 'ICTNWK541',
        unitTitle: 'Evaluate and implement security practices for network management',
        nominalHours: 60,
        description: 'Conduct comprehensive security audits, identify perimeter vulnerabilities, and draft mitigation policies.',
        lessons: [
          {
            id: 'l_threat_model',
            title: 'Lesson 1: STRIDE Threat Modeling Framework',
            order: 0,
            blocks: [
              {
                id: 'b_stride_overview',
                type: 'text_description',
                order: 0,
                title: 'STRIDE Security Taxonomy Overview',
                content: 'STRIDE assesses Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, and Elevation of Privilege.',
                metadata: {}
              },
              {
                id: 'b_stride_drive',
                type: 'google_drive_link',
                order: 1,
                title: 'STRIDE Threat Assessment Matrix Template',
                content: 'https://drive.google.com/drive/folders/1exampleDriveFolder',
                metadata: { driveUrl: 'https://drive.google.com/drive/folders/1exampleDriveFolder' }
              }
            ]
          }
        ],
        assessments: [
          {
            id: 'asmt_threat_audit',
            title: 'Summative Case Study: Enterprise Perimeter Audit',
            type: 'summative',
            description: 'Evaluate a corporate network architecture diagram and compile a formal vulnerability mitigation brief.',
            rubric: []
          }
        ]
      }
    ]
  },
  {
    id: 'mkt_aqf3_business',
    authorId: 'system_curator_3',
    authorName: 'Eleanor Campbell',
    title: 'Certificate III in Business: Digital Workplace Operations',
    code: 'BSB30120',
    aqfLevel: 3,
    description: 'Foundational practical office technology, workplace spreadsheets, and collaborative team communication.',
    tags: ['Business', 'BSB30120', 'Productivity', 'AQF3'],
    token_cost: 8,
    units: [
      {
        id: 'u_bsbtec301',
        unitCode: 'BSBTEC301',
        unitTitle: 'Design and produce business documents',
        nominalHours: 35,
        description: 'Select appropriate software, apply corporate style guidelines, and verify data accuracy.',
        lessons: [],
        assessments: []
      }
    ]
  }
];

/**
 * Searches the marketplace across published courses and units
 */
export async function searchMarketplaceContent({
  keyword = '',
  aqfLevel = 'ALL',
  tag = ''
}) {
  let stored = [];
  try {
    const raw = safeGetStorage(STORAGE_MARKETPLACE_COURSES);
    if (raw) stored = JSON.parse(raw);
  } catch {
    stored = [];
  }

  const allCourses = [...SEED_MARKETPLACE_COURSES, ...stored];

  return allCourses.filter(course => {
    // Level filter
    if (aqfLevel !== 'ALL' && Number(course.aqfLevel) !== Number(aqfLevel)) {
      return false;
    }

    // Tag filter
    if (tag && !course.tags?.some(t => t.toLowerCase().includes(tag.toLowerCase()))) {
      return false;
    }

    // Keyword filter
    if (keyword.trim()) {
      const q = keyword.toLowerCase();
      const matchTitle = course.title?.toLowerCase().includes(q);
      const matchCode = course.code?.toLowerCase().includes(q);
      const matchDesc = course.description?.toLowerCase().includes(q);
      const matchAuthor = course.authorName?.toLowerCase().includes(q);
      const matchUnits = course.units?.some(u =>
        u.unitTitle?.toLowerCase().includes(q) || u.unitCode?.toLowerCase().includes(q)
      );
      if (!matchTitle && !matchCode && !matchDesc && !matchAuthor && !matchUnits) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Publishes a course into the marketplace
 */
export async function publishCourseToMarketplace(course) {
  if (!course?.id) return;
  try {
    const raw = safeGetStorage(STORAGE_MARKETPLACE_COURSES);
    const list = raw ? JSON.parse(raw) : [];
    const filtered = list.filter(c => c.id !== course.id);
    filtered.unshift({ ...course, isPublished: true, publishedAt: Date.now() });
    safeSetStorage(STORAGE_MARKETPLACE_COURSES, JSON.stringify(filtered));
  } catch (err) {
    console.warn('Error saving to marketplace cache:', err);
  }
}
