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

    // ── GET codigo-mueble (admin/oficina) ──
    if (action === 'codigo-mueble' && req.method === 'GET') {
      const caller = await verificarSesion(url.searchParams.get('token'));
      if (!caller || !['admin', 'oficina'].includes(caller.rol_app))
        return err('Acceso denegado', 401);

      const proyecto_id = url.searchParams.get('proyecto_id');
      const mf_id = url.searchParams.get('mf_id');
      if (!proyecto_id || !mf_id) return err('proyecto_id y mf_id requeridos');

      const { data } = await supabase.from('mueble_codigos')
        .select('codigo').eq('proyecto_id', proyecto_id).eq('mf_id', mf_id).maybeSingle();
      return ok({ ok: true, codigo: data ? data.codigo : null });
    }

    // ── POST generar-codigo-mueble (admin/oficina) ──
    if (action === 'generar-codigo-mueble' && req.method === 'POST') {
      const caller = await verificarSesion(body.token);
      if (!caller || !['admin', 'oficina'].includes(caller.rol_app))
        return err('Acceso denegado', 401);

      const { proyecto_id, mf_id } = body;
      if (!proyecto_id || !mf_id) return err('proyecto_id y mf_id requeridos');

      // Idempotente: si ya existe, se devuelve el mismo token. Nunca se regenera.
      const { data: ya } = await supabase.from('mueble_codigos')
        .select('codigo').eq('proyecto_id', proyecto_id).eq('mf_id', mf_id).maybeSingle();
      if (ya) return ok({ ok: true, codigo: ya.codigo, creado: false });

      // Correlativo MB-000001. Reintento ante colisión por impresión simultánea.
      for (let intento = 0; intento < 3; intento++) {
        const { data: ultimos } = await supabase.from('mueble_codigos')
          .select('codigo').order('codigo', { ascending: false }).limit(1);
        const ultimoNum = (ultimos && ultimos.length)
          ? parseInt(String(ultimos[0].codigo).replace(/\D/g, ''), 10) || 0
          : 0;
        const codigo = 'MB-' + String(ultimoNum + 1 + intento).padStart(6, '0');
        const { data: nuevo, error: insErr } = await supabase.from('mueble_codigos')
          .insert({ codigo, proyecto_id, mf_id, creado_por: caller.id })
          .select('codigo').single();
        if (!insErr) return ok({ ok: true, codigo: nuevo.codigo, creado: true });
        if (insErr.code !== '23505') return err(insErr.message, 500);
        // Race condition: otro request lo creó en paralelo
        const { data: carrera } = await supabase.from('mueble_codigos')
          .select('codigo').eq('proyecto_id', proyecto_id).eq('mf_id', mf_id).maybeSingle();
        if (carrera) return ok({ ok: true, codigo: carrera.codigo, creado: false });
      }
      return err('No se pudo generar un código libre, reintentá', 500);
    }

    return err('action no reconocida', 404);

  } catch (e) {
    console.error('[etiquetas]', e);
    return err(e.message || 'Error interno', 500);
  }
}
