// api/etiquetas.js — Config de etiquetas (Edge runtime)
import { createClient } from '@supabase/supabase-js';
export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xhfeurinovvsbgobkidy.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function ok(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
function err(msg, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function verificarSesion(token) {
  if (!token) return null;
  const { data } = await supabase
    .from('empleados')
    .select('id, rol_app, nombre')
    .eq('session_token', token)
    .gt('session_expires_at', new Date().toISOString())
    .eq('activo', true)
    .maybeSingle();
  return data || null;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS });

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  let body = {};
  if (req.method === 'POST') {
    try { body = await req.json(); } catch { body = {}; }
  }

  try {

    // ── GET config (sin auth — CORS abierto para ctrl-despachos en GH Pages) ──
    if (action === 'config' && req.method === 'GET') {
      const { data, error } = await supabase
        .from('etiquetas_config')
        .select('*');
      if (error) throw error;
      return ok({ ok: true, config: data || [] });
    }

    // ── POST guardar-config (admin/oficina) ──
    if (action === 'guardar-config' && req.method === 'POST') {
      const { token, funcion, tamano, titulo, campos } = body;
      const caller = await verificarSesion(token);
      if (!caller || !['admin', 'oficina'].includes(caller.rol_app))
        return err('Acceso denegado', 401);

      if (!funcion) return err('funcion requerida');

      const { error } = await supabase
        .from('etiquetas_config')
        .upsert({
          funcion,
          tamano: tamano || '60x30',
          titulo: titulo || null,
          campos: campos || {},
          actualizado_at: new Date().toISOString(),
          actualizado_por: caller.id,
        }, { onConflict: 'funcion' });
      if (error) throw error;
      return ok({ ok: true });
    }

    return err('action no reconocida', 404);

  } catch (e) {
    console.error('[etiquetas]', e);
    return err(e.message || 'Error interno', 500);
  }
}
