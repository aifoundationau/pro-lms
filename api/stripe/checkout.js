/**
 * Lightweight Zero-Dependency Serverless Edge Stripe Checkout Endpoint
 * Creates a Stripe Checkout Session for Student Sponsorship ($52) or Token Pool Donations
 */
export const config = {
  runtime: 'edge'
};

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

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return new Response(
      JSON.stringify({ error: 'Missing STRIPE_SECRET_KEY in server environment.' }),
      { status: 500, headers }
    );
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const {
      type = 'token_pool',
      amount = 52, // Amount in AUD
      studentEmail = '',
      donorEmail = '',
      donorName = ''
    } = payload;

    const validatedAmount = Math.max(1, Number(amount) || 52);
    const amountInCents = Math.round(validatedAmount * 100);

    // Resolve base host dynamically
    const host = req.headers.get('host') || 'localhost:5173';
    const proto = req.headers.get('x-forwarded-proto') || (host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https');
    const dynamicBase = `${proto}://${host}`;

    let productName = 'Global Token Pool Contribution';
    let productDesc = 'Contribution to the token pool for disadvantaged students around the world.';

    if (type === 'student_sponsorship') {
      productName = `Student Annual Access Sponsorship ($${validatedAmount} AUD)`;
      productDesc = studentEmail
        ? `Fully fund annual LMS and AI course access for student: ${studentEmail}`
        : 'Fully fund annual LMS and AI course access for an identified student.';
    }

    const params = new URLSearchParams();
    params.append('mode', 'payment');
    params.append('success_url', `${dynamicBase}/?payment=success&session_id={CHECKOUT_SESSION_ID}`);
    params.append('cancel_url', `${dynamicBase}/?payment=cancelled`);
    params.append('line_items[0][price_data][currency]', 'aud');
    params.append('line_items[0][price_data][unit_amount]', String(amountInCents));
    params.append('line_items[0][price_data][product_data][name]', productName);
    params.append('line_items[0][price_data][product_data][description]', productDesc);
    params.append('line_items[0][quantity]', '1');
    params.append('metadata[tag]', 'lms');
    params.append('metadata[site_id]', 'ozedu');
    params.append('metadata[donation_type]', type);

    if (studentEmail) params.append('metadata[student_email]', studentEmail);
    if (donorEmail) {
      params.append('customer_email', donorEmail);
      params.append('metadata[donor_email]', donorEmail);
    }
    if (donorName) params.append('metadata[donor_name]', donorName);

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const data = await stripeRes.json();

    if (!stripeRes.ok) {
      const errMsg = data?.error?.message || `Stripe API error (${stripeRes.status})`;
      return new Response(JSON.stringify({ error: errMsg }), { status: stripeRes.status, headers });
    }

    return new Response(
      JSON.stringify({
        success: true,
        sessionId: data.id,
        checkoutUrl: data.url
      }),
      { status: 200, headers }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err?.message || 'Internal error creating checkout session.' }),
      { status: 500, headers }
    );
  }
}
