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
      amount = null,
      tokens = null,
      tokenPriceAud = 1.00,
      studentEmail = '',
      donorEmail = '',
      donorName = '',
      targetUid = ''
    } = payload;

    // People can buy any amount through Stripe, minimum is 50 tokens
    let tokenCount = tokens !== null && tokens !== undefined ? Math.max(50, Math.floor(Number(tokens) || 50)) : null;
    const pricePerToken = Math.max(0.01, Number(tokenPriceAud) || 1.00);

    let validatedAmount;
    if (tokenCount !== null) {
      validatedAmount = Math.round(tokenCount * pricePerToken * 100) / 100;
    } else {
      validatedAmount = Math.max(1, Number(amount) || 52);
    }
    const amountInCents = Math.round(validatedAmount * 100);

    // Resolve base host dynamically
    const host = req.headers.get('host') || 'localhost:5173';
    const proto = req.headers.get('x-forwarded-proto') || (host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https');
    const dynamicBase = `${proto}://${host}`;

    let productName = 'Global Token Pool Contribution';
    let productDesc = 'Contribution to the accumulated token fund for disadvantaged students and teachers around the world.';

    if (type === 'token_purchase') {
      productName = `Purchase ${tokenCount || 50} OzEdu Tokens ($${validatedAmount} AUD)`;
      productDesc = `Add ${tokenCount || 50} tokens to user account balance at $${pricePerToken.toFixed(2)} AUD per token.`;
    } else if (type === 'student_sponsorship') {
      productName = `Student Annual Access Sponsorship ($${validatedAmount} AUD)`;
      productDesc = studentEmail
        ? `Fully fund annual LMS and AI course access for student: ${studentEmail}`
        : 'Fully fund annual LMS and AI course access for an identified student.';
    } else if (tokenCount !== null) {
      productName = `Accumulated Token Fund Donation: ${tokenCount} Tokens ($${validatedAmount} AUD)`;
      productDesc = `Donate ${tokenCount} tokens into the accumulated fund to redistribute to students and teachers with under 26 tokens.`;
    }

    const params = new URLSearchParams();
    params.append('mode', 'payment');
    params.append('success_url', `${dynamicBase}/?payment=success&session_id={CHECKOUT_SESSION_ID}&tokens=${tokenCount || ''}&type=${type}`);
    params.append('cancel_url', `${dynamicBase}/?payment=cancelled`);
    params.append('line_items[0][price_data][currency]', 'aud');
    params.append('line_items[0][price_data][unit_amount]', String(amountInCents));
    params.append('line_items[0][price_data][product_data][name]', productName);
    params.append('line_items[0][price_data][product_data][description]', productDesc);
    params.append('line_items[0][quantity]', '1');
    params.append('metadata[tag]', 'lms');
    params.append('metadata[site_id]', 'ozedu');
    params.append('metadata[donation_type]', type);
    if (tokenCount) params.append('metadata[tokens]', String(tokenCount));
    params.append('metadata[token_price_aud]', String(pricePerToken));
    if (targetUid) params.append('metadata[target_uid]', targetUid);

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
