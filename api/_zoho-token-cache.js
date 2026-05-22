// api/_zoho-token-cache.js
// Zoho OAuth token con caché en Supabase config_global.
// Evita refreshes redundantes entre invocaciones serverless (cold starts).

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xhfeurinovvsbgobkidy.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

// In-memory cache (sobrevive dentro de la misma instancia edge)
let _memToken = null;
let _memExpiry = 0;

const BUFFER_MS = 5 * 60 * 1000; // 5 min de buffer antes de considerar expirado

export async function getZohoToken() {
  // 1. Cache en memoria (misma instancia)
  if (_memToken && _memExpiry > Date.now() + 60000) return _memToken;

  // 2. Cache en Supabase (entre instancias)
  try {
    const { data: rows } = await supabase
      .from('config_global')
      .select('clave, valor')
      .in('clave', ['zoho_access_token', 'zoho_token_expires_at']);

    const map = Object.fromEntries((rows || []).map(r => [r.clave, r.valor]));
    const savedToken = map.zoho_access_token;
    const savedExpiry = map.zoho_token_expires_at; // epoch ms guardado como number en jsonb

    if (savedToken && savedExpiry && savedExpiry > Date.now() + BUFFER_MS) {
      _memToken = savedToken;
      _memExpiry = savedExpiry;
      return savedToken;
    }
  } catch (e) {
    console.warn('[zoho-token-cache] Error leyendo cache de Supabase:', e.message);
  }

  // 3. Refresh desde Zoho OAuth
  const params = new URLSearchParams();
  params.append('client_id',     process.env.ZOHO_CLIENT_ID);
  params.append('client_secret', process.env.ZOHO_CLIENT_SECRET);
  params.append('refresh_token', process.env.ZOHO_REFRESH_TOKEN);
  params.append('grant_type',    'refresh_token');

  const res  = await fetch('https://accounts.zoho.com/oauth/v2/token', { method: 'POST', body: params });
  const data = await res.json();

  if (!data.access_token) {
    throw new Error('No se pudo obtener token de Zoho: ' + (data.error || JSON.stringify(data)));
  }

  const newToken  = data.access_token;
  const newExpiry = Date.now() + ((data.expires_in || 3600) * 1000) - 60000; // 1 min de margen

  // Guardar en memoria
  _memToken = newToken;
  _memExpiry = newExpiry;

  // Guardar en Supabase (fire-and-forget, no bloquear)
  try {
    await Promise.all([
      supabase.from('config_global').upsert(
        { clave: 'zoho_access_token', valor: newToken, actualizado_at: new Date().toISOString() },
        { onConflict: 'clave' }
      ),
      supabase.from('config_global').upsert(
        { clave: 'zoho_token_expires_at', valor: newExpiry, actualizado_at: new Date().toISOString() },
        { onConflict: 'clave' }
      ),
    ]);
  } catch (e) {
    console.warn('[zoho-token-cache] Error guardando cache en Supabase:', e.message);
  }

  return newToken;
}
