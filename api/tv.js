// api/tv.js — Datos públicos para las TVs de planta (Edge runtime, sin auth)
import { createClient } from '@supabase/supabase-js';
export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xhfeurinovvsbgobkidy.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
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

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS });

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  try {
    if (action === 'horas-tarea-centro' && req.method === 'GET') {
      const { data, error } = await supabase.rpc('tv_horas_tarea_centro');
      if (error) return err(error.message, 500);
      return ok({ ok: true, tareas: data || [] });
    }

    return err('accion no valida', 404);
  } catch (e) {
    console.error('[tv]', action, e);
    return err('Error interno', 500);
  }
}
