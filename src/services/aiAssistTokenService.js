/**
 * ✨ AI Assist Token Metering
 *
 * - Flat fee per AI Assist full-course generation (default 10 tokens).
 * - Super Admin sets the fee (whole numbers 0–10) via
 *   /system_settings/token_config.ai_course_assist_cost_tokens.
 * - Charity Teachers always pay 0 (enforced by the caller). A fee of 0 is free for everyone.
 * - Deductions run in a Firestore transaction so the balance can never go negative.
 */

import { doc, getDoc, setDoc, collection, runTransaction } from 'firebase/firestore';
import { db } from '../firebase.js';

export const DEFAULT_AI_ASSIST_COST_TOKENS = 10;
export const MAX_AI_ASSIST_COST_TOKENS = 10;
const READ_TIMEOUT_MS = 8000;

/** Validates an untrusted fee value: whole number 0–10, otherwise the default 10. */
export function normalizeAiAssistCost(value) {
  if (value === null || value === undefined || value === '') return DEFAULT_AI_ASSIST_COST_TOKENS;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_AI_ASSIST_COST_TOKENS) return DEFAULT_AI_ASSIST_COST_TOKENS;
  return n;
}

export function hasSufficientTokens(balance, cost) {
  return (Number(balance) || 0) >= (Number(cost) || 0);
}

function insufficientTokensError(balance, cost) {
  const err = new Error(
    `Insufficient tokens. Requires ${cost} tokens, current balance is ${Number(balance) || 0} tokens.`
  );
  err.code = 'INSUFFICIENT_TOKENS';
  err.requiredTokens = cost;
  err.currentBalance = Number(balance) || 0;
  return err;
}

/** Returns the post-deduction balance, or throws INSUFFICIENT_TOKENS. */
export function computeBalanceAfterDeduction(currentBalance, cost) {
  const balance = Number(currentBalance) || 0;
  if (!hasSufficientTokens(balance, cost)) throw insufficientTokensError(balance, cost);
  return balance - cost;
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Reads the Super Admin configured fee. Never throws (falls back to 10). */
export async function getAiAssistCostTokens() {
  if (!db) return DEFAULT_AI_ASSIST_COST_TOKENS;
  try {
    const snap = await withTimeout(getDoc(doc(db, 'system_settings', 'token_config')), READ_TIMEOUT_MS, 'AI Assist fee lookup');
    return normalizeAiAssistCost(snap.exists() ? snap.data()?.ai_course_assist_cost_tokens : undefined);
  } catch (err) {
    console.warn('AI assist fee lookup failed, using default:', err);
    return DEFAULT_AI_ASSIST_COST_TOKENS;
  }
}

/** Super Admin updates the fee (whole numbers 0–10). */
export async function updateAiAssistCostTokens(adminUid, newCost) {
  if (!db) throw new Error('Firestore is unavailable.');
  const n = Number(newCost);
  if (!Number.isInteger(n) || n < 0 || n > MAX_AI_ASSIST_COST_TOKENS) {
    throw new Error(`The AI Assist fee must be a whole number from 0 to ${MAX_AI_ASSIST_COST_TOKENS}.`);
  }
  await setDoc(doc(db, 'system_settings', 'token_config'), {
    ai_course_assist_cost_tokens: n,
    ai_course_assist_cost_updated_at: new Date().toISOString(),
    ai_course_assist_cost_updated_by: adminUid || 'superadmin'
  }, { merge: true });
  return n;
}

/**
 * Transactional token deduction (used by ✨ AI Assist).
 * Throws INSUFFICIENT_TOKENS when the balance is too low.
 */
export async function deductUserTokens(userId, amount, { type = 'token_spend', note = '' } = {}) {
  const cost = Number(amount);
  if (!Number.isFinite(cost) || cost <= 0) return { tokensCharged: 0, newBalance: null };
  if (!db || !userId) throw new Error('Token service is unavailable. Please try again shortly.');

  const userRef = doc(db, 'users', userId);
  const newBalance = await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef);
    const next = computeBalanceAfterDeduction(snap.exists() ? snap.data()?.token_balance : 0, cost);
    tx.update(userRef, { token_balance: next, last_token_spend_at: new Date().toISOString() });
    return next;
  });

  setDoc(doc(collection(db, 'token_transactions')), {
    student_uid: userId,
    tokens_spent: cost,
    type,
    note: String(note).slice(0, 200),
    created_at: new Date().toISOString(),
    tag: 'lms'
  }).catch(err => console.warn('Token ledger write skipped:', err?.message || err));

  return { tokensCharged: cost, newBalance };
}
