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
      console.log('Consultando proyectos_cache...');
      const { data, error } = await supabase.from('proyectos_cache').select('*').eq('activo', true).order('nombre');
      console.log('Proyectos encontrados:', data?.length, error?.message);
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
      console.log('Sync proyecto recibido:', { id, nombre, cliente, itemsCount: items?.length });
      const { data, error } = await supabase.from('proyectos_cache')
        .upsert({ id, nombre, cliente, items: items || [], activo: true, sincronizado_at: new Date().toISOString() }, { onConflict: 'id' })
        .select().single();
      console.log('Resultado upsert:', { ok: !error, id: data?.id, error: error?.message });
      if (error) throw error;
      return ok({ proyecto: data, ok: true });
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

    // ── GET horas reales por proyecto (desde registros_trabajo) ──────────
    if (action === 'registros-proyecto' && req.method === 'GET') {
      const proyecto_id = url.searchParams.get('proyecto_id');
      const { data, error } = await supabase
        .from('registros_trabajo')
        .select('inicio, fin, estado, empleado_id, item_id, centro')
        .eq('proyecto_id', proyecto_id)
        .not('fin', 'is', null);
      if (error) throw error;
      const horas_totales = (data || []).reduce((sum, r) => {
        const mins = (new Date(r.fin) - new Date(r.inicio)) / 60000;
        return sum + mins / 60;
      }, 0);
      return ok({ horas_totales: Math.round(horas_totales * 10) / 10, registros: data || [] });
    }

    // ── GET placa CNC activa (sin fin) para un registro de trabajo ───────
    if (action === 'get-cnc-activo' && req.method === 'GET') {
      const registro_trabajo_id = url.searchParams.get('registro_trabajo_id');
      const { data, error } = await supabase
        .from('registros_cnc')
        .select('*')
        .eq('registro_trabajo_id', registro_trabajo_id)
        .is('fin', null)
        .order('creado_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return ok({ placa: data });
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

    // ── GET último registro por centro/proyecto/ítem ──────────────────────
    if (action === 'ultimo-registro' && req.method === 'GET') {
      const centro      = url.searchParams.get('centro');
      const proyecto_id = url.searchParams.get('proyecto_id');
      const item_id     = url.searchParams.get('item_id');

      const { data, error } = await supabase
        .from('registros_trabajo')
        .select('empleado_id, inicio, fin, estado')
        .eq('centro', centro)
        .eq('proyecto_id', proyecto_id)
        .eq('item_id', item_id)
        .order('inicio', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!data) return ok({ registro: null });

      const { data: emp } = await supabase
        .from('empleados').select('nombre').eq('id', data.empleado_id).maybeSingle();

      return ok({ registro: { ...data, empleado_nombre: emp?.nombre || data.empleado_id } });
    }

    // ── GET proyectos completos (todos los campos para HTML) ──────────────
    if (action === 'proyectos-completos' && req.method === 'GET') {
      const { data, error } = await supabase.from('proyectos_cache').select('*').eq('activo', true).order('nombre');
      if (error) throw error;
      return ok({ proyectos: (data || []).map(p => ({
        id: p.id,
        numero: p.numero || p.nombre,
        obra: p.obra || p.nombre,
        clienteNombre: p.cliente_nombre || p.cliente,
        fechaInicio: p.fecha_inicio,
        fechaEntrega: p.fecha_entrega,
        notas: p.notas,
        estado: p.estado || 'en_produccion',
        muebles: p.muebles || p.items || [],
        materiales: p.materiales || [],
        sosCargadas: p.sos_cargadas || [],
        modulos: p.modulos || [],
        creadoEn: p.creado_en,
      })) });
    }

    // ── POST guardar proyecto completo ────────────────────────────────────
    if (action === 'guardar-proyecto' && req.method === 'POST') {
      const { id, numero, obra, clienteNombre, fechaInicio, fechaEntrega,
              notas, estado, muebles, materiales, sosCargadas, modulos, creadoEn } = body;
      const { data, error } = await supabase.from('proyectos_cache')
        .upsert({
          id, nombre: numero || obra, numero, obra,
          cliente: clienteNombre, cliente_nombre: clienteNombre,
          fecha_inicio: fechaInicio, fecha_entrega: fechaEntrega,
          notas, estado: estado || 'en_produccion',
          muebles: muebles || [], items: muebles || [],
          materiales: materiales || [],
          sos_cargadas: sosCargadas || [],
          modulos: modulos || [],
          creado_en: creadoEn,
          activo: true, sincronizado_at: new Date().toISOString(),
        }, { onConflict: 'id' })
        .select().single();
      if (error) throw error;
      return ok({ proyecto: data });
    }

    // ── GET órdenes de compra ─────────────────────────────────────────────
    if (action === 'ocs' && req.method === 'GET') {
      const { data, error } = await supabase.from('ordenes_compra').select('*').order('creado_at', { ascending: false });
      if (error) throw error;
      return ok({ ocs: (data || []).map(o => ({
        id: o.id, numero: o.numero, proveedor: o.proveedor,
        proyectoId: o.proyecto_id, muebleId: o.mueble_id,
        estado: o.estado, fecha: o.fecha, items: o.items || [],
      })) });
    }

    // ── POST guardar OC ───────────────────────────────────────────────────
    if (action === 'guardar-oc' && req.method === 'POST') {
      const { id, numero, proveedor, proyectoId, muebleId, estado, fecha, items } = body;
      const { data, error } = await supabase.from('ordenes_compra')
        .upsert({ id, numero, proveedor, proyecto_id: proyectoId, mueble_id: muebleId,
                  estado: estado || 'pendiente', fecha, items: items || [] }, { onConflict: 'id' })
        .select().single();
      if (error) throw error;
      return ok({ oc: data });
    }

    // ── GET recepciones de material ───────────────────────────────────────
    if (action === 'recepciones' && req.method === 'GET') {
      const { data, error } = await supabase.from('recepciones_material').select('*').order('creado_at', { ascending: false });
      if (error) throw error;
      return ok({ recepciones: (data || []).map(r => ({
        id: r.id, fecha: r.fecha, proveedor: r.proveedor,
        ocNum: r.oc_num, obs: r.obs, items: r.items || [], impactados: r.impactados || [],
      })) });
    }

    // ── POST guardar recepción ────────────────────────────────────────────
    if (action === 'guardar-recepcion' && req.method === 'POST') {
      const { id, fecha, proveedor, ocNum, obs, items, impactados } = body;
      const { data, error } = await supabase.from('recepciones_material')
        .insert({ id, fecha, proveedor, oc_num: ocNum, obs, items: items || [], impactados: impactados || [] })
        .select().single();
      if (error) throw error;
      return ok({ recepcion: data });
    }

    // ── GET partidas tercerizados ─────────────────────────────────────────
    if (action === 'partidas' && req.method === 'GET') {
      const { data, error } = await supabase.from('partidas_terceros').select('*').order('creado_at', { ascending: false });
      if (error) throw error;
      return ok({ partidas: (data || []).map(p => ({
        id: p.id, tipo: p.tipo, proyectoNum: p.proyecto_num, obra: p.obra,
        muebleCodigo: p.mueble_codigo, muebleNombre: p.mueble_nombre,
        estado: p.estado, partes: p.partes, tipoDespacho: p.tipo_despacho,
        fechaDespacho: p.fecha_despacho, fechaRecepcion: p.fecha_recepcion,
        estadoRecep: p.estado_recep, obs: p.obs, nota: p.nota,
      })) });
    }

    // ── POST guardar partida ──────────────────────────────────────────────
    if (action === 'guardar-partida' && req.method === 'POST') {
      const { id, tipo, proyectoNum, obra, muebleCodigo, muebleNombre,
              estado, partes, tipoDespacho, fechaDespacho, fechaRecepcion,
              estadoRecep, obs, nota } = body;
      const { data, error } = await supabase.from('partidas_terceros')
        .upsert({ id, tipo, proyecto_num: proyectoNum, obra,
                  mueble_codigo: muebleCodigo, mueble_nombre: muebleNombre,
                  estado: estado || 'en_taller', partes, tipo_despacho: tipoDespacho,
                  fecha_despacho: fechaDespacho, fecha_recepcion: fechaRecepcion,
                  estado_recep: estadoRecep, obs, nota }, { onConflict: 'id' })
        .select().single();
      if (error) throw error;
      return ok({ partida: data });
    }

    // ── GET despachos ─────────────────────────────────────────────────────
    if (action === 'despachos-lista' && req.method === 'GET') {
      const { data, error } = await supabase.from('despachos').select('*').order('creado_at', { ascending: false });
      if (error) throw error;
      return ok({ despachos: (data || []).map(d => ({
        id: d.id, proyectoId: d.proyecto_id, proyectoNum: d.proyecto_num,
        obra: d.obra, cliente: d.cliente, fecha: d.fecha, resp: d.resp,
        transp: d.transp, obs: d.obs, bultos: d.bultos || [],
        totalModulos: d.total_modulos, verificado: d.verificado,
        bultos_verificados: d.bultos_verificados || [],
      })) });
    }

    // ── POST guardar despacho ─────────────────────────────────────────────
    if (action === 'guardar-despacho' && req.method === 'POST') {
      const { id, proyectoId, proyectoNum, obra, cliente, fecha, resp, transp,
              obs, bultos, totalModulos, verificado, bultos_verificados } = body;
      const { data, error } = await supabase.from('despachos')
        .upsert({ id, proyecto_id: proyectoId, proyecto_num: proyectoNum, obra, cliente,
                  fecha, resp, transp, obs, bultos: bultos || [],
                  total_modulos: totalModulos || 0, verificado: verificado || false,
                  bultos_verificados: bultos_verificados || [] }, { onConflict: 'id' })
        .select().single();
      if (error) throw error;
      return ok({ despacho: data });
    }

    // ── GET configuración global ──────────────────────────────────────────
    if (action === 'config' && req.method === 'GET') {
      const { data, error } = await supabase.from('config_global').select('*');
      if (error) throw error;
      const cfg = {};
      (data || []).forEach(row => { cfg[row.clave] = row.valor; });
      return ok({ config: cfg });
    }

    // ── POST guardar configuración ────────────────────────────────────────
    if (action === 'guardar-config' && req.method === 'POST') {
      const { clave, valor } = body;
      const { data, error } = await supabase.from('config_global')
        .upsert({ clave, valor, actualizado_at: new Date().toISOString() }, { onConflict: 'clave' })
        .select().single();
      if (error) throw error;
      return ok({ ok: true });
    }

    return err('Acción no reconocida: ' + action);

  } catch (e) {
    return err(e.message, 500);
  }
}
