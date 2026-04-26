// api/tiempos.js
// Tablas Supabase necesarias (ejecutar en SQL Editor):
//
// CREATE TABLE IF NOT EXISTS jornadas (
//   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
//   empleado_id TEXT NOT NULL,
//   fecha DATE NOT NULL,
//   entrada TIMESTAMPTZ NOT NULL DEFAULT NOW(),
//   salida TIMESTAMPTZ,
//   tarde BOOLEAN DEFAULT false,
//   descanso_minutos INTEGER DEFAULT 30,
//   descanso_editado BOOLEAN DEFAULT false,
//   editado_por TEXT,
//   UNIQUE(empleado_id, fecha)
// );
//
// CREATE TABLE IF NOT EXISTS registros_trabajo (
//   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
//   empleado_id TEXT NOT NULL,
//   jornada_id UUID,
//   proyecto_id TEXT,
//   proyecto_nombre TEXT,
//   item_id TEXT,
//   item_nombre TEXT,
//   centro TEXT,
//   inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
//   fin TIMESTAMPTZ,
//   estado TEXT DEFAULT 'activo',  -- activo | pausado | finalizado | retrabajo
//   es_retrabajo BOOLEAN DEFAULT false,
//   motivo_retrabajo TEXT,
//   creado_at TIMESTAMPTZ DEFAULT NOW()
// );
//
// CREATE TABLE IF NOT EXISTS checklist_respuestas (
//   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
//   registro_trabajo_id UUID,
//   empleado_id TEXT,
//   respuestas JSONB,
//   creado_at TIMESTAMPTZ DEFAULT NOW()
// );
//
// CREATE TABLE IF NOT EXISTS registros_cnc (
//   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
//   registro_trabajo_id UUID,
//   empleado_id TEXT,
//   placa_numero INTEGER,
//   inicio TIMESTAMPTZ,
//   fin TIMESTAMPTZ,
//   resultado TEXT,   -- ok | error | saltada
//   creado_at TIMESTAMPTZ DEFAULT NOW()
// );
//
// CREATE TABLE IF NOT EXISTS proyectos_cache (
//   id TEXT PRIMARY KEY,
//   nombre TEXT,
//   cliente TEXT,
//   items JSONB DEFAULT '[]',
//   activo BOOLEAN DEFAULT true,
//   sincronizado_at TIMESTAMPTZ DEFAULT NOW()
// );

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

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS });

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  let body = {};
  if (req.method === 'POST' || req.method === 'PATCH') {
    try { body = await req.json(); } catch { body = {}; }
  }

  try {

    // ── GET diagnóstico de conexión ───────────────────────────────────────
    if (action === 'ping' && req.method === 'GET') {
      const hasKey = !!(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);
      const { error } = await supabase.from('empleados').select('count').limit(1);
      return ok({ ok: !error, hasKey, supabaseUrl: process.env.SUPABASE_URL || 'hardcoded', error: error?.message || null });
    }

    // ── GET empleados activos ─────────────────────────────────────────────
    if (action === 'empleados' && req.method === 'GET') {
      const { data, error } = await supabase
        .from('empleados')
        .select('id,nombre,cedula,categoria,centros_autorizados,pin,horario_entrada,horario_salida')
        .eq('activo', true)
        .order('nombre');
      if (error) throw error;
      return ok({ empleados: data });
    }

    // ── POST crear/sync empleado (busca por nombre, insert o update) ──────
    if ((action === 'crear-empleado' || action === 'sync-empleado') && req.method === 'POST') {
      const nombre = (body.nombre || '').trim();
      if (!nombre) return err('nombre requerido');

      const campos = {
        nombre,
        cedula: body.cedula || null,
        categoria: body.categoria || 'directo',
        centros_autorizados: body.centros_autorizados || [],
        pin: body.pin || '1234',
        horario_entrada: body.horario_entrada || '08:00',
        horario_salida:  body.horario_salida  || '17:00',
        activo: true,
      };

      const { data: existing } = await supabase
        .from('empleados').select('id').eq('nombre', nombre).maybeSingle();

      let data, error;
      if (existing) {
        ({ data, error } = await supabase.from('empleados').update(campos).eq('id', existing.id).select().single());
      } else {
        ({ data, error } = await supabase.from('empleados').insert(campos).select().single());
      }
      if (error) throw error;
      return ok({ empleado: data });
    }

    // ── GET jornada de hoy para un empleado ──────────────────────────────
    if (action === 'jornada-hoy' && req.method === 'GET') {
      const empleado_id = url.searchParams.get('empleado_id');
      const hoy = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('jornadas').select('*').eq('empleado_id', empleado_id).eq('fecha', hoy).maybeSingle();
      return ok({ jornada: data });
    }

    // ── POST marcar entrada ───────────────────────────────────────────────
    if (action === 'entrada' && req.method === 'POST') {
      const { empleado_id } = body;
      const hoy = new Date().toISOString().split('T')[0];
      const ahora = new Date().toISOString();

      const { data: emp } = await supabase
        .from('empleados').select('horario_entrada').eq('id', empleado_id).single();

      const [h, m] = (emp?.horario_entrada || '08:00').split(':');
      const esperado = new Date();
      esperado.setHours(parseInt(h), parseInt(m), 0, 0);
      const tarde = new Date() > new Date(esperado.getTime() + 10 * 60000);

      const { data, error } = await supabase
        .from('jornadas')
        .upsert({ empleado_id, fecha: hoy, entrada: ahora, tarde }, { onConflict: 'empleado_id,fecha' })
        .select().single();
      if (error) throw error;
      return ok({ jornada: data });
    }

    // ── POST marcar salida ────────────────────────────────────────────────
    if (action === 'salida' && req.method === 'POST') {
      const { empleado_id, jornada_id } = body;
      const ahora = new Date().toISOString();

      await supabase.from('registros_trabajo')
        .update({ fin: ahora, estado: 'pausado' })
        .eq('empleado_id', empleado_id).eq('estado', 'activo');

      const { data } = await supabase
        .from('jornadas').update({ salida: ahora }).eq('id', jornada_id).select().single();
      return ok({ jornada: data });
    }

    // ── POST iniciar tarea ────────────────────────────────────────────────
    if (action === 'iniciar-tarea' && req.method === 'POST') {
      const { empleado_id, jornada_id, proyecto_id, proyecto_nombre,
              item_id, item_nombre, centro } = body;
      const ahora = new Date().toISOString();

      await supabase.from('registros_trabajo')
        .update({ fin: ahora, estado: 'pausado' })
        .eq('empleado_id', empleado_id).eq('estado', 'activo');

      const { data, error } = await supabase.from('registros_trabajo')
        .insert({ empleado_id, jornada_id, proyecto_id, proyecto_nombre,
                  item_id, item_nombre, centro, inicio: ahora, estado: 'activo' })
        .select().single();
      if (error) throw error;
      return ok({ registro: data });
    }

    // ── POST finalizar tarea ──────────────────────────────────────────────
    if (action === 'finalizar-tarea' && req.method === 'POST') {
      const { registro_id, empleado_id, respuestas_checklist,
              es_retrabajo, motivo_retrabajo } = body;
      const ahora = new Date().toISOString();

      const { data } = await supabase.from('registros_trabajo')
        .update({ fin: ahora,
                  estado: es_retrabajo ? 'retrabajo' : 'finalizado',
                  es_retrabajo: es_retrabajo || false,
                  motivo_retrabajo: motivo_retrabajo || null })
        .eq('id', registro_id).select().single();

      if (respuestas_checklist && Object.keys(respuestas_checklist).length > 0) {
        await supabase.from('checklist_respuestas').insert({
          registro_trabajo_id: registro_id, empleado_id, respuestas: respuestas_checklist,
        });
      }
      return ok({ registro: data });
    }

    // ── POST registro CNC placa individual ────────────────────────────────
    if (action === 'cnc-placa' && req.method === 'POST') {
      const { registro_trabajo_id, empleado_id, placa_numero, inicio, fin, resultado } = body;
      const { data, error } = await supabase.from('registros_cnc')
        .insert({ registro_trabajo_id, empleado_id, placa_numero, inicio, fin, resultado })
        .select().single();
      if (error) throw error;
      return ok({ placa: data });
    }

    // ── GET dashboard tiempo real ─────────────────────────────────────────
    if (action === 'dashboard-live' && req.method === 'GET') {
      const hoy = new Date().toISOString().split('T')[0];
      const [{ data: jornadas }, { data: activos }, { data: todos }, { data: cnc_activo }] = await Promise.all([
        supabase.from('jornadas').select('*, empleados(id,nombre,categoria,centros_autorizados,horario_entrada)').eq('fecha', hoy),
        supabase.from('registros_trabajo').select('*').eq('estado', 'activo'),
        supabase.from('empleados').select('id,nombre,categoria,horario_entrada').eq('activo', true),
        supabase.from('registros_cnc').select('*').is('fin', null).order('creado_at', { ascending: false }).limit(10),
      ]);
      return ok({ jornadas, activos, todos_empleados: todos, cnc_activo });
    }

    // ── GET registros de trabajo de un empleado hoy ───────────────────────
    if (action === 'registros-hoy' && req.method === 'GET') {
      const empleado_id = url.searchParams.get('empleado_id');
      const hoy = new Date().toISOString().split('T')[0];
      const { data } = await supabase.from('registros_trabajo').select('*')
        .eq('empleado_id', empleado_id).gte('inicio', hoy).order('inicio', { ascending: false });
      return ok({ registros: data });
    }

    // ── GET proyectos activos desde proyectos_cache (para planta) ─────────
    if (action === 'proyectos-activos' && req.method === 'GET') {
      const { data } = await supabase.from('proyectos_cache').select('*').eq('activo', true).order('nombre');
      return ok({ proyectos: data || [] });
    }

    // ── GET todos los proyectos (para admin) ──────────────────────────────
    if (action === 'proyectos-admin' && req.method === 'GET') {
      const { data, error } = await supabase.from('proyectos_cache').select('*').order('nombre');
      if (error) throw error;
      return ok({ proyectos: data || [] });
    }

    // ── POST sync proyecto desde admin ────────────────────────────────────
    if (action === 'sync-proyecto' && req.method === 'POST') {
      const { id, nombre, cliente, items } = body;
      const { data, error } = await supabase.from('proyectos_cache')
        .upsert({ id, nombre, cliente, items, sincronizado_at: new Date().toISOString() }, { onConflict: 'id' })
        .select().single();
      if (error) throw error;
      return ok({ proyecto: data });
    }

    // ── PATCH editar jornada (supervisor) ─────────────────────────────────
    if (action === 'editar-jornada' && req.method === 'PATCH') {
      const { jornada_id, entrada, salida, descanso_minutos, editor_id } = body;
      const { data } = await supabase.from('jornadas')
        .update({ entrada, salida, descanso_minutos, descanso_editado: true, editado_por: editor_id })
        .eq('id', jornada_id).select().single();
      return ok({ jornada: data });
    }

    // ── PATCH actualizar empleado existente ───────────────────────────────
    if (action === 'actualizar-empleado' && req.method === 'PATCH') {
      const { nombre, categoria, centros_autorizados, cedula } = body;
      if (!nombre) return err('nombre requerido');
      const { data, error } = await supabase
        .from('empleados')
        .update({ categoria, centros_autorizados, cedula: cedula || null })
        .eq('nombre', nombre)
        .select().single();
      if (error) throw error;
      return ok({ empleado: data });
    }

    // ── GET registros de trabajo (sesiones + historial para admin) ────────
    if (action === 'registros-todos' && req.method === 'GET') {
      const dias = parseInt(url.searchParams.get('dias') || '60');
      const desde = new Date();
      desde.setDate(desde.getDate() - dias);
      const { data, error } = await supabase.from('registros_trabajo').select('*')
        .gte('inicio', desde.toISOString()).order('inicio', { ascending: false });
      if (error) throw error;
      return ok({ registros: data || [] });
    }

    return err('Acción no reconocida: ' + action);

  } catch (e) {
    return err(e.message, 500);
  }
}
