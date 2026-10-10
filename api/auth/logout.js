/**
 * Lightweight Zero-Dependency Serverless Edge Logout Endpoint
 * Purges HTTP-only session cookies and dynamically handles CORS origins
 */
export const config = {
  runtime: 'edge'
};

export default async function handler(req) {
  // Dynamically resolve origins from incoming request headers
  const origin = req.headers.get('origin') || '*';
  
  const headers = new Headers({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
    // Purge HTTP-only session cookie across web environments
    'Set-Cookie': '__session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  });

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  return new Response(
    JSON.stringify({
      success: true,
      message: 'Session cookie purged',
      timestamp: new Date().toISOString()
    }),
    { status: 200, headers }
  );
}
