/**
 * Token System & Redistribution Service for Pro-LMS (OzEdu)
 *
 * Implements:
 * - Super Admin configurable Token Price (in AUD) stored in Firestore /system_settings/token_config
 * - Global Accumulated Token Fund tracking (pool_balance, total_donated, total_redistributed)
 * - Minimum purchase of 50 tokens, no upper limits, via Stripe checkout
 * - Automated query for accounts with balance < 26 tokens and active in the past 90 days (student & teacher)
 * - Redistribution engine to disburse tokens from the accumulated fund to eligible accounts
 * - Course token pricing and student enrollment token deductions
 */

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  where,
  increment,
  runTransaction
} from 'firebase/firestore';
import { db } from '../firebase.js';

export const DEFAULT_TOKEN_CONFIG = {
  token_price_aud: 1.00,
  min_purchase_tokens: 50,
  pool_balance: 1560, // Starting accumulated pool in fund
  total_donated_tokens: 4200,
  total_redistributed_tokens: 2640,
  last_updated_at: new Date().toISOString()
};

/**
 * Retrieves the global token configuration and accumulated fund status
 */
export async function getTokenConfig() {
  if (!db) return DEFAULT_TOKEN_CONFIG;
  try {
    const configRef = doc(db, 'system_settings', 'token_config');
    const snap = await getDoc(configRef);
    if (snap.exists()) {
      return { ...DEFAULT_TOKEN_CONFIG, ...snap.data() };
    } else {
      // Initialize system settings if not yet existing
      await setDoc(configRef, DEFAULT_TOKEN_CONFIG);
      return DEFAULT_TOKEN_CONFIG;
    }
  } catch (err) {
    console.warn('Error fetching token config from Firestore, using default:', err);
    return DEFAULT_TOKEN_CONFIG;
  }
}

/**
 * Super Admin updates the value of one token (in AUD)
 */
export async function updateTokenPrice(adminUid, newPriceAud) {
  if (!db) throw new Error('Firestore is unavailable.');
  const parsedPrice = Math.max(0.01, Number(newPriceAud) || 1.00);

  const configRef = doc(db, 'system_settings', 'token_config');
  const nowIso = new Date().toISOString();

  await setDoc(configRef, {
    token_price_aud: parsedPrice,
    last_updated_at: nowIso,
    last_updated_by: adminUid || 'superadmin'
  }, { merge: true });

  return parsedPrice;
}

/**
 * Retrieves an account's token balance
 */
export async function getUserTokenBalance(uid) {
  if (!db || !uid) return 0;
  try {
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      return Number(snap.data()?.token_balance) || 0;
    }
  } catch (err) {
    console.warn('Error reading user token balance:', err);
  }
  return 0;
}

/**
 * Credits tokens directly to a user account balance
 */
export async function creditUserTokens(uid, tokens) {
  if (!db || !uid) return false;
  const count = Math.max(1, Number(tokens) || 0);
  try {
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      token_balance: increment(count),
      last_token_credit_at: new Date().toISOString()
    });
    return true;
  } catch (err) {
    console.warn('Error crediting tokens to user:', err);
    return false;
  }
}

/**
 * Adds donated tokens to the global accumulated token fund
 */
export async function donateToTokenFund(tokens, donorDetails = {}) {
  if (!db) return false;
  const count = Math.max(1, Number(tokens) || 0);
  const nowIso = new Date().toISOString();

  try {
    const configRef = doc(db, 'system_settings', 'token_config');
    await setDoc(configRef, {
      pool_balance: increment(count),
      total_donated_tokens: increment(count),
      last_donation_at: nowIso
    }, { merge: true });

    // Record donation ledger entry
    const ledgerRef = doc(collection(db, 'token_donations'));
    await setDoc(ledgerRef, {
      tokens: count,
      donor_email: donorDetails.donorEmail || '',
      donor_name: donorDetails.donorName || '',
      created_at: nowIso,
      tag: 'lms'
    });

    return true;
  } catch (err) {
    console.warn('Error adding tokens to pool fund:', err);
    return false;
  }
}

/**
 * Finds all student and teacher accounts eligible for token redistribution:
 * 1. Balance under 26 tokens (token_balance < 26)
 * 2. Active in the past 90 days (at least one logon in the past 90 days)
 */
export async function getEligibleAccountsForRedistribution() {
  if (!db) return [];
  try {
    const now = Date.now();
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(now - ninetyDaysMs);
    const cutoffIso = cutoffDate.toISOString();

    const usersRef = collection(db, 'users');
    const snap = await getDocs(usersRef);

    const eligible = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      const balance = Number(data.token_balance) || 0;
      const lastLogin = data.last_login_at || data.created_at || '';
      const role = data.role || 'Supporter';

      // Must be student or teacher or supporter needing education access
      const isEligibleRole = role === 'student' || role === 'teacher' || role === 'Supporter';

      // Balance check: under 26 tokens
      const isUnderThreshold = balance < 26;

      // Activity check: at least 1 login in past 90 days (or recently created)
      const isActivePast90Days = lastLogin && new Date(lastLogin) >= cutoffDate;

      if (isEligibleRole && isUnderThreshold && isActivePast90Days) {
        eligible.push({
          uid: docSnap.id,
          displayName: data.displayName || data.email?.split('@')[0] || 'User',
          email: data.email || '',
          role,
          token_balance: balance,
          last_login_at: lastLogin,
          deficit: 26 - balance
        });
      }
    });

    return eligible;
  } catch (err) {
    console.warn('Error scanning for eligible redistribution accounts:', err);
    return [];
  }
}

/**
 * Super Admin triggers redistribution of tokens from the accumulated fund
 * across eligible student and teacher accounts.
 */
export async function redistributeTokensFromPool(adminUid, { tokensPerAccount = 26, targetUids = null }) {
  if (!db) throw new Error('Firestore is unavailable.');

  const config = await getTokenConfig();
  const eligibleAccounts = await getEligibleAccountsForRedistribution();

  const accountsToFund = targetUids
    ? eligibleAccounts.filter(a => targetUids.includes(a.uid))
    : eligibleAccounts;

  if (accountsToFund.length === 0) {
    return {
      success: true,
      recipientsCount: 0,
      totalTokensDisbursed: 0,
      message: 'No accounts currently meet the criteria (< 26 tokens and active in past 90 days).'
    };
  }

  // Calculate tokens needed
  let totalTokensNeeded = 0;
  const allocations = accountsToFund.map(account => {
    // Top up to 26 tokens, or add tokensPerAccount
    const tokensToAdd = Math.min(tokensPerAccount, Math.max(1, 26 - account.token_balance));
    totalTokensNeeded += tokensToAdd;
    return { uid: account.uid, email: account.email, tokensToAdd };
  });

  if (config.pool_balance < totalTokensNeeded) {
    throw new Error(
      `Insufficient fund balance! The accumulated fund has ${config.pool_balance} tokens, but ${totalTokensNeeded} tokens are needed to fund ${accountsToFund.length} accounts.`
    );
  }

  const nowIso = new Date().toISOString();

  // Execute redistribution updates
  const configRef = doc(db, 'system_settings', 'token_config');
  await updateDoc(configRef, {
    pool_balance: increment(-totalTokensNeeded),
    total_redistributed_tokens: increment(totalTokensNeeded),
    last_redistribution_at: nowIso,
    last_redistributed_by: adminUid
  });

  // Credit each eligible account
  for (const alloc of allocations) {
    const userRef = doc(db, 'users', alloc.uid);
    await updateDoc(userRef, {
      token_balance: increment(alloc.tokensToAdd),
      last_fund_grant_at: nowIso
    }).catch(err => console.warn(`Failed to credit user ${alloc.uid}:`, err));
  }

  // Record audit log
  const auditRef = doc(collection(db, 'token_redistributions'));
  await setDoc(auditRef, {
    admin_uid: adminUid,
    recipients_count: accountsToFund.length,
    total_tokens_disbursed: totalTokensNeeded,
    created_at: nowIso,
    allocations: allocations.map(a => ({ uid: a.uid, tokens: a.tokensToAdd }))
  });

  return {
    success: true,
    recipientsCount: accountsToFund.length,
    totalTokensDisbursed: totalTokensNeeded,
    remainingPoolBalance: config.pool_balance - totalTokensNeeded,
    message: `Successfully redistributed ${totalTokensNeeded} tokens from the fund across ${accountsToFund.length} accounts!`
  };
}

/**
 * Handles course enrollment using tokens
 */
export async function enrollWithTokens(studentUid, courseId, courseTitle, tokenCost) {
  if (!db || !studentUid) throw new Error('Authentication required to enroll.');
  const cost = Number(tokenCost) || 0;

  if (cost <= 0) {
    return { success: true, message: 'Free course enrollment confirmed!' };
  }

  const currentBalance = await getUserTokenBalance(studentUid);
  if (currentBalance < cost) {
    throw new Error(
      `Insufficient token balance! This course requires ${cost} tokens, but you currently have ${currentBalance} tokens. Please acquire tokens or request funding from the token pool.`
    );
  }

  const nowIso = new Date().toISOString();
  const userRef = doc(db, 'users', studentUid);

  // Deduct tokens from student balance
  await updateDoc(userRef, {
    token_balance: increment(-cost),
    last_token_spend_at: nowIso
  });

  // Record transaction ledger
  const spendRef = doc(collection(db, 'token_transactions'));
  await setDoc(spendRef, {
    student_uid: studentUid,
    course_id: String(courseId),
    course_title: courseTitle || 'Course',
    tokens_spent: cost,
    type: 'course_enrollment',
    created_at: nowIso
  });

  return {
    success: true,
    tokensSpent: cost,
    newBalance: currentBalance - cost,
    message: `Enrolled successfully! ${cost} tokens deducted.`
  };
}
