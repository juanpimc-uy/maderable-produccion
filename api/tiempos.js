// api/tiempos.js
// Tablas Supabase necesarias (ejecutar una vez en SQL Editor):
//
// CREATE TABLE IF NOT EXISTS jornadas (
//   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
//   empleado_id TEXT NOT NULL,
//   fecha DATE NOT NULL,
//   entrada TIMESTAMPTZ NOT NULL DEFAULT NOW(),
//   salida TIMESTAMPTZ,
//   UNIQUE(empleado_id, fecha)
// );
//
// CREATE TABLE IF NOT EXISTS registros_trabajo (
//   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
//   jornada_id UUID,
//   empleado_id TEXT NOT NULL,
//   proyecto_id TEXT,
//   proyecto_nombre TEXT,
//   item_id TEXT,
//   item_nombre TEXT,
//   item_hest NUMERIC DEFAULT 0,
//   centro TEXT,
//   inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
//   fin TIMESTAMPTZ,
//   es_retrabajo BOOLEAN DEFAULT false,
//   motivo_retrabajo TEXT,
//   respuestas_checklist JSONB
// );
//
// CREATE TABLE IF NOT EXISTS cnc_placas (
//   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
//   registro_trabajo_id UUID,
//   empleado_id TEXT,
//   placa_numero INTEGER,
//   inicio TIMESTAMPTZ,
//   fin TIMESTAMPTZ,
//   resultado TEXT
// );
//
// CREATE TABLE IF NOT EXISTS proyectos_cache (
//   id TEXT PRIMARY KEY,
//   nombre TEXT,
//   cliente TEXT,
//   items JSONB DEFAULT '[]',
//   activo BOOLEAN DEFAULT true,
//   creado_at TIMESTAMPTZ DEFAULT NOW()
// );

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xhfeurinovvsbgobkidy.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sbHeaders(extra = {}) {
  return {
    apikey: SB_KEY,
    Authorization: `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function sbGet(table, qs = '') {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${qs}`, {
    headers: sbHeaders(),
  });
  if (!r.ok) throw new Error(`sbGet ${table}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function sbPost(table, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: sbHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`sbPost ${table}: ${r.status} ${await r.text()}`);
  const data = await r.json();
  return Array.isArray(data) ? data[0] : data;
}

async function sbPatch(table, qs, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${qs}`, {
    method: 'PATCH',
    headers: sbHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`sbPatch ${table}: ${r.status} ${await r.text()}`);
  const data = await r.json();
  return Array.isArray(data) ? data[0] : data;
}

async function sbUpsert(table, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: sbHeaders({ Prefer: 'return=representation,resolution=merge-duplicates' }),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`sbUpsert ${table}: ${r.status} ${await r.text()}`);
  const data = await r.json();
  return Array.isArray(data) ? data[0] : data;
}

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {
    // ── GET empleados activos ─────────────────────────────────────────────
    if (action === 'empleados' && req.method === 'GET') {
      const rows = await sbGet(
        'empleados',
        'activo=eq.true&select=id,nombre,pin,categoria,centros_autorizados&order=nombre.asc'
      );
      return res.json(rows);
    }

    // ── POST entrada ─ crea jornada si no existe hoy ──────────────────────
    if (action === 'entrada' && req.method === 'POST') {
      const { empleado_id } = req.body;
      if (!empleado_id) return res.status(400).json({ error: 'empleado_id requerido' });

      const hoy = new Date().toISOString().slice(0, 10);
      const existing = await sbGet('jornadas', `empleado_id=eq.${empleado_id}&fecha=eq.${hoy}&select=*`);

      let jornada;
      if (existing.length > 0) {
        jornada = existing[0];
      } else {
        jornada = await sbPost('jornadas', {
          empleado_id,
          fecha: hoy,
          entrada: new Date().toISOString(),
        });
      }

      const tareas = await sbGet(
        'registros_trabajo',
        `jornada_id=eq.${jornada.id}&fin=is.null&select=*&limit=1`
      );

      return res.json({
        jornada,
        tarea_activa: tareas[0] || null,
        ya_marcada: existing.length > 0,
      });
    }

    // ── POST salida ───────────────────────────────────────────────────────
    if (action === 'salida' && req.method === 'POST') {
      const { jornada_id } = req.body;
      if (!jornada_id) return res.status(400).json({ error: 'jornada_id requerido' });

      // Finalizar tarea activa si existe
      const activas = await sbGet('registros_trabajo', `jornada_id=eq.${jornada_id}&fin=is.null&select=id`);
      for (const t of activas) {
        await sbPatch('registros_trabajo', `id=eq.${t.id}`, { fin: new Date().toISOString() });
      }

      const jornada = await sbPatch('jornadas', `id=eq.${jornada_id}`, {
        salida: new Date().toISOString(),
      });
      return res.json({ ok: true, jornada });
    }

    // ── GET resumen del día ───────────────────────────────────────────────
    if (action === 'resumen' && req.method === 'GET') {
      const { jornada_id } = req.query;
      const jornadas = await sbGet('jornadas', `id=eq.${jornada_id}&select=*`);
      const tareas = await sbGet(
        'registros_trabajo',
        `jornada_id=eq.${jornada_id}&fin=not.is.null&select=id,inicio,fin,item_nombre`
      );

      const j = jornadas[0];
      let totalSecs = 0;
      tareas.forEach(t => {
        if (t.inicio && t.fin) totalSecs += (new Date(t.fin) - new Date(t.inicio)) / 1000;
      });

      return res.json({
        jornada: j,
        tareas_completadas: tareas.length,
        total_segundos: Math.floor(totalSecs),
        descanso_min: 30,
      });
    }

    // ── POST iniciar-tarea ────────────────────────────────────────────────
    if (action === 'iniciar-tarea' && req.method === 'POST') {
      const { empleado_id, jornada_id, proyecto_id, proyecto_nombre,
              item_id, item_nombre, item_hest, centro } = req.body;

      // Finalizar tareas activas previas
      const activas = await sbGet('registros_trabajo', `jornada_id=eq.${jornada_id}&fin=is.null&select=id`);
      for (const t of activas) {
        await sbPatch('registros_trabajo', `id=eq.${t.id}`, { fin: new Date().toISOString() });
      }

      const registro = await sbPost('registros_trabajo', {
        jornada_id,
        empleado_id,
        proyecto_id,
        proyecto_nombre,
        item_id,
        item_nombre,
        item_hest: item_hest || 0,
        centro,
        inicio: new Date().toISOString(),
      });

      return res.json({ registro });
    }

    // ── POST finalizar-tarea ──────────────────────────────────────────────
    if (action === 'finalizar-tarea' && req.method === 'POST') {
      const { registro_id, respuestas_checklist, es_retrabajo, motivo_retrabajo } = req.body;
      const registro = await sbPatch('registros_trabajo', `id=eq.${registro_id}`, {
        fin: new Date().toISOString(),
        respuestas_checklist: respuestas_checklist || null,
        es_retrabajo: !!es_retrabajo,
        motivo_retrabajo: motivo_retrabajo || null,
      });
      return res.json({ ok: true, registro });
    }

    // ── POST cnc-placa ────────────────────────────────────────────────────
    if (action === 'cnc-placa' && req.method === 'POST') {
      const { registro_trabajo_id, empleado_id, placa_numero, inicio, fin, resultado } = req.body;
      const placa = await sbPost('cnc_placas', {
        registro_trabajo_id,
        empleado_id,
        placa_numero,
        inicio,
        fin,
        resultado,
      });
      return res.json({ ok: true, placa });
    }

    // ── GET proyectos activos ─────────────────────────────────────────────
    if (action === 'proyectos-activos' && req.method === 'GET') {
      const rows = await sbGet('proyectos_cache', 'activo=eq.true&select=*&order=nombre.asc');
      return res.json(rows);
    }

    // ── POST sync-proyecto ────────────────────────────────────────────────
    if (action === 'sync-proyecto' && req.method === 'POST') {
      const { id, nombre, cliente, items } = req.body;
      const row = await sbUpsert('proyectos_cache', { id, nombre, cliente, items, activo: true });
      return res.json({ ok: true, row });
    }

    return res.status(400).json({ error: `action no reconocida: ${action}` });
  } catch (err) {
    console.error('[api/tiempos]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
