/**
 * Vercel Serverless Edge Endpoint: /api/lms/categories
 * Cross-App Categories API
 * Returns all educational curriculum categories tagged with 'lms'.
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

const LMS_CATEGORIES_DATA = [
  {
    id: 'cat-ai-data-science',
    slug: 'ai-data-science',
    name: 'Artificial Intelligence & Data Science',
    description: 'Deep Learning, LLMs, Neural Networks, Computer Vision, MLOps, and Predictive Analytics.',
    aqfLevels: [4, 5, 6, 7, 8, 9],
    tag: 'lms',
    tags: ['lms', 'category', 'ai-data-science'],
    courseCount: 78
  },
  {
    id: 'cat-computer-science-software',
    slug: 'computer-science-software',
    name: 'Computer Science & Software Systems',
    description: 'React, TypeScript, Distributed Systems, Compilers, Cloud Computing, and Algorithms.',
    aqfLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    tag: 'lms',
    tags: ['lms', 'category', 'computer-science-software'],
    courseCount: 78
  },
  {
    id: 'cat-cybersecurity-infosec',
    slug: 'cybersecurity-infosec',
    name: 'Cybersecurity & InfoSec',
    description: 'Perimeter Defense, STRIDE Threat Modeling, Cryptography, and Security Governance.',
    aqfLevels: [4, 5, 6, 7, 8],
    tag: 'lms',
    tags: ['lms', 'category', 'cybersecurity-infosec'],
    courseCount: 78
  },
  {
    id: 'cat-medicine-health',
    slug: 'medicine-health',
    name: 'Medicine & Health Sciences',
    description: 'Anatomy, Clinical Pharmacology, Epidemiology, Health Informatics, and Patient Care.',
    aqfLevels: [4, 5, 6, 7, 8, 9],
    tag: 'lms',
    tags: ['lms', 'category', 'medicine-health'],
    courseCount: 78
  },
  {
    id: 'cat-business-management',
    slug: 'business-management',
    name: 'Business & Management',
    description: 'Organizational Leadership, Strategic Operations, Agile Product Management, and Marketing.',
    aqfLevels: [1, 2, 3, 4, 5, 6, 7],
    tag: 'lms',
    tags: ['lms', 'category', 'business-management'],
    courseCount: 78
  },
  {
    id: 'cat-finance-economics',
    slug: 'finance-economics',
    name: 'Finance & Economics',
    description: 'Corporate Finance, Quantitative Financial Modeling, Macroeconomics, and Asset Pricing.',
    aqfLevels: [4, 5, 6, 7, 8, 9],
    tag: 'lms',
    tags: ['lms', 'category', 'finance-economics'],
    courseCount: 78
  },
  {
    id: 'cat-law-governance',
    slug: 'law-governance',
    name: 'Law & Governance',
    description: 'Constitutional Law, Intellectual Property, AI Governance, and International Treaties.',
    aqfLevels: [5, 6, 7, 8, 9],
    tag: 'lms',
    tags: ['lms', 'category', 'law-governance'],
    courseCount: 78
  },
  {
    id: 'cat-engineering-physics',
    slug: 'engineering-physics',
    name: 'Engineering & Applied Physics',
    description: 'Robotics, Structural Engineering, Thermodynamics, and Quantum Mechanics.',
    aqfLevels: [4, 5, 6, 7, 8, 9],
    tag: 'lms',
    tags: ['lms', 'category', 'engineering-physics'],
    courseCount: 78
  },
  {
    id: 'cat-environmental-science',
    slug: 'environmental-science',
    name: 'Environmental Science',
    description: 'Climate Dynamics, Renewable Energy Systems, Carbon Accounting, and Ecology.',
    aqfLevels: [3, 4, 5, 6, 7, 8],
    tag: 'lms',
    tags: ['lms', 'category', 'environmental-science'],
    courseCount: 78
  },
  {
    id: 'cat-psychology-behaviour',
    slug: 'psychology-behaviour',
    name: 'Psychology & Behavioural Sciences',
    description: 'Cognitive Neuroscience, Behavioral Economics, Psychometrics, and Counseling.',
    aqfLevels: [4, 5, 6, 7, 8, 9],
    tag: 'lms',
    tags: ['lms', 'category', 'psychology-behaviour'],
    courseCount: 78
  },
  {
    id: 'cat-design-architecture',
    slug: 'design-architecture',
    name: 'Design & Architecture',
    description: 'UI/UX Design Systems, Spatial Architecture, Sustainable Materials, and 3D Modeling.',
    aqfLevels: [2, 3, 4, 5, 6, 7],
    tag: 'lms',
    tags: ['lms', 'category', 'design-architecture'],
    courseCount: 78
  },
  {
    id: 'cat-humanities-languages',
    slug: 'humanities-languages',
    name: 'Humanities & Languages',
    description: 'Comparative Linguistics, Digital Humanities, Historical Epistemology, and Philosophy.',
    aqfLevels: [1, 2, 3, 4, 5, 6, 7, 8],
    tag: 'lms',
    tags: ['lms', 'category', 'humanities-languages'],
    courseCount: 78
  }
];

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS_HEADERS });
  }

  return new Response(JSON.stringify({
    success: true,
    tag: 'lms',
    total: LMS_CATEGORIES_DATA.length,
    categories: LMS_CATEGORIES_DATA
  }), { status: 200, headers: CORS_HEADERS });
}
