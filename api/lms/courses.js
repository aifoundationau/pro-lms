/**
 * Vercel Serverless Edge Endpoint: /api/lms/courses
 * Cross-App Course Discovery & Distribution API
 * Allows external websites and mobile apps to draw LMS courses tagged with 'lms'.
 */

export const config = {
  runtime: 'edge'
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-lms-tag',
  'Content-Type': 'application/json'
};

const SAMPLE_LMS_COURSES = [
  {
    id: '101',
    title: 'Advanced React 19 Patterns & Concurrent Architectures',
    code: 'ICT-REACT19',
    category: 'Computer Science & Software Systems',
    aqfLevel: 7,
    nominalHours: 60,
    author: 'Prof. Michael Stonebraker Institute',
    students: 304,
    tag: 'lms',
    tags: ['lms', 'Computer Science & Software Systems', 'React', 'Frontend'],
    description: 'Master concurrent rendering, server components, actions, and resilient state machines.'
  },
  {
    id: '102',
    title: 'Data Structures & Algorithmic Complexity in Python',
    code: 'ICT-DSA201',
    category: 'Computer Science & Software Systems',
    aqfLevel: 5,
    nominalHours: 45,
    author: 'Dr. Clara Oswald',
    students: 890,
    tag: 'lms',
    tags: ['lms', 'Computer Science & Software Systems', 'Python', 'Algorithms'],
    description: 'In-depth analysis of trees, graphs, dynamic programming, and amortized time bounds.'
  },
  {
    id: '103',
    title: 'Deep Learning & Convolutional Neural Architectures',
    code: 'AI-DL401',
    category: 'Artificial Intelligence & Data Science',
    aqfLevel: 8,
    nominalHours: 80,
    author: 'Prof. Eleanor Vance, PhD',
    students: 1200,
    tag: 'lms',
    tags: ['lms', 'Artificial Intelligence & Data Science', 'Deep Learning', 'PyTorch'],
    description: 'Theoretical foundations and production deployment of transformers, CNNs, and attention mechanisms.'
  },
  {
    id: '104',
    title: 'Perimeter Defense & Threat Modeling Frameworks',
    code: 'SEC-PER501',
    category: 'Cybersecurity & InfoSec',
    aqfLevel: 6,
    nominalHours: 50,
    author: 'Prof. Marcus Vance',
    students: 450,
    tag: 'lms',
    tags: ['lms', 'Cybersecurity & InfoSec', 'STRIDE', 'Network Security'],
    description: 'Enterprise penetration testing methodologies, STRIDE risk evaluation, and ISO 27001 compliance.'
  },
  {
    id: 'mkt_aqf4_webdev',
    title: 'Certificate IV in Information Technology: Web Development',
    code: 'ICT40120',
    category: 'Computer Science & Software Systems',
    aqfLevel: 4,
    nominalHours: 120,
    author: 'Dr. Sarah Mitchell',
    students: 620,
    tag: 'lms',
    tags: ['lms', 'AQF4', 'ICT40120', 'Web Development'],
    description: 'Complete Australian Qualifications Framework Level 4 curriculum with units, assessments, and rubric grading.'
  }
];

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS_HEADERS });
  }

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    const category = url.searchParams.get('category') || 'ALL';
    const aqfLevel = url.searchParams.get('aqfLevel') || 'ALL';
    const tag = url.searchParams.get('tag') || 'lms';
    const keyword = (url.searchParams.get('q') || url.searchParams.get('keyword') || '').toLowerCase().trim();
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));

    // If requesting a specific course by ID
    if (id) {
      const match = SAMPLE_LMS_COURSES.find(c => String(c.id) === String(id));
      if (match) {
        return new Response(JSON.stringify({
          success: true,
          tag: 'lms',
          course: { ...match, tag: 'lms' }
        }), { status: 200, headers: CORS_HEADERS });
      }
    }

    // Draft courses are private to their author and never exposed publicly
    let results = SAMPLE_LMS_COURSES.filter(c =>
      (c.tag === tag || (c.tags && c.tags.includes(tag))) &&
      !c.isDraft && c.status !== 'draft' && !c.tags?.includes('Draft')
    );

    if (category && category !== 'ALL') {
      results = results.filter(c => (c.category || '').toLowerCase() === category.toLowerCase());
    }

    if (aqfLevel && aqfLevel !== 'ALL') {
      results = results.filter(c => Number(c.aqfLevel) === Number(aqfLevel));
    }

    if (keyword) {
      results = results.filter(c =>
        c.title.toLowerCase().includes(keyword) ||
        c.code.toLowerCase().includes(keyword) ||
        c.description.toLowerCase().includes(keyword)
      );
    }

    return new Response(JSON.stringify({
      success: true,
      tag: 'lms',
      total: results.length,
      limit,
      courses: results.slice(0, limit)
    }), { status: 200, headers: CORS_HEADERS });

  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err.message || 'Internal error'
    }), { status: 500, headers: CORS_HEADERS });
  }
}
