import { getZohoToken } from './_zoho-token-cache.js';
export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'GET') {
    try {
      const access_token = await getZohoToken();
      return new Response(JSON.stringify({ access_token }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  }

  // POST — OAuth code exchange (initial setup only)
  const { code, refresh_token } = await req.json();
  const params = new URLSearchParams();
  params.append('client_id', process.env.ZOHO_CLIENT_ID);
  params.append('client_secret', process.env.ZOHO_CLIENT_SECRET);
  params.append('redirect_uri', 'https://maderable-produccion.vercel.app/oauth.html');
  params.append('grant_type', code ? 'authorization_code' : 'refresh_token');
  if (code) params.append('code', code);
  if (refresh_token) params.append('refresh_token', refresh_token);

  const res = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method: 'POST',
    body: params,
  });
  const data = await res.json();
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
