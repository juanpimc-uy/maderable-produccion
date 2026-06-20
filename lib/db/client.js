// lib/db/client.js
// ─────────────────────────────────────────────────────────────────────────────
// Cliente Supabase compartido (service role). Primer ladrillo de la capa `lib/`
// (ver ARQUITECTURA.md). Reemplaza el patrón copiado en ~16 handlers de /api:
//
//   const supabase = createClient(
//     process.env.SUPABASE_URL || ... ,
//     process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
//   );
//
// Compatible con Edge y Node (supabase-js corre en ambos runtimes).
//
// Uso (cuando se extraiga un dominio del monolito):
//   import { getServiceClient } from '../../lib/db/client.js';
//   const supabase = getServiceClient();
//
// Diferencia deliberada con el patrón viejo: NO cae al anon key. El modelo objetivo
// es service key + RLS gobernada (ARQUITECTURA.md, ADR-2). Si falta el service key,
// falla fuerte en vez de degradar silenciosamente a anon.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://xhfeurinovvsbgobkidy.supabase.co';

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';

let _client = null;

/**
 * Cliente Supabase con service role (singleton por proceso/aislamiento).
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export function getServiceClient() {
  if (!SERVICE_KEY) {
    throw new Error(
      'lib/db: falta SUPABASE_SERVICE_KEY (o SUPABASE_SERVICE_ROLE_KEY) en el entorno'
    );
  }
  if (!_client) {
    _client = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}
