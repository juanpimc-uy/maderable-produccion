// api/despachos-migrar.js — Migración idempotente ctrl-despachos → ERP (Node runtime)
// Copia proyectos, envíos y bultos preservando los id originales (upsert por id).
// ?dry=1 (default): solo lectura. ?dry=0: escribe.
import { createClient } from '@supabase/supabase-js';

let erp, cd;

function ok(res, data)  { return res.status(200).json({ ok: true, ...data }); }
function err(res, msg, status = 400) { return res.status(status).json({ ok: false, msg }); }

function authorized(req) {
  const s = process.env.CRON_SECRET;
  if (!s) return false;
  if ((req.headers['authorization'] || '') === `Bearer ${s}`) return true;
  if ((req.query.secret || '') === s) return true;
  return false;
}

// Lee todas las filas de una tabla paginando de a 500
async function leerTodo(client, tabla, select = '*') {
  const PAGE = 500;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await client.from(tabla)
      .select(select).range(from, from + PAGE - 1);
    if (error) throw new Error(`leer ${tabla}: ${error.message}`);
    if (!data || !data.length) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// Escribe en tandas de 200 con upsert por id, acumula errores sin abortar
async function escribirTandas(client, tabla, rows, errores) {
  const BATCH = 200;
  let escritos = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const tanda = rows.slice(i, i + BATCH);
    const { error } = await client.from(tabla)
      .upsert(tanda, { onConflict: 'id' });
    if (error) {
      errores.push(`${tabla} tanda ${Math.floor(i / BATCH)}: ${error.message}`);
    } else {
      escritos += tanda.length;
    }
  }
  return escritos;
}

async function contarTabla(client, tabla, errores) {
  const { count, error } = await client.from(tabla)
    .select('id', { count: 'exact', head: true });
  if (error) { errores.push(`count ${tabla}: ${error.message}`); return -1; }
  return count || 0;
}

export const maxDuration = 60;

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET) return err(res, 'Falta env CRON_SECRET', 500);
  if (!authorized(req)) return err(res, 'No autorizado', 401);

  if (!process.env.CTRL_DESPACHOS_URL) return err(res, 'Falta env CTRL_DESPACHOS_URL', 500);
  if (!process.env.CTRL_DESPACHOS_SERVICE_KEY) return err(res, 'Falta env CTRL_DESPACHOS_SERVICE_KEY', 500);
  if (!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)) return err(res, 'Falta env SUPABASE_URL', 500);
  if (!process.env.SUPABASE_SERVICE_KEY) return err(res, 'Falta env SUPABASE_SERVICE_KEY', 500);

  erp = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
  cd = createClient(process.env.CTRL_DESPACHOS_URL, process.env.CTRL_DESPACHOS_SERVICE_KEY);

  const dry = req.query.dry !== '0';
  const now = new Date().toISOString();
  const errores = [];
  const leidos = { proyectos: 0, envios: 0, bultos: 0 };
  const escritos = { proyectos: 0, envios: 0, bultos: 0 };

  try {
    // ── 1. Leer origen ──────────────────────────────────────────────────
    const srcProyectos = await leerTodo(cd, 'proyectos');
    const srcEnvios = await leerTodo(cd, 'despacho_muebles');
    const srcBultos = await leerTodo(cd, 'bultos');

    leidos.proyectos = srcProyectos.length;
    leidos.envios = srcEnvios.length;
    leidos.bultos = srcBultos.length;

    // ── 2. Mapear ───────────────────────────────────────────────────────
    const rowsProyectos = srcProyectos.map(p => ({
      id: p.id,
      nombre: p.nombre,
      descripcion: p.descripcion,
      fecha_creacion: p.fecha_creacion,
      estado: p.estado,
      odf_proyecto_id: p.odf_proyecto_id,
      odf_numero: p.odf_numero,
      migrado_en: now,
    }));

    const rowsEnvios = srcEnvios.map(m => ({
      id: m.id,
      proyecto_id: m.proyecto_id,
      mf_n: m.mf_n,
      codigo: m.codigo,
      nombre: m.nombre,
      cant: m.cant,
      impreso: m.impreso,
      impreso_at: m.impreso_at,
      completado_sync_en: m.completado_sync_en,
      fuera_sync_en: m.fuera_sync_en,
      creado_en: m.creado_en,
      envio: m.envio,
    }));

    const rowsBultos = srcBultos.map(b => ({
      id: b.id,
      proyecto_id: b.proyecto_id,
      numero: b.numero,
      descripcion: b.descripcion,
      escaneado: b.escaneado,
      fecha_escaneo: b.fecha_escaneo,
      mueble_mf_n: b.mueble_mf_n,
      envio: b.envio,
    }));

    // ── 3. Escribir (si no es dry) ──────────────────────────────────────
    if (!dry) {
      escritos.proyectos = await escribirTandas(erp, 'despacho_proyectos', rowsProyectos, errores);
      escritos.envios = await escribirTandas(erp, 'despacho_envios', rowsEnvios, errores);
      escritos.bultos = await escribirTandas(erp, 'despacho_bultos', rowsBultos, errores);
    }

    // ── 4. Counts de destino ────────────────────────────────────────────
    const destino_final = {
      despacho_proyectos: await contarTabla(erp, 'despacho_proyectos', errores),
      despacho_envios: await contarTabla(erp, 'despacho_envios', errores),
      despacho_bultos: await contarTabla(erp, 'despacho_bultos', errores),
    };

    // ── 5. Legacy sin mueble vs huérfanos reales ─────────────────────────
    const envioKeys = new Set(srcEnvios.map(m => m.proyecto_id + '|' + m.mf_n + '|' + (m.envio || '')));
    const legacy = srcBultos.filter(b => b.mueble_mf_n == null || b.mueble_mf_n === '');
    const huerfanosAll = srcBultos.filter(b => {
      if (b.mueble_mf_n == null || b.mueble_mf_n === '') return false;
      return !envioKeys.has(b.proyecto_id + '|' + b.mueble_mf_n + '|' + (b.envio || ''));
    });
    const legacy_sin_mueble = { total: legacy.length };
    const huerfanos = {
      total: huerfanosAll.length,
      muestra: huerfanosAll.slice(0, 10).map(b => ({
        id: b.id,
        proyecto_id: b.proyecto_id,
        mueble_mf_n: b.mueble_mf_n,
        envio: b.envio,
        descripcion: b.descripcion,
      })),
    };

    return ok(res, { dry, leidos, escritos, destino_final, legacy_sin_mueble, huerfanos, errores });
  } catch (e) {
    console.error('[despachos-migrar]', e);
    errores.push(String((e && e.message) || e));
    return res.status(500).json({ ok: false, dry, leidos, escritos, errores });
  }
}
