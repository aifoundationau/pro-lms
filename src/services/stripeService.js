/**
 * Client Stripe Payment Service for Pro-LMS
 * Handles student sponsorships and global token pool donations
 */

export const STRIPE_PUBLISHABLE_KEY =
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ||
  'pk_test_51UKnKUI8bClhBF4Pl59doST5JkSHIg47DaHs5bicuWUEM0iuyT6BtcVV2zlvZUAAL5HjnRNt5PAzJQETRIckLarb00o6jAlzpi';

/**
 * Initiates Stripe Checkout for:
 * 1. Student Sponsorship ($52 AUD)
 * 2. Token Pool Donation (e.g. $10, $25, $52, $100 AUD)
 */
export async function createCheckoutSession({
  type = 'token_pool',
  amount = 52,
  studentEmail = '',
  donorEmail = '',
  donorName = ''
}) {
  const response = await fetch('/api/stripe/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type,
      amount,
      studentEmail: studentEmail.trim(),
      donorEmail: donorEmail.trim(),
      donorName: donorName.trim()
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
