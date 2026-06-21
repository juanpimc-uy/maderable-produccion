// api/despachos-sync.js — Bridge ctrl-despachos → ERP (Node runtime, NO edge)
// Se dispara por cron o manual (?secret=... o header Authorization: Bearer).
// Fase 1 seed: vincula proyectos (odf_numero → odf_proyecto_id) y rellena despacho_muebles.
// Fase 2: 'completado' al ERP cuando el mueble se imprimió (impreso=true).
// Fase 3: 'fuera' al ERP cuando TODOS los bultos del mueble están escaneados.
import { createClient } from '@supabase/supabase-js';

let erp, cd; // se inicializan dentro del handler, recién después de validar env vars

function ok(res, data)  { return res.status(200).json({ ok: true, ...data }); }
function err(res, msg, status = 400) { return res.status(status).json({ ok: false, msg }); }
function nowIso() { return new Date().toISOString(); }

function authorized(req) {
  const s = process.env.CRON_SECRET;
  if (!s) return true; // sin secret configurado no bloquea (permite test inicial)
  if ((req.headers['authorization'] || '') === `Bearer ${s}`) return true;
  if ((req.query.secret || '') === s) return true;
  return false;
}

export default async function handler(req, res) {
  if (!authorized(req)) return err(res, 'No autorizado', 401);
  if (!process.env.CTRL_DESPACHOS_URL || !process.env.CTRL_DESPACHOS_SERVICE_KEY) {
    return err(res, 'Faltan env CTRL_DESPACHOS_URL / CTRL_DESPACHOS_SERVICE_KEY', 500);
  }
  if (!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    return err(res, 'Falta env SUPABASE_URL del ERP', 500);
  }
  erp = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
  );
  cd = createClient(process.env.CTRL_DESPACHOS_URL, process.env.CTRL_DESPACHOS_SERVICE_KEY);
  const out = { catalogo: 0, seed: 0, completado: 0, fuera: 0, errores: [] };
  try {
    await faseCatalogo(out);
    await faseSeed(out);
    await faseCompletado(out);
    await faseFuera(out);
    return ok(res, out);
  } catch (e) {
    console.error('[despachos-sync]', e);
    out.errores.push(String((e && e.message) || e));
    return res.status(500).json({ ok: false, ...out });
  }
}

// helper: map proyecto_id (uuid ctrl-despachos) → odf_proyecto_id (text ERP)
async function proyectosVinculados() {
  const { data, error } = await cd.from('proyectos')
    .select('id, odf_proyecto_id').not('odf_proyecto_id', 'is', null);
  if (error) throw new Error('vinculados: ' + error.message);
  const map = {};
  for (const p of (data || [])) map[p.id] = p.odf_proyecto_id;
  return map;
}

// FASE 0 — espeja catálogo de ODF activos del ERP → ctrl-despachos (odf_disponibles)
async function faseCatalogo(out) {
  const { data: proys, error } = await erp.from('proyectos_cache')
    .select('id, numero, activo, cliente, cliente_nombre, muebles')
    .eq('activo', true);
  if (error) throw new Error('catalogo/erp: ' + error.message);

  const porNumero = {};
  for (const p of (proys || [])) {
    const numero = (p.numero || '').trim();
    if (!numero) continue;
    const muebles = (Array.isArray(p.muebles) ? p.muebles : [])
      .filter(m => (Number(m.placas) || 0) < 999)
      .map(m => ({
        id: m.id,
        codigo: m.codigo || '',
        nombre: m.nombre || '',
        cant: (m.cant != null && !isNaN(Number(m.cant))) ? Math.trunc(Number(m.cant)) : null,
      }));
    porNumero[numero] = {
      odf_numero: numero,
      odf_proyecto_id: p.id,
      cliente: p.cliente || p.cliente_nombre || '',
      muebles,
      activo: true,
      actualizado_en: nowIso(),
    };
  }

  const rows = Object.values(porNumero);
  if (rows.length) {
    const { error: e2 } = await cd.from('odf_disponibles')
      .upsert(rows, { onConflict: 'odf_numero' });
    if (e2) throw new Error('catalogo/upsert: ' + e2.message);
  }
  out.catalogo = rows.length;
}

// FASE 1 — seed
async function faseSeed(out) {
  const { data: pend, error } = await cd.from('proyectos')
    .select('id, odf_numero, odf_proyecto_id')
    .not('odf_numero', 'is', null).is('odf_proyecto_id', null);
  if (error) throw new Error('seed/proyectos: ' + error.message);

  for (const p of (pend || [])) {
    const numero = (p.odf_numero || '').trim();
    if (!numero) continue;
    const { data: proys, error: e2 } = await erp.from('proyectos_cache')
      .select('id, numero, muebles').eq('numero', numero).limit(1);
    if (e2) { out.errores.push('seed/erp ' + numero + ': ' + e2.message); continue; }
    if (!proys || !proys.length) { out.errores.push('seed: ODF no encontrado ' + numero); continue; }
    const erpProy = proys[0];

    const muebles = (Array.isArray(erpProy.muebles) ? erpProy.muebles : [])
      .filter(m => (Number(m.placas) || 0) < 999)
      .map(m => ({
        proyecto_id: p.id,
        mf_n: m.id,
        codigo: m.codigo || '',
        nombre: m.nombre || '',
        cant: (m.cant != null && !isNaN(Number(m.cant))) ? Math.trunc(Number(m.cant)) : null,
      }));

    if (muebles.length) {
      const { error: e3 } = await cd.from('despacho_muebles')
        .upsert(muebles, { onConflict: 'proyecto_id,mf_n', ignoreDuplicates: true });
      if (e3) { out.errores.push('seed/insert ' + numero + ': ' + e3.message); continue; }
    }
    const { error: e4 } = await cd.from('proyectos')
      .update({ odf_proyecto_id: erpProy.id }).eq('id', p.id);
    if (e4) { out.errores.push('seed/link ' + numero + ': ' + e4.message); continue; }
    out.seed++;
  }
}

// FASE 2 — push completado
async function faseCompletado(out) {
  const linkMap = await proyectosVinculados();
  const ids = Object.keys(linkMap);
  if (!ids.length) return;

  const { data: dm, error } = await cd.from('despacho_muebles')
    .select('id, proyecto_id, mf_n, nombre, impreso, completado_sync_en')
    .in('proyecto_id', ids).eq('impreso', true).is('completado_sync_en', null);
  if (error) throw new Error('completado/dm: ' + error.message);

  for (const m of (dm || [])) {
    const odfPid = linkMap[m.proyecto_id];
    if (!odfPid) continue;
    const { error: e2 } = await erp.from('items_completado_log').insert({
      proyecto_id: odfPid, item_id: m.mf_n, evento: 'completado',
      completado_en: nowIso(), item_nombre: m.nombre || null, creado_por: null,
    });
    if (e2) { out.errores.push('completado/erp ' + m.mf_n + ': ' + e2.message); continue; }
    const { error: e3 } = await cd.from('despacho_muebles')
      .update({ completado_sync_en: nowIso() }).eq('id', m.id);
    if (e3) { out.errores.push('completado/sync ' + m.mf_n + ': ' + e3.message); continue; }
    out.completado++;
  }
}

// FASE 3 — push fuera
async function faseFuera(out) {
  const linkMap = await proyectosVinculados();
  const ids = Object.keys(linkMap);
  if (!ids.length) return;

  const { data: dm, error } = await cd.from('despacho_muebles')
    .select('id, proyecto_id, mf_n, fuera_sync_en')
    .in('proyecto_id', ids).is('fuera_sync_en', null);
  if (error) throw new Error('fuera/dm: ' + error.message);
  if (!dm || !dm.length) return;

  const { data: bultos, error: e2 } = await cd.from('bultos')
    .select('proyecto_id, mueble_mf_n, escaneado')
    .in('proyecto_id', ids).not('mueble_mf_n', 'is', null);
  if (e2) throw new Error('fuera/bultos: ' + e2.message);

  const agg = {};
  for (const b of (bultos || [])) {
    const k = b.proyecto_id + '|' + b.mueble_mf_n;
    if (!agg[k]) agg[k] = { total: 0, scan: 0 };
    agg[k].total++;
    if (b.escaneado) agg[k].scan++;
  }

  for (const m of dm) {
    const a = agg[m.proyecto_id + '|' + m.mf_n];
    if (!a || a.total === 0 || a.scan < a.total) continue; // >=1 bulto y todos escaneados
    const odfPid = linkMap[m.proyecto_id];
    if (!odfPid) continue;
    const { error: e3 } = await erp.from('despachos_muebles').upsert({
      proyecto_id: odfPid, mf_n: m.mf_n, unidad: '', despachado_full: true,
      fecha_despacho: nowIso(), origen: 'ctrl-despachos', actualizado_en: nowIso(),
    }, { onConflict: 'proyecto_id,mf_n,unidad' });
    if (e3) { out.errores.push('fuera/erp ' + m.mf_n + ': ' + e3.message); continue; }
    const { error: e4 } = await cd.from('despacho_muebles')
      .update({ fuera_sync_en: nowIso() }).eq('id', m.id);
    if (e4) { out.errores.push('fuera/sync ' + m.mf_n + ': ' + e4.message); continue; }
    out.fuera++;
  }
}
