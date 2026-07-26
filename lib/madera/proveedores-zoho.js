import { getZohoToken } from '../../api/_zoho-token-cache.js';

const ORG_ID = process.env.ZOHO_ORG_ID || '650251363';

export async function buscar(query) {
  const q = (query.q || '').trim();
  const token = await getZohoToken();
  // Endpoint Zoho Books: contacts filtrados por contact_type=vendor
  const params = new URLSearchParams({
    organization_id: ORG_ID,
    contact_type: 'vendor',
    per_page: '50',
  });
  if (q) params.set('contact_name_contains', q);
  const url = `https://www.zohoapis.com/books/v3/contacts?${params}`;
  const r = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` }
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Zoho vendors error ${r.status}: ${t.slice(0, 200)}`);
  }
  const data = await r.json();
  const proveedores = (data.contacts || []).map(c => ({
    id: c.contact_id,
    nombre: c.contact_name,
  }));
  return { ok: true, proveedores };
}
