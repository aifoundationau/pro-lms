/**
 * Serverless Edge Endpoint: GET /api/stripe/confirm?session_id=cs_...
 *
 * Verifies a Stripe Checkout Session with the secret key and returns what was actually paid.
 * The browser never credits tokens itself: verified purchases are sent to the Super Admin, who
 * grants them (each Stripe session can only be credited once).
 */
export const config = {
  runtime: 'edge'
};

const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}

export default async function handler(req) {
  const origin = req.headers.get('origin') || '*';
  const headers = new Headers({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405, headers);

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return json({ error: 'Payments are not configured on the server.' }, 500, headers);

  const sessionId = new URL(req.url).searchParams.get('session_id') || '';
  if (!SESSION_ID.test(sessionId)) return json({ error: 'Invalid checkout session id.' }, 400, headers);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
      signal: controller.signal
    }).finally(() => clearTimeout(timer));
    const data = await stripeRes.json().catch(() => ({}));
    if (!stripeRes.ok) {
      return json({ error: data?.error?.message || `Stripe API error (${stripeRes.status})` }, stripeRes.status === 404 ? 404 : 502, headers);
    }

    const metadata = data.metadata || {};
    return json({
      sessionId: data.id,
      paid: data.payment_status === 'paid',
      status: data.status || '',
      type: metadata.donation_type || '',
      tokens: Math.max(0, Math.floor(Number(metadata.tokens) || 0)),
      tokenPriceAud: Number(metadata.token_price_aud) || null,
      targetUid: metadata.target_uid || '',
      studentEmail: metadata.student_email || '',
      amountTotal: Number.isFinite(Number(data.amount_total)) ? Number(data.amount_total) / 100 : null,
      currency: String(data.currency || '').toUpperCase(),
      created: data.created || null
    }, 200, headers);
  } catch (err) {
    return json({ error: err?.name === 'AbortError' ? 'Stripe did not respond in time.' : (err?.message || 'Could not verify the payment.') }, 502, headers);
  }
}
