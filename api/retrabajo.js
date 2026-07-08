// api/retrabajo.js — Cola de piezas de retrabajo (CAM→CNC)
// Edge runtime, session-based (browser). Estados: solicitada → pronta → cortada.
import { createClient } from '@supabase/supabase-js';
export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xhfeurinovvsbgobkidy.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
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
class ApiError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
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
  if (req.method === 'POST' || req.method === 'PATCH') {
    try { body = await req.json(); } catch { body = {}; }
  }

  try {

    // ── POST solicitar-pieza (planta/oficina, por empleado_id) ────────────
    if (action === 'solicitar-pieza' && req.method === 'POST') {
      const { proyecto_id, proyecto_nombre, item_id, item_nombre,
              codigo_pieza, motivo, empleado_id } = body;
      if (!proyecto_id || !item_id || !codigo_pieza || !empleado_id)
        return err('proyecto_id, item_id, codigo_pieza y empleado_id son requeridos', 400);

      const { data: pieza, error: eIns } = await supabase
        .from('piezas_retrabajo')
        .insert({
          proyecto_id, proyecto_nombre: proyecto_nombre || null,
          item_id, item_nombre: item_nombre || null,
          codigo_pieza: String(codigo_pieza).trim().toUpperCase(),
          motivo: motivo || null,
          solicitado_por: empleado_id,
        })
        .select().single();
      if (eIns) return err(eIns.message, 500);

      const { data: ultEvento } = await supabase
        .from('items_completado_log')
        .select('evento')
        .eq('proyecto_id', proyecto_id).eq('item_id', item_id)
        .order('creado_at', { ascending: false })
        .limit(1).maybeSingle();
      if (ultEvento && ultEvento.evento === 'completado') {
        await supabase.from('items_completado_log').insert({
          proyecto_id, item_id, evento: 'reabierto',
          es_retrabajo: true,
          motivo: motivo || 'Pieza solicitada para re-corte',
          item_nombre: item_nombre || null,
          creado_por: empleado_id,
        });
      }

      return ok({ ok: true, pieza });
    }

    // ── GET listar-piezas-retrabajo ───────────────────────────────────────
    if (action === 'listar-piezas-retrabajo' && req.method === 'GET') {
      const { data: piezas, error: eLst } = await supabase
        .from('piezas_retrabajo')
        .select('*')
        .order('solicitado_en', { ascending: false })
        .limit(500);
      if (eLst) return err(eLst.message, 500);
      return ok({ ok: true, piezas: piezas || [] });
    }

    // ── POST arrancar-cam (oficina, session_token) ────────────────────────
    if (action === 'arrancar-cam' && req.method === 'POST') {
      const caller = await verificarSesion(body.st || body.session_token);
      if (!caller) return err('Sesión inválida', 401);
      if (!body.pieza_id) return err('pieza_id requerido', 400);
      const { data: pieza, error: eUpd } = await supabase
        .from('piezas_retrabajo')
        .update({ cam_inicio: new Date().toISOString(), cam_por: caller.id })
        .eq('id', body.pieza_id).eq('estado', 'solicitada').is('cam_inicio', null)
        .select().maybeSingle();
      if (eUpd) return err(eUpd.message, 500);
      if (!pieza) return err('La pieza no está solicitada o ya tiene CAM iniciado', 409);
      return ok({ ok: true, pieza });
    }

    // ── POST marcar-pronta (oficina, session_token) ───────────────────────
    if (action === 'marcar-pronta' && req.method === 'POST') {
      const caller = await verificarSesion(body.st || body.session_token);
      if (!caller) return err('Sesión inválida', 401);
      if (!body.pieza_id) return err('pieza_id requerido', 400);
      const { data: prev } = await supabase
        .from('piezas_retrabajo').select('cam_por').eq('id', body.pieza_id).maybeSingle();
      const { data: pieza, error: eUpd } = await supabase
        .from('piezas_retrabajo')
        .update({ estado: 'pronta', pronta_en: new Date().toISOString(),
                  cam_por: (prev && prev.cam_por) ? prev.cam_por : caller.id })
        .eq('id', body.pieza_id).eq('estado', 'solicitada')
        .select().maybeSingle();
      if (eUpd) return err(eUpd.message, 500);
      if (!pieza) return err('La pieza no está en estado solicitada', 409);
      return ok({ ok: true, pieza });
    }

    // ── POST arrancar-corte (planta, empleado_id) ─────────────────────────
    if (action === 'arrancar-corte' && req.method === 'POST') {
      if (!body.pieza_id || !body.empleado_id) return err('pieza_id y empleado_id requeridos', 400);
      const { data: pieza, error: eUpd } = await supabase
        .from('piezas_retrabajo')
        .update({ corte_inicio: new Date().toISOString(), corte_por: body.empleado_id })
        .eq('id', body.pieza_id).eq('estado', 'pronta').is('corte_inicio', null)
        .select().maybeSingle();
      if (eUpd) return err(eUpd.message, 500);
      if (!pieza) return err('La pieza no está pronta o ya tiene corte iniciado', 409);
      return ok({ ok: true, pieza });
    }

    // ── POST marcar-cortada (planta, empleado_id) ─────────────────────────
    if (action === 'marcar-cortada' && req.method === 'POST') {
      if (!body.pieza_id) return err('pieza_id requerido', 400);
      let actorId = body.empleado_id || null;
      if (!actorId) {
        const caller = await verificarSesion(body.st || body.session_token);
        if (!caller) return err('empleado_id o sesión requeridos', 401);
        actorId = caller.id;
      }
      const { data: prev } = await supabase
        .from('piezas_retrabajo').select('corte_por').eq('id', body.pieza_id).maybeSingle();
      const { data: pieza, error: eUpd } = await supabase
        .from('piezas_retrabajo')
        .update({ estado: 'cortada', cortada_en: new Date().toISOString(),
                  corte_por: (prev && prev.corte_por) ? prev.corte_por : actorId })
        .eq('id', body.pieza_id).eq('estado', 'pronta')
        .select().maybeSingle();
      if (eUpd) return err(eUpd.message, 500);
      if (!pieza) return err('La pieza no está en estado pronta', 409);
      return ok({ ok: true, pieza });
    }

    return err('Acción no reconocida: ' + action);

  } catch (e) {
    if (e instanceof ApiError) return err(e.message, e.status);
    return err(e.message, 500);
  }
}
