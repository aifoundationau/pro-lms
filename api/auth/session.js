/**
 * Lightweight Zero-Dependency Serverless Edge Session & Auth Config Endpoint
 * Resolves redirect URIs and origins dynamically at runtime from request headers
 */
export const config = {
  runtime: 'edge'
};

export default async function handler(req) {
  const host = req.headers.get('host') || 'localhost:5173';
  const proto = req.headers.get('x-forwarded-proto') || (host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https');
  const dynamicOrigin = `${proto}://${host}`;
  const redirectUri = `${dynamicOrigin}/auth/handler`;

  const originHeader = req.headers.get('origin') || dynamicOrigin;

  const headers = new Headers({
    'Access-Control-Allow-Origin': originHeader,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  });

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  return new Response(
    JSON.stringify({
      status: 'active',
      firebaseProject: 'ai-foundation-firebase',
      oauthClientId: process.env.VITE_GOOGLE_OAUTH_CLIENT_ID || '614773274800-9pooin0jia9ij91qjlk7r6r6ne02mbhg.apps.googleusercontent.com',
      dynamicOrigin,
      dynamicRedirectUri: redirectUri,
      sessionCookieConfig: {
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        path: '/'
      }
    }),
    { status: 200, headers }
  );
}
