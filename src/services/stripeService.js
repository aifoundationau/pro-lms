/**
 * Client Stripe Payment Service for Pro-LMS
 * Handles student sponsorships and global token pool donations
 */

export const STRIPE_PUBLISHABLE_KEY =
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ||
  'pk_test_51UKnKUI8bClhBF4Pl59doST5JkSHIg47DaHs5bicuWUEM0iuyT6BtcVV2zlvZUAAL5HjnRNt5PAzJQETRIckLarb00o6jAlzpi';

/**
 * Initiates Stripe Checkout for:
 * 1. Token Pool Donation or Token Purchase (minimum 50 tokens, no limits)
 * 2. Student Sponsorship ($52 AUD)
 */
export async function createCheckoutSession({
  type = 'token_pool',
  amount = null,
  tokens = null,
  tokenPriceAud = 1.00,
  studentEmail = '',
  donorEmail = '',
  donorName = '',
  targetUid = ''
}) {
  const response = await fetch('/api/stripe/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type,
      amount,
      tokens,
      tokenPriceAud,
      studentEmail: studentEmail.trim(),
      donorEmail: donorEmail.trim(),
      donorName: donorName.trim(),
      targetUid
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.checkoutUrl) {
    throw new Error(data?.error || `Checkout failed (HTTP ${response.status})`);
  }

  // Redirect to Stripe Hosted Checkout
  window.location.href = data.checkoutUrl;
  return data;
}
