// api/despachos.js — Endpoints de despacho de muebles (Node.js runtime, NO edge)
// Llamado server-to-server desde ctrl-despachos con header x-internal-secret.
// IMPORTANTE: el secret NUNCA debe vivir en el browser — ctrl-despachos llama desde su backend.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

function ok(res, data)  { return res.status(200).json({ ok: true, ...data }); }
function err(res, msg, status = 400) { return res.status(status).json({ ok: false, msg }); }

function requireInternal(req, res) {
  const secret = process.env.INTERNAL_SECRET;
  if (!secret || req.headers['x-internal-secret'] !== secret) {
    err(res, 'No autorizado', 401);
    return false;
  }
  return true;
}

// normaliza mf_n para que matchee el id del JSONB que usa el ① (con prefijo 'mf_')
function normMf(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  return s.startsWith('mf_') ? s : 'mf_' + s;
}

// ── GET lista-odf-muebles ──────────────────────────────────────────────────
// Devuelve los muebles de un ODF para que ctrl-despachos arme el dropdown.
// Input: ?proyecto_id=pr_...  |  ?odf=ODF-2404  (uno de los dos)
async function accionListaOdfMuebles(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  if (!requireInternal(req, res)) return;

  const proyecto_id = (req.query.proyecto_id || '').trim();
  const odf = (req.query.odf || req.query.numero || '').trim();
  if (!proyecto_id && !odf) return err(res, 'proyecto_id u odf requerido');

  let q = supabase.from('proyectos_cache').select('id, numero, cliente, cliente_nombre, muebles');
  if (proyecto_id) q = q.eq('id', proyecto_id);
  else q = q.eq('numero', odf);
  const { data: proys, error } = await q.limit(1);
  if (error) return err(res, error.message, 500);
  if (!proys || !proys.length) return err(res, 'ODF no encontrado', 404);

  const p = proys[0];

  const { data: desp } = await supabase.from('despachos_muebles')
    .select('mf_n, despachado_full')
    .eq('proyecto_id', p.id);
  const fullSet = new Set((desp || []).filter(d => d.despachado_full).map(d => d.mf_n));

  const muebles = (Array.isArray(p.muebles) ? p.muebles : [])
    .filter(m => (Number(m.placas) || 0) < 999)
    .map(m => ({
      id: m.id,
      codigo: m.codigo || '',
      nombre: m.nombre || '',
      cant: m.cant != null ? m.cant : null,
      despachado: fullSet.has(m.id),
    }));

  return ok(res, {
    proyecto_id: p.id,
    numero: p.numero,
    cliente: p.cliente || p.cliente_nombre || '',
    muebles,
  });
}

// ── POST registrar-despacho ────────────────────────────────────────────────
// Marca un mueble como despachado. Idempotente (upsert por proyecto_id+mf_n+unidad).
// Body: { proyecto_id, mf_n, unidad?='', despachado_full?=true, fecha_despacho?, origen? }
async function accionRegistrarDespacho(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  if (!requireInternal(req, res)) return;

  const b = req.body || {};
  const proyecto_id = (b.proyecto_id || '').trim();
  const mf_n = normMf(b.mf_n);
  const unidad = (b.unidad == null ? '' : String(b.unidad)).trim();
  const despachado_full = b.despachado_full === false ? false : true;
  const fecha_despacho = b.fecha_despacho || new Date().toISOString();

  if (!proyecto_id || !mf_n) return err(res, 'proyecto_id y mf_n requeridos');

  const fila = {
    proyecto_id,
    mf_n,
    unidad,
    despachado_full,
    fecha_despacho,
    actualizado_en: new Date().toISOString(),
  };
  if (b.origen) fila.origen = String(b.origen);

  const { data, error } = await supabase
    .from('despachos_muebles')
    .upsert(fila, { onConflict: 'proyecto_id,mf_n,unidad' })
    .select('id, proyecto_id, mf_n, unidad, despachado_full, fecha_despacho')
    .single();

  if (error) return err(res, error.message, 500);
  return ok(res, { despacho: data });
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const action = req.query.action;
  try {
    if (action === 'lista-odf-muebles')  return await accionListaOdfMuebles(req, res);
    if (action === 'registrar-despacho') return await accionRegistrarDespacho(req, res);
    return err(res, 'Acción no reconocida');
  } catch (e) {
    console.error('[despachos]', action, e);
    return err(res, 'Error interno', 500);
  }
}
