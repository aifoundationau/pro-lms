/**
 * Resilient Gemini JSON client (REST `generateContent`, which Google keeps fully supported).
 *
 * - Model fallback chain: the newest stable Flash model first. Older models are tried only when a
 *   newer one is unavailable to this API key (403/404), overloaded (429/5xx), times out, or
 *   returns unusable output. gemini-2.5-flash is last: since Sept 2026 Google only serves it to
 *   keys that used it before.
 * - Per-attempt timeout plus an overall deadline, and one backoff retry on the first transient error.
 * - Gemini 3.x deprecates temperature/topP/topK, so no sampling parameters are sent. A request the
 *   API rejects with 400 is retried once without the optional schema/thinking settings.
 * - Invalid/disabled API keys fail fast (no point trying other models).
 */

import { DEFAULT_GEMINI_KEY } from './geminiCourseService.js';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export const GEMINI_MODEL_CHAIN = Object.freeze([
  Object.freeze({ id: 'gemini-3.8-flash', thinking: Object.freeze({ thinkingLevel: 'low' }) }),
  Object.freeze({ id: 'gemini-3.6-flash', thinking: Object.freeze({ thinkingLevel: 'low' }) }),
  Object.freeze({ id: 'gemini-flash-latest', thinking: null }), // alias: target model changes over time
  Object.freeze({ id: 'gemini-2.5-flash', thinking: Object.freeze({ thinkingBudget: 0 }) })
]);

export const GEMINI_ERROR = Object.freeze({
  NO_KEY: 'GEMINI_NO_KEY',
  AUTH: 'GEMINI_AUTH',
  BLOCKED: 'GEMINI_BLOCKED',
  UNAVAILABLE: 'GEMINI_UNAVAILABLE',
  ABORTED: 'GEMINI_ABORTED'
});

export class GeminiError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GeminiError';
    this.code = code;
    Object.assign(this, details);
  }
}

const FATAL_KEY_REASONS = new Set([
  'API_KEY_INVALID',
  'API_KEY_EXPIRED',
  'SERVICE_DISABLED',
  'API_KEY_SERVICE_BLOCKED',
  'CONSUMER_SUSPENDED',
  'BILLING_DISABLED'
]);

function abortError() {
  return new GeminiError(GEMINI_ERROR.ABORTED, 'The AI request was cancelled.');
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Strips Markdown fences / preamble and parses the JSON object a model returned. */
export function parseJsonFromModelText(text) {
  const raw = String(text ?? '').trim();
  if (!raw) throw new Error('empty response');
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(unfenced.slice(start, end + 1));
    throw new Error('response was not JSON');
  }
}

function buildRequestBody(prompt, { responseJsonSchema, thinking, maxOutputTokens, images = [] }) {
  const generationConfig = { responseMimeType: 'application/json', maxOutputTokens };
  if (responseJsonSchema) generationConfig.responseJsonSchema = responseJsonSchema;
  if (thinking) generationConfig.thinkingConfig = { ...thinking };
  const imageParts = images.map(image => ({ inlineData: { mimeType: image.mimeType, data: image.data } }));
  return { contents: [{ role: 'user', parts: [...imageParts, { text: String(prompt) }] }], generationConfig };
}

/** One HTTP attempt; the timeout covers both the response and reading its body. */
async function requestOnce(fetchImpl, url, init, timeoutMs, parentSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });

  const timeoutError = () => Object.assign(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`), { name: 'TimeoutError' });
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    let json = null;
    try {
      json = typeof res?.json === 'function' ? await res.json() : null;
    } catch {
      json = null;
    }
    if (timedOut) throw timeoutError();
    return { ok: Boolean(res?.ok), status: Number(res?.status) || 0, json };
  } catch (err) {
    if (timedOut) throw timeoutError();
    throw err;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

function parseRetryDelayMs(value) {
  const match = /^(\d+(?:\.\d+)?)s$/.exec(String(value || '').trim());
  return match ? Math.round(Number(match[1]) * 1000) : 0;
}

function readErrorInfo(status, json) {
  const error = json?.error && typeof json.error === 'object' ? json.error : {};
  const details = Array.isArray(error.details) ? error.details : [];
  const reason = details.map(d => d?.reason).find(r => typeof r === 'string') || '';
  const retryInfo = details.find(d => String(d?.['@type'] || '').includes('RetryInfo'));
  return {
    status,
    message: String(error.message || `HTTP ${status}`).slice(0, 300),
    reason,
    retryDelayMs: parseRetryDelayMs(retryInfo?.retryDelay)
  };
}

function isFatalKeyError(info) {
  return FATAL_KEY_REASONS.has(info.reason) || info.status === 401 || (info.status === 400 && /api key/i.test(info.message));
}

/** Interprets a 200 response: { data } on success, { blocked } or { error } otherwise. */
function interpretResponse(json) {
  if (!json || typeof json !== 'object') return { error: 'empty response' };
  if (json.promptFeedback?.blockReason) return { blocked: String(json.promptFeedback.blockReason) };
  const candidate = Array.isArray(json.candidates) ? json.candidates[0] : null;
  if (!candidate) return { error: 'no candidates returned' };
  const finishReason = String(candidate.finishReason || '');
  const parts = Array.isArray(candidate.content?.parts) ? candidate.content.parts : [];
  const text = parts.filter(p => p && !p.thought && typeof p.text === 'string').map(p => p.text).join('');
  if (!text.trim()) return { error: finishReason ? `no text (finishReason ${finishReason})` : 'no text returned' };
  let data;
  try {
    data = parseJsonFromModelText(text);
  } catch {
    return { error: finishReason === 'MAX_TOKENS' ? 'response was cut off (MAX_TOKENS)' : 'response was not valid JSON' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'response JSON was not an object' };
  return { data, finishReason };
}

/**
 * Sends one prompt and returns the parsed JSON object.
 *
 * @returns {Promise<{ data: object, model: string, finishReason: string }>}
 * @throws {GeminiError} NO_KEY | AUTH | BLOCKED | UNAVAILABLE | ABORTED
 */
export async function generateGeminiJson({
  prompt,
  images = [], // optional [{ mimeType: 'image/jpeg', data: '<base64>' }] sent before the prompt
  apiKey = DEFAULT_GEMINI_KEY,
  models = GEMINI_MODEL_CHAIN,
  responseJsonSchema = null,
  maxOutputTokens = 16384,
  attemptTimeoutMs = 90000,
  deadlineMs = 180000,
  retryDelayMs = 1200,
  signal,
  fetchImpl = globalThis.fetch,
  label = 'Gemini request'
} = {}) {
  if (!apiKey) {
    throw new GeminiError(GEMINI_ERROR.NO_KEY, 'Gemini AI is not configured (VITE_GEMINI_API_KEY is missing).');
  }
  if (typeof fetchImpl !== 'function') {
    throw new GeminiError(GEMINI_ERROR.UNAVAILABLE, 'Network access is unavailable.');
  }

  const startedAt = Date.now();
  const failures = [];
  let transientRetryUsed = false;

  for (const model of models) {
    let simplified = false;
    const url = `${GEMINI_ENDPOINT}/${encodeURIComponent(model.id)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal?.aborted) throw abortError();
      const remaining = deadlineMs - (Date.now() - startedAt);
      if (remaining < 2000) {
        failures.push('overall time limit reached');
        throw new GeminiError(GEMINI_ERROR.UNAVAILABLE, `Gemini did not respond in time (${failures.slice(-3).join('; ')}).`, { failures });
      }

      const body = buildRequestBody(prompt, {
        responseJsonSchema: simplified ? null : responseJsonSchema,
        thinking: simplified ? null : model.thinking,
        maxOutputTokens,
        images: Array.isArray(images) ? images : []
      });

      let response;
      try {
        response = await requestOnce(fetchImpl, url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }, Math.min(attemptTimeoutMs, remaining), signal);
      } catch (err) {
        if (signal?.aborted) throw abortError();
        failures.push(`${model.id}: ${err?.name === 'TimeoutError' ? err.message : 'network error'}`);
        if (!transientRetryUsed) {
          transientRetryUsed = true;
          await sleep(retryDelayMs, signal);
          continue;
        }
        break;
      }

      if (response.ok) {
        const outcome = interpretResponse(response.json);
        if (outcome.data) return { data: outcome.data, model: model.id, finishReason: outcome.finishReason };
        if (outcome.blocked) {
          throw new GeminiError(GEMINI_ERROR.BLOCKED, `Gemini declined this request (${outcome.blocked}). Remove sensitive content and try again.`);
        }
        failures.push(`${model.id}: ${outcome.error}`);
        console.warn(`[Gemini] ${label}: ${model.id} returned unusable output (${outcome.error}).`);
        break;
      }

      const info = readErrorInfo(response.status, response.json);
      if (isFatalKeyError(info)) {
        throw new GeminiError(GEMINI_ERROR.AUTH, `Gemini rejected the API key: ${info.message}`);
      }
      if (info.status === 400 && !simplified && (responseJsonSchema || model.thinking)) {
        simplified = true; // retry once without optional schema/thinking settings
        failures.push(`${model.id}: 400 ${info.message}`);
        continue;
      }
      if ((info.status === 429 || info.status >= 500) && !transientRetryUsed) {
        transientRetryUsed = true;
        await sleep(Math.min(8000, Math.max(retryDelayMs, info.retryDelayMs)), signal);
        continue;
      }
      failures.push(`${model.id}: ${info.status} ${info.message}`);
      console.warn(`[Gemini] ${label}: ${model.id} failed with ${info.status} ${info.message}`);
      break;
    }
  }

  throw new GeminiError(
    GEMINI_ERROR.UNAVAILABLE,
    `Gemini is unavailable right now (${failures.slice(-3).join('; ') || 'no models responded'}).`,
    { failures }
  );
}
