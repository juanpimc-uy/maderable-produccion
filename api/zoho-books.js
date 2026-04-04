export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const endpoint = url.searchParams.get('endpoint');
  const token = url.searchParams.get('token');
  const org_id = process.env.ZOHO_ORG_ID;

  const separator = endpoint.includes('?') ? '&' : '?';
  const zohoUrl = `https://www.zohoapis.com/books/v3/${endpoint}${separator}organization_id=${org_id}`;

  console.log('Zoho URL:', zohoUrl);

  const res = await fetch(zohoUrl, {
    headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
  });
  const data = await res.json();
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
