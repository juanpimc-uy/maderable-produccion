// api/planificacion.js — Gantt global de entregas por mueble (Edge runtime)
// Sin auth — datos de solo lectura (misma política que mct-proyecto y proyectos-activos).
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
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  try {
    if (action === 'gantt' && req.method === 'GET') {
      const { data, error } = await supabase.rpc('planificacion_gantt');
      if (error) throw error;
      return ok({ ok: true, ...(data || {}) });
    }

    return err('action inválida', 400);
  } catch (e) {
    console.error('[planificacion]', action, e);
    return err(e.message || 'Error interno', 500);
  }
}
