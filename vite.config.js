import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import https from 'node:https'
import querystring from 'node:querystring'

function devApiPlugin() {
  let env = {};
  return {
    name: 'dev-api-middleware',
    configResolved(config) {
      env = loadEnv(config.mode, process.cwd(), '');
    },
    configureServer(server) {
      server.middlewares.use('/api/stripe/checkout', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let bodyStr = '';
        req.on('data', chunk => bodyStr += chunk);
        req.on('end', () => {
          try {
            const payload = JSON.parse(bodyStr || '{}');
            const stripeKey = env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
            if (!stripeKey) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              return res.end(JSON.stringify({ error: 'Missing STRIPE_SECRET_KEY in .env' }));
            }
            const {
              type = 'token_pool',
              amount = null,
              tokens = null,
              tokenPriceAud = 1.00,
              studentEmail = '',
              donorEmail = '',
              targetUid = ''
            } = payload;

            let tokenCount = tokens !== null && tokens !== undefined ? Math.max(50, Math.floor(Number(tokens) || 50)) : null;
            const pricePerToken = Math.max(0.01, Number(tokenPriceAud) || 1.00);

            let validatedAmount;
            if (tokenCount !== null) {
              validatedAmount = Math.round(tokenCount * pricePerToken * 100) / 100;
            } else {
              validatedAmount = Math.max(1, Number(amount) || 52);
            }
            const amountInCents = Math.round(validatedAmount * 100);

            let prodName = 'Global Token Pool Contribution';
            let prodDesc = 'Contribute to our token pool for disadvantaged students around the world.';

            if (type === 'token_purchase') {
              prodName = `Purchase ${tokenCount || 50} OzEdu Tokens ($${validatedAmount} AUD)`;
              prodDesc = `Add ${tokenCount || 50} tokens to user account balance at $${pricePerToken.toFixed(2)} AUD per token.`;
            } else if (type === 'student_sponsorship') {
              prodName = `Student Annual Access Sponsorship ($${validatedAmount} AUD)`;
              prodDesc = studentEmail ? `Funded for student: ${studentEmail}` : 'Annual student LMS access';
            } else if (tokenCount !== null) {
              prodName = `Accumulated Token Fund Donation: ${tokenCount} Tokens ($${validatedAmount} AUD)`;
              prodDesc = `Donate ${tokenCount} tokens into the accumulated fund to redistribute to students and teachers with under 26 tokens.`;
            }

            const postData = querystring.stringify({
              mode: 'payment',
              success_url: `http://${req.headers.host || 'localhost:5173'}/?payment=success&session_id={CHECKOUT_SESSION_ID}&tokens=${tokenCount || ''}&type=${type}`,
              cancel_url: `http://${req.headers.host || 'localhost:5173'}/?payment=cancelled`,
              'line_items[0][price_data][currency]': 'aud',
              'line_items[0][price_data][unit_amount]': String(amountInCents),
              'line_items[0][price_data][product_data][name]': prodName,
              'line_items[0][price_data][product_data][description]': prodDesc,
              'line_items[0][quantity]': '1',
              'metadata[tag]': 'lms',
              'metadata[site_id]': 'ozedu',
              'metadata[donation_type]': type,
              ...(tokenCount ? { 'metadata[tokens]': String(tokenCount) } : {}),
              ...(targetUid ? { 'metadata[target_uid]': targetUid } : {}),
              ...(studentEmail ? { 'metadata[student_email]': studentEmail } : {}),
              ...(donorEmail ? { customer_email: donorEmail } : {})
            });

            const stripeReq = https.request({
              hostname: 'api.stripe.com',
              path: '/v1/checkout/sessions',
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${stripeKey}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
              }
            }, (stripeRes) => {
              let resData = '';
              stripeRes.on('data', chunk => resData += chunk);
              stripeRes.on('end', () => {
                res.statusCode = stripeRes.statusCode;
                res.setHeader('Content-Type', 'application/json');
                if (stripeRes.statusCode >= 200 && stripeRes.statusCode < 300) {
                  const s = JSON.parse(resData);
                  res.end(JSON.stringify({ success: true, sessionId: s.id, checkoutUrl: s.url }));
                } else {
                  res.end(resData);
                }
              });
            });
            stripeReq.on('error', (err) => {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message }));
            });
            stripeReq.write(postData);
            stripeReq.end();
          } catch (e) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), devApiPlugin()],
})
