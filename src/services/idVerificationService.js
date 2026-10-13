import { readEnv } from './env.js';
import { generateGeminiJson, GEMINI_ERROR } from './geminiClient.js';
/**
 * AI Identification Document Check (Gemini Vision) for teacher applications.
 *
 * The applicant's photo is sent to Gemini only to read it — it is never stored. Results are honest:
 * a 0-100 confidence score from Gemini, masked document numbers, and when Gemini is unavailable the
 * document is marked "Not verified" for manual review (never a made-up score). Applications are
 * never blocked by this check.
 */

const GEMINI_API_KEY =
  readEnv(() => import.meta.env.VITE_GEMINI_API_KEY, 'VITE_GEMINI_API_KEY') ||
  readEnv(() => import.meta.env.VITE_GEMINI_API_KEY_ALTERNATE, 'VITE_GEMINI_API_KEY_ALTERNATE') ||
  '';

export const ID_DOCUMENT_TYPES = Object.freeze(['Passport', 'Driver Licence', 'National ID', 'Teacher Registration Card', 'Student Card', 'Other ID', 'Not an identification document']);
export const ID_ASSESSMENTS = Object.freeze(['Likely Authentic', 'Manual Review Recommended', 'Suspicious', 'Not an ID document']);
export const NOT_VERIFIED = 'Not verified — manual review needed';

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    document_type: { type: 'string', enum: ID_DOCUMENT_TYPES },
    full_name: { type: 'string' },
    name_match: { type: 'boolean' },
    id_number_masked: { type: 'string' },
    issuing_authority: { type: 'string' },
    expiry_status: { type: 'string', enum: ['Valid', 'Expired', 'No expiry', 'Unreadable'] },
    authenticity_assessment: { type: 'string', enum: ID_ASSESSMENTS },
    confidence_score: { type: 'integer', minimum: 0, maximum: 100 },
    verification_notes: { type: 'string' }
  },
  required: ['document_type', 'full_name', 'name_match', 'id_number_masked', 'authenticity_assessment', 'confidence_score', 'verification_notes']
};

/** "data:image/jpeg;base64,…" -> { mimeType, data } (null when it is not an inline image). */
function parseImageDataUrl(dataUrl) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl || ''));
  return match ? { mimeType: match[1].toLowerCase(), data: match[2] } : null;
}

/** Never more than the last 3 characters of a document number are kept. */
export function maskIdNumber(value) {
  const visible = String(value || '').replace(/[^A-Za-z0-9]/g, '').slice(-3);
  return visible ? `****${visible}` : '';
}

function notVerified(reason) {
  return {
    verified: false,
    document_type: 'Not checked',
    full_name: '',
    name_match: null,
    id_number_masked: '',
    issuing_authority: '',
    expiry_status: '',
    authenticity_assessment: NOT_VERIFIED,
    confidence_score: null,
    verification_notes: reason,
    scanned_at: new Date().toISOString(),
    ai_engine: 'none'
  };
}

/** Older versions stored a simulated result (no AI) with a made-up score; it is never shown as verified. */
function isSimulatedResult(check) {
  return /heuristic fallback/i.test(String(check?.ai_engine || ''));
}

/** True only for a real AI check that produced a confidence score. */
export function hasVerifiedScore(check) {
  return Boolean(check) && typeof check === 'object' && check.verified !== false &&
    Number.isFinite(check.confidence_score) && !isSimulatedResult(check);
}

/** Keeps only known fields, bounded and typed (also used before an application is saved). */
export function sanitizeIdVerification(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const str = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
  const score = raw.confidence_score === null || raw.confidence_score === '' ? NaN : Number(raw.confidence_score);
  const verified = raw.verified !== false && Number.isFinite(score) && !isSimulatedResult(raw);
  return {
    verified,
    document_type: str(raw.document_type, 80) || (verified ? 'Other ID' : 'Not checked'),
    full_name: str(raw.full_name, 160),
    name_match: typeof raw.name_match === 'boolean' ? raw.name_match : null,
    id_number_masked: maskIdNumber(raw.id_number_masked),
    issuing_authority: str(raw.issuing_authority, 120),
    expiry_status: str(raw.expiry_status, 40),
    authenticity_assessment: verified ? (str(raw.authenticity_assessment, 80) || 'Manual Review Recommended') : NOT_VERIFIED,
    confidence_score: verified ? Math.max(0, Math.min(100, Math.round(score))) : null,
    verification_notes: str(raw.verification_notes, 600),
    scanned_at: str(raw.scanned_at, 40),
    ai_engine: str(raw.ai_engine, 80)
  };
}

function buildIdPrompt(applicantName, applicantEmail) {
  return `You check identification documents for OzEdu teacher applications.
Look at the attached image and report only what you can actually see. Be strict and honest: if the image is not an identification document, is unreadable, or shows signs of editing, say so and give a low confidence score.

Applicant's name: ${JSON.stringify(applicantName)}
Applicant's email: ${JSON.stringify(applicantEmail)}

Return a JSON object:
- document_type: one of ${ID_DOCUMENT_TYPES.map(t => `"${t}"`).join(', ')}
- full_name: the name printed on the document ("" if none is readable)
- name_match: true only if the printed name clearly matches the applicant's name
- id_number_masked: the document number with every character except the last 3 replaced by * ("" if none). Never return the full number.
- issuing_authority: the country, state or organisation that issued it ("" if unknown)
- expiry_status: "Valid", "Expired", "No expiry" or "Unreadable"
- authenticity_assessment: one of ${ID_ASSESSMENTS.map(t => `"${t}"`).join(', ')}
- confidence_score: integer 0-100 — how confident you are that this is a genuine, unaltered identification document belonging to the applicant (0 = not an ID or clearly altered, 100 = certain)
- verification_notes: one or two sentences on what you checked (photo, printed text, security features) and anything the reviewer should look at`;
}

/**
 * Asks Gemini to check an uploaded ID image. Never throws except when `signal` aborts: if the check
 * cannot run, the result says "Not verified" so a person reviews the document link instead.
 * @param {string} imageDataUrl inline image data URL (already downscaled by the form)
 * @param {{ name?: string, email?: string }} applicantInfo
 */
export async function analyzeIdentificationDocument(imageDataUrl, applicantInfo = {}, { apiKey = GEMINI_API_KEY, models, fetchImpl, signal } = {}) {
  const image = parseImageDataUrl(imageDataUrl);
  if (!image) return notVerified('The file could not be read as an image, so it was not checked.');
  if (!apiKey) return notVerified('The AI document check is not set up on this site. The Super Admin will review the document link manually.');
  try {
    const { data, model } = await generateGeminiJson({
      prompt: buildIdPrompt(String(applicantInfo.name || 'Applicant'), String(applicantInfo.email || '')),
      images: [image],
      apiKey,
      models,
      fetchImpl,
      signal,
      responseJsonSchema: RESULT_SCHEMA,
      maxOutputTokens: 4096,
      attemptTimeoutMs: 30000,
      deadlineMs: 60000,
      label: 'ID document check'
    });
    return sanitizeIdVerification({ ...data, verified: true, scanned_at: new Date().toISOString(), ai_engine: `Gemini (${model})` });
  } catch (err) {
    if (err?.code === GEMINI_ERROR.ABORTED) throw err;
    console.warn('ID document check unavailable:', err?.message || err);
    return notVerified(err?.code === GEMINI_ERROR.BLOCKED
      ? 'Gemini declined to read this image. The Super Admin will review the document link manually.'
      : 'The AI document check is unavailable right now. The Super Admin will review the document link manually.');
  }
}
