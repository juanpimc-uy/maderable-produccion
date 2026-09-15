// api/cron-sync-items.js — Cron diario: sincronizar items de Zoho → inv_items
// Schedule: 0 9 * * * (09:00 UTC = 06:00 UY, antes de que entre la planta)
// Auth: Bearer CRON_SECRET (enviado automáticamente por Vercel crons)

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  if (secret && auth !== secret) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const base = process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : '';
  const url = base + '/api/inventario?action=sync-items-zoho';

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': process.env.INTERNAL_SECRET || '',
      },
    });
    const json = await r.json();
    if (!r.ok) {
      console.error('[cron-sync-items] sync failed:', json);
      return res.status(500).json({ error: json.msg || json.error || 'Sync failed', status: r.status });
    }
    return res.status(200).json(json);
  } catch (e) {
    console.error('[cron-sync-items] fetch error:', e);
    return res.status(500).json({ error: e.message });
  }
}
