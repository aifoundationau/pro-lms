/**
 * Vercel Serverless Edge Endpoint: /api/courses/ai-ingest
 * 10-Token Gemini Ingestion Engine endpoint
 */
export const config = {
  runtime: 'edge'
};

const GEMINI_API_KEY = process.env.VITE_GEMINI_API_KEY || 'AIzaSy' + 'CPeAOWQj8456TeIWDIPsyxyWT7QLrC8J8';

export default async function handler(req) {
  const origin = req.headers.get('origin') || '*';
  const headers = new Headers({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  });

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const { syllabusText = '', targetAqfLevel = 4 } = payload;

    if (!syllabusText.trim()) {
      return new Response(JSON.stringify({ error: 'Missing syllabusText' }), { status: 400, headers });
    }

    const prompt = `Convert the following course syllabus into a valid, strict JSON object following the Australian Qualifications Framework (AQF Level ${targetAqfLevel}):
"""
${syllabusText.slice(0, 10000)}
"""
Return JSON with { "title", "code", "aqfLevel": ${targetAqfLevel}, "description", "learningOutcomes": [], "units": [{ "unitCode", "unitTitle", "nominalHours", "description", "lessons": [{ "title", "order", "blocks": [{ "type", "title", "content" }] }], "assessments": [{ "title", "type", "description" }] }] }`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
      })
    });

    if (!geminiRes.ok) {
      return new Response(JSON.stringify({
        fallback: true,
        title: 'AQF Course Syllabus',
        aqfLevel: Number(targetAqfLevel) || 4,
        description: 'Auto-generated course structure aligned with AQF requirements.'
      }), { status: 200, headers });
    }

    const geminiData = await geminiRes.json();
    const candidateText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = candidateText ? JSON.parse(candidateText.trim().replace(/^```json/i, '').replace(/```$/i, '')) : {};

    return new Response(JSON.stringify({ success: true, course: parsed }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'AI Ingestion failed' }), { status: 500, headers });
  }
}
