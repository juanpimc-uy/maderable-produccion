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

// ── Error controlado desde helpers ────────────────────────────────────────
class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ── Constantes compartidas ─────────────────────────────────────────────────
const CENTROS_CON_ITEM = ['Shop Drawing', 'Modelado', 'Cam'];

// ── Helpers unificados ─────────────────────────────────────────────────────

async function _entradaImpl(sb, { empleado_id }) {
  const hoy = new Date().toISOString().split('T')[0];
  const ahora = new Date().toISOString();
  const { data: emp } = await sb
    .from('empleados').select('horario_entrada').eq('id', empleado_id).single();
  const [h, m] = (emp?.horario_entrada || '08:00').split(':');
  const esperado = new Date();
  esperado.setHours(parseInt(h), parseInt(m), 0, 0);
  const tarde = new Date() > new Date(esperado.getTime() + 10 * 60000);
  const { data, error } = await sb.from('jornadas')
    .upsert({ empleado_id, fecha: hoy, entrada: ahora, tarde }, { onConflict: 'empleado_id,fecha' })
    .select().single();
  if (error) throw error;
  return { jornada: data };
}

async function _salidaImpl(sb, { empleado_id }) {
  const hoy = new Date().toISOString().split('T')[0];
  const ahora = new Date().toISOString();
  // Cerrar registro activo como 'pausado'; si era descanso, acumular sus minutos
  const { data: activoSalida } = await sb.from('registros_trabajo')
    .select('id').eq('empleado_id', empleado_id).eq('estado', 'activo').maybeSingle();
  if (activoSalida) {
    await _finalizarTareaImpl(sb, {
      empleado_id,
      registro_id: activoSalida.id,
      estado_final: 'pausado',
    });
  }
  const { data } = await sb.from('jornadas')
    .update({ salida: ahora })
    .eq('empleado_id', empleado_id).eq('fecha', hoy).is('salida', null)
    .select().maybeSingle();
  return { jornada: data };
}

async function _tiempoActivoImpl(sb, { empleado_id }) {
  if (!empleado_id) throw new ApiError('empleado_id requerido', 400);
  const { data } = await sb.from('registros_trabajo')
    .select('id, jornada_id, proyecto_id, proyecto_nombre, item_id, item_nombre, centro, inicio, estado')
    .eq('empleado_id', empleado_id).eq('estado', 'activo').maybeSingle();
  if (!data) return { activo: null };
  let es_descanso = false;
  if (data.centro) {
    const { data: cv } = await sb.from('centros_virtuales')
      .select('es_descanso').eq('nombre', data.centro).maybeSingle();
    es_descanso = cv?.es_descanso || false;
  }
  return { activo: { ...data, es_descanso } };
}

async function _iniciarTareaImpl(sb, {
  empleado_id, proyecto_id, proyecto_nombre, centro, item_id, item_nombre,
  _jornada_id = null,   // pasar directamente para wrappers legacy (planta)
  _autoJornada = false, // auto-upsert jornada para wrappers legacy (oficina)
}) {
  const hoy  = new Date().toISOString().split('T')[0];
  const ahora = new Date().toISOString();

  // 1. Verificar empleado activo y obtener rol + centros autorizados
  const { data: emp } = await sb.from('empleados')
    .select('rol_app, centros_autorizados')
    .eq('id', empleado_id).eq('activo', true).maybeSingle();
  if (!emp) throw new ApiError('Empleado no encontrado o inactivo', 404);

  // 2. Resolver jornada_id
  let jornada_id = _jornada_id;
  if (!jornada_id) {
    const { data: jornada } = await sb.from('jornadas')
      .select('id')
      .eq('empleado_id', empleado_id).eq('fecha', hoy).is('salida', null)
      .maybeSingle();
    if (!jornada) {
      if (_autoJornada) {
        const res = await _entradaImpl(sb, { empleado_id });
        jornada_id = res.jornada.id;
      } else {
        throw new ApiError('Sin jornada activa. Registrá la entrada primero.', 400);
      }
    } else {
      jornada_id = jornada.id;
    }
  }

  // 3. Validar centro y determinar es_descanso
  let es_descanso = false;
  if (emp.rol_app === 'operario') {
    // Operario: validar contra centros_autorizados (solo si hay lista configurada)
    const autorizados = emp.centros_autorizados || [];
    if (autorizados.length > 0 && centro && !autorizados.includes(centro)) {
      throw new ApiError('Centro no autorizado para este empleado', 400);
    }
  } else {
    // Oficina / admin: validar contra centros_virtuales
    const { data: cv } = await sb.from('centros_virtuales')
      .select('id, es_descanso').eq('nombre', centro).eq('activo', true).maybeSingle();
    if (!cv) throw new ApiError('Centro virtual no válido', 400);
    es_descanso = cv.es_descanso || false;
  }

  // 4. Validar proyecto / item (omitir si es descanso)
  if (!es_descanso) {
    if (!proyecto_id) throw new ApiError('proyecto_id requerido', 400);
    if (CENTROS_CON_ITEM.includes(centro)) {
      if (!item_id) throw new ApiError(`El centro ${centro} requiere especificar un item`, 400);
      const { data: proyecto, error: pErr } = await sb.from('proyectos_cache')
        .select('muebles').eq('id', proyecto_id).maybeSingle();
      if (pErr) throw pErr;
      if (!proyecto) throw new ApiError('Proyecto no encontrado', 404);
      const muebles = Array.isArray(proyecto.muebles) ? proyecto.muebles : [];
      if (!muebles.some(m => String(m.id) === String(item_id))) {
        throw new ApiError('El item especificado no existe en el proyecto', 400);
      }
    }
  }

  // 5. Cerrar registro activo anterior como 'pausado'
  // Si era un descanso, _finalizarTareaImpl acumula sus minutos en jornadas.descanso_minutos
  const { data: activoPrev } = await sb.from('registros_trabajo')
    .select('id').eq('empleado_id', empleado_id).eq('estado', 'activo').maybeSingle();
  if (activoPrev) {
    await _finalizarTareaImpl(sb, {
      empleado_id,
      registro_id: activoPrev.id,
      estado_final: 'pausado',
    });
  }

  // 6. Insertar nuevo registro
  const persistirItem = !es_descanso && CENTROS_CON_ITEM.includes(centro);
  const { data, error } = await sb.from('registros_trabajo')
    .insert({
      empleado_id,
      jornada_id,
      proyecto_id:     es_descanso ? null : (proyecto_id     || null),
      proyecto_nombre: es_descanso ? null : (proyecto_nombre || ''),
      item_id:    persistirItem ? (item_id    || null) : null,
      item_nombre: persistirItem ? (item_nombre || null) : null,
      centro,
      inicio: ahora,
      fin: null,
      estado: 'activo',
      es_retrabajo: false,
    })
    .select().single();
  if (error) throw error;
  return { registro: data };
}

async function _finalizarTareaImpl(sb, {
  empleado_id, registro_id, estado_final = 'finalizado', motivo_retrabajo = null,
}) {
  // 1. Resolver registro_id (usa el activo si no viene)
  let registroId = registro_id;
  if (!registroId) {
    const { data: activo } = await sb.from('registros_trabajo')
      .select('id').eq('empleado_id', empleado_id).eq('estado', 'activo').maybeSingle();
    if (!activo) throw new ApiError('Sin registro activo', 400);
    registroId = activo.id;
  }

  // 2. Verificar que el registro exista y sea del empleado
  const { data: r, error: rErr } = await sb.from('registros_trabajo')
    .select('id, empleado_id, inicio, fin, estado, centro, jornada_id')
    .eq('id', registroId).maybeSingle();
  if (rErr) throw rErr;
  if (!r) throw new ApiError('Registro no encontrado', 404);
  if (r.empleado_id !== empleado_id) throw new ApiError('No autorizado', 403);
  if (r.estado !== 'activo') throw new ApiError('El registro ya está cerrado', 400);

  // 3. Determinar si el centro es descanso
  let es_descanso = false;
  if (r.centro) {
    const { data: cv } = await sb.from('centros_virtuales')
      .select('es_descanso').eq('nombre', r.centro).maybeSingle();
    es_descanso = cv?.es_descanso || false;
  }

  const fin = new Date().toISOString();
  const durMin = Math.round((new Date(fin) - new Date(r.inicio)) / 60000);

  // 4. Actualizar el registro
  const { data, error } = await sb.from('registros_trabajo')
    .update({
      fin,
      estado: es_descanso ? 'finalizado' : estado_final,
      es_retrabajo: estado_final === 'retrabajo',
      motivo_retrabajo: estado_final === 'retrabajo' ? (motivo_retrabajo || null) : null,
    })
    .eq('id', registroId).select().single();
  if (error) throw error;

  // 5. Si es descanso y hay jornada: acumular según modalidad del empleado
  if (es_descanso && r.jornada_id) {
    const { data: empMod } = await sb.from('empleados')
      .select('descanso_modalidad').eq('id', empleado_id).maybeSingle();
    const modalidad = empMod?.descanso_modalidad || 'sin_limite';

    const { data: jornada } = await sb.from('jornadas')
      .select('descanso_minutos, descanso_excedido_minutos')
      .eq('id', r.jornada_id).maybeSingle();
    const acumActual = jornada?.descanso_minutos || 0;
    const exceActual = jornada?.descanso_excedido_minutos || 0;

    let aDescanso = durMin;
    let aExcedido = 0;

    if (modalidad === 'paga_30') {
      const espacioDisp = Math.max(0, 30 - acumActual);
      aDescanso = Math.min(durMin, espacioDisp);
      aExcedido = durMin - aDescanso;
    }

    await sb.from('jornadas')
      .update({
        descanso_minutos: acumActual + aDescanso,
        descanso_excedido_minutos: exceActual + aExcedido,
      })
      .eq('id', r.jornada_id);
  }

  return { registro: data, duracion_minutos: durMin };
}

// ── Handler principal ──────────────────────────────────────────────────────

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
        .select('id,nombre,cedula,email,rol_app,categoria,centros_autorizados,horario_entrada,horario_salida,descanso_modalidad')
        .eq('activo', true)
        .order('nombre');
      if (error) throw error;
      return ok({ empleados: data });
    }

    // ── POST crear/sync empleado (busca por nombre, insert o update) ──────
    if ((action === 'crear-empleado' || action === 'sync-empleado') && req.method === 'POST') {
      const nombre = (body.nombre || '').trim();
      if (!nombre) return err('nombre requerido');

      // ── Verificar permisos del caller ──────────────────────────────────
      const admin_id = body.admin_id;
      if (!admin_id) return err('admin_id requerido', 400);
      const { data: caller, error: callerErr } = await supabase
        .from('empleados').select('rol_app').eq('id', admin_id).maybeSingle();
      if (callerErr) throw callerErr;
      if (!caller) return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      const callerRol = caller.rol_app;
      if (callerRol === 'operario') return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });

      const { data: existing } = await supabase
        .from('empleados').select('id, rol_app').eq('nombre', nombre).maybeSingle();

      const isInsert = !existing;
      if (isInsert && callerRol !== 'admin') {
        return new Response(JSON.stringify({ ok: false, error: 'Solo admin puede crear empleados' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }

      // ── Verificar jerarquía para UPDATE ───────────────────────────────────
      if (!isInsert && callerRol === 'oficina' && existing.rol_app !== 'operario') {
        return new Response(JSON.stringify({ ok: false, error: 'No tenés permisos para modificar este usuario' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }

      let campos;
      if (callerRol === 'oficina') {
        // Oficina solo puede actualizar centros de operarios
        console.log(`[perms] oficina ${admin_id} actualizando solo centros de ${nombre}`);
        campos = { centros_autorizados: body.centros_autorizados || [] };
      } else {
        // Admin: solo incluir campos que vinieron en el body (no pisar con defaults en UPDATE)
        // Validar descanso_modalidad si viene
        if (body.descanso_modalidad !== undefined && body.descanso_modalidad !== null) {
          const modalidadesValidas = ['paga_30', 'no_paga_60', 'sin_limite'];
          if (!modalidadesValidas.includes(body.descanso_modalidad)) {
            return err('descanso_modalidad debe ser paga_30, no_paga_60 o sin_limite', 400);
          }
        }
        const camposOpcionales = {
          ...(body.cedula !== undefined    ? { cedula: body.cedula || null }                              : {}),
          ...(body.email !== undefined     ? { email: body.email || null }                                : {}),
          ...(body.rol_app                 ? { rol_app: body.rol_app }                                   : {}),
          ...(body.categoria               ? { categoria: body.categoria }                               : {}),
          ...(body.centros_autorizados !== undefined ? { centros_autorizados: body.centros_autorizados } : {}),
          ...(body.horario_entrada         ? { horario_entrada: body.horario_entrada }                   : {}),
          ...(body.horario_salida          ? { horario_salida:  body.horario_salida }                    : {}),
          ...(body.descanso_modalidad !== undefined ? {
            descanso_modalidad: body.descanso_modalidad || null,
          } : {}),
        };

        if (isInsert) {
          // INSERT: defaults explícitos + override con lo que vino
          campos = {
            nombre,
            cedula: null,
            email: null,
            rol_app: 'operario',
            categoria: 'directo',
            centros_autorizados: [],
            pin: '1234',
            horario_entrada: '08:00',
            horario_salida: '17:00',
            activo: true,
            ...camposOpcionales,
          };
        } else {
          // UPDATE: solo nombre + campos que vinieron (no activo, no pin, sin defaults)
          campos = { nombre, ...camposOpcionales };
        }
      }

      let data, error;
      if (existing) {
        ({ data, error } = await supabase.from('empleados').update(campos).eq('id', existing.id).select().single());
      } else {
        ({ data, error } = await supabase.from('empleados').insert(campos).select().single());
      }
      if (error) throw error;
      return ok({ empleado: data });
    }

    // ── POST eliminar empleado (soft-delete, solo admin) ──────────────────
    if (action === 'eliminar-empleado' && req.method === 'POST') {
      const { admin_id, empleado_id } = body;
      if (!admin_id || !empleado_id) return err('admin_id y empleado_id requeridos', 400);
      if (admin_id === empleado_id) {
        return new Response(JSON.stringify({ ok: false, error: 'No podés eliminarte a vos mismo' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
      const { data: caller } = await supabase
        .from('empleados').select('rol_app').eq('id', admin_id).maybeSingle();
      if (!caller || caller.rol_app !== 'admin') {
        return new Response(JSON.stringify({ ok: false, error: 'Solo admin puede eliminar empleados' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
      const { error } = await supabase.from('empleados').update({ activo: false }).eq('id', empleado_id);
      if (error) throw error;
      return ok({ ok: true });
    }

    // ── GET jornada de hoy para un empleado ──────────────────────────────
    if (action === 'jornada-hoy' && req.method === 'GET') {
      const empleado_id = url.searchParams.get('empleado_id');
      const hoy = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('jornadas').select('*').eq('empleado_id', empleado_id).eq('fecha', hoy).maybeSingle();
      return ok({ jornada: data });
    }

    // ── POST marcar entrada (wrapper → _entradaImpl) ──────────────────────
    if (action === 'entrada' && req.method === 'POST') {
      const { empleado_id } = body;
      const result = await _entradaImpl(supabase, { empleado_id });
      return ok(result);
    }

    // ── POST marcar salida (wrapper → _salidaImpl) ────────────────────────
    if (action === 'salida' && req.method === 'POST') {
      const { empleado_id } = body;
      const result = await _salidaImpl(supabase, { empleado_id });
      return ok(result);
    }

    // ── POST iniciar tarea (wrapper → _iniciarTareaImpl) ──────────────────
    if (action === 'iniciar-tarea' && req.method === 'POST') {
      const { empleado_id, jornada_id, proyecto_id, proyecto_nombre,
              item_id, item_nombre, centro } = body;
      const result = await _iniciarTareaImpl(supabase, {
        empleado_id, proyecto_id, proyecto_nombre, centro, item_id, item_nombre,
        _jornada_id: jornada_id, // usa el jornada_id que manda planta directamente
      });
      return ok(result);
    }

    // ── POST finalizar tarea (wrapper → _finalizarTareaImpl + checklist) ──
    if (action === 'finalizar-tarea' && req.method === 'POST') {
      const { registro_id, empleado_id, respuestas_checklist,
              es_retrabajo, motivo_retrabajo } = body;
      const result = await _finalizarTareaImpl(supabase, {
        empleado_id,
        registro_id,
        estado_final: es_retrabajo ? 'retrabajo' : 'finalizado',
        motivo_retrabajo: motivo_retrabajo || null,
      });
      if (respuestas_checklist && Object.keys(respuestas_checklist).length > 0) {
        await supabase.from('checklist_respuestas').insert({
          registro_trabajo_id: registro_id, empleado_id, respuestas: respuestas_checklist,
        });
      }
      return ok({ registro: result.registro });
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

    // ── POST sync proyecto desde admin (full upsert, alias de guardar-proyecto) ──
    if (action === 'sync-proyecto' && req.method === 'POST') {
      const { id, numero, obra, clienteNombre, fechaInicio, fechaEntrega,
              notas, estado, muebles, materiales, sosCargadas, modulos, creadoEn,
              // legacy fields for backwards compat
              nombre, cliente, items } = body;
      const _obra = obra || nombre;
      const _muebles = muebles || items || [];
      const { data, error } = await supabase.from('proyectos_cache')
        .upsert({
          id, nombre: numero || _obra, numero, obra: _obra,
          cliente: clienteNombre || cliente, cliente_nombre: clienteNombre || cliente,
          fecha_inicio: fechaInicio, fecha_entrega: fechaEntrega,
          notas, estado: estado || 'en_produccion',
          muebles: _muebles, items: _muebles,
          materiales: materiales || [],
          sos_cargadas: sosCargadas || [],
          modulos: modulos || [],
          creado_en: creadoEn,
          activo: true, sincronizado_at: new Date().toISOString(),
        }, { onConflict: 'id' })
        .select();
      if (error) throw error;
      return ok({ proyecto: (data || [])[0] || null, ok: true });
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

    // ── GET detalle de placas CNC para un registro de trabajo ────────────
    if (action === 'detalle-cnc' && req.method === 'GET') {
      const registro_trabajo_id = url.searchParams.get('registro_trabajo_id');
      const { data, error } = await supabase
        .from('registros_cnc')
        .select('*')
        .eq('registro_trabajo_id', registro_trabajo_id)
        .order('placa_numero', { ascending: true });
      if (error) throw error;
      return ok({ placas: data || [] });
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

    // ── GET centros virtuales (catálogo de centros de oficina) ───────────
    if (action === 'centros-virtuales' && req.method === 'GET') {
      const { data, error } = await supabase
        .from('centros_virtuales')
        .select('id, nombre, es_descanso')
        .eq('activo', true)
        .order('nombre');
      if (error) throw error;
      return ok({ centros: data || [] });
    }

    // ── GET tiempo-activo (wrapper → _tiempoActivoImpl) ───────────────────
    if (action === 'tiempo-activo' && req.method === 'GET') {
      const empleado_id = url.searchParams.get('empleado_id');
      const result = await _tiempoActivoImpl(supabase, { empleado_id });
      return ok(result);
    }

    // ── POST iniciar-tiempo-oficina (wrapper → _iniciarTareaImpl) ─────────
    if (action === 'iniciar-tiempo-oficina' && req.method === 'POST') {
      const { empleado_id, proyecto_id, proyecto_nombre, centro_virtual,
              item_id, item_nombre } = body;
      if (!empleado_id || !centro_virtual) {
        return err('empleado_id y centro_virtual requeridos', 400);
      }
      // Verificar rol explícitamente (mantiene 403 igual que antes)
      const { data: emp, error: eErr } = await supabase
        .from('empleados').select('rol_app').eq('id', empleado_id).maybeSingle();
      if (eErr) throw eErr;
      if (!emp) return err('Empleado no encontrado', 404);
      if (emp.rol_app !== 'oficina' && emp.rol_app !== 'admin') {
        return new Response(JSON.stringify({ ok: false, error: 'Rol no autorizado para marcar tiempo de oficina' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
      // Delegar a helper unificado — requiere jornada activa explícita (sin _autoJornada)
      const result = await _iniciarTareaImpl(supabase, {
        empleado_id,
        proyecto_id,
        proyecto_nombre,
        centro: centro_virtual,
        item_id,
        item_nombre,
      });
      return ok({ ok: true, ...result });
    }

    // ── POST detener-tiempo-oficina (wrapper → _finalizarTareaImpl) ───────
    if (action === 'detener-tiempo-oficina' && req.method === 'POST') {
      const { registro_id, empleado_id } = body;
      if (!registro_id || !empleado_id) return err('registro_id y empleado_id requeridos', 400);
      const result = await _finalizarTareaImpl(supabase, {
        empleado_id,
        registro_id,
        estado_final: 'finalizado',
      });
      return ok({ ok: true, registro: result.registro, duracion_minutos: result.duracion_minutos });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ENDPOINTS V2 UNIFICADOS
    // ══════════════════════════════════════════════════════════════════════

    // ── POST entrada-v2 ───────────────────────────────────────────────────
    if (action === 'entrada-v2' && req.method === 'POST') {
      const { empleado_id } = body;
      if (!empleado_id) return err('empleado_id requerido', 400);
      const result = await _entradaImpl(supabase, { empleado_id });
      return ok({ ok: true, ...result });
    }

    // ── POST salida-v2 ────────────────────────────────────────────────────
    if (action === 'salida-v2' && req.method === 'POST') {
      const { empleado_id } = body;
      if (!empleado_id) return err('empleado_id requerido', 400);
      const result = await _salidaImpl(supabase, { empleado_id });
      return ok({ ok: true, ...result });
    }

    // ── GET jornadas-abiertas-anteriores ─────────────────────────────────
    if (action === 'jornadas-abiertas-anteriores' && req.method === 'GET') {
      const empleado_id = url.searchParams.get('empleado_id');
      if (!empleado_id) return err('empleado_id requerido', 400);
      const hoy = new Date().toISOString().split('T')[0];
      const { data: jornadasHuerfanas, error: jHErr } = await supabase
        .from('jornadas')
        .select('id, fecha, entrada')
        .eq('empleado_id', empleado_id)
        .is('salida', null)
        .lt('fecha', hoy)
        .order('fecha', { ascending: false });
      if (jHErr) throw jHErr;
      if (!jornadasHuerfanas || jornadasHuerfanas.length === 0) {
        return ok({ ok: true, jornadas: [] });
      }
      // Para cada jornada, obtener el último registro finalizado y el conteo
      const jornadasConMeta = await Promise.all(jornadasHuerfanas.map(async (j) => {
        const { data: regs } = await supabase
          .from('registros_trabajo')
          .select('id, fin, estado')
          .eq('jornada_id', j.id)
          .order('fin', { ascending: false });
        const total = regs?.length || 0;
        const ultimoFin = regs?.find(r => r.fin)?.fin || null;
        return { ...j, total_registros: total, ultimo_fin: ultimoFin };
      }));
      return ok({ ok: true, jornadas: jornadasConMeta });
    }

    // ── POST cerrar-jornada-huerfana ──────────────────────────────────────
    if (action === 'cerrar-jornada-huerfana' && req.method === 'POST') {
      const { empleado_id, jornada_id, modo, salida_manual } = body;
      if (!empleado_id || !jornada_id || !modo) {
        return err('empleado_id, jornada_id y modo requeridos', 400);
      }
      if (!['estimada', 'manual'].includes(modo)) {
        return err('modo debe ser estimada o manual', 400);
      }
      if (modo === 'manual' && !salida_manual) {
        return err('salida_manual requerido para modo manual', 400);
      }
      // Verificar jornada
      const { data: j, error: jErr } = await supabase
        .from('jornadas')
        .select('id, empleado_id, fecha, entrada, salida')
        .eq('id', jornada_id)
        .maybeSingle();
      if (jErr) throw jErr;
      if (!j) return err('Jornada no encontrada', 404);
      if (j.empleado_id !== empleado_id) {
        return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
      if (j.salida) return err('Jornada ya cerrada', 400);
      // Calcular salida según modo
      let salida;
      if (modo === 'estimada') {
        const { data: ultimo } = await supabase
          .from('registros_trabajo')
          .select('fin')
          .eq('jornada_id', jornada_id)
          .not('fin', 'is', null)
          .order('fin', { ascending: false })
          .limit(1)
          .maybeSingle();
        salida = ultimo?.fin || j.entrada;
      } else {
        // modo === 'manual'
        const salidaDate = new Date(salida_manual);
        if (isNaN(salidaDate.getTime())) {
          return err('salida_manual no es una fecha válida', 400);
        }
        const entradaDate = new Date(j.entrada);
        const ahoraConMargen = new Date(Date.now() + 60000);
        if (salidaDate < entradaDate) {
          return err('La hora de salida no puede ser antes de la entrada', 400);
        }
        if (salidaDate > ahoraConMargen) {
          return err('La hora de salida no puede ser en el futuro', 400);
        }
        salida = salidaDate.toISOString();
      }
      // Cerrar registros activos con la misma hora de salida (consistencia)
      await supabase.from('registros_trabajo')
        .update({ fin: salida, estado: 'pausado' })
        .eq('jornada_id', jornada_id)
        .eq('estado', 'activo');
      const { data, error: uErr } = await supabase.from('jornadas')
        .update({ salida }).eq('id', jornada_id).select().single();
      if (uErr) throw uErr;
      return ok({ ok: true, jornada: data });
    }

    // ── POST iniciar-tarea-v2 ─────────────────────────────────────────────
    if (action === 'iniciar-tarea-v2' && req.method === 'POST') {
      const { empleado_id, proyecto_id, proyecto_nombre, centro, item_id, item_nombre } = body;
      if (!empleado_id || !centro) return err('empleado_id y centro requeridos', 400);
      const result = await _iniciarTareaImpl(supabase, {
        empleado_id, proyecto_id, proyecto_nombre, centro, item_id, item_nombre,
        // _autoJornada: false — v2 requiere jornada activa explícita
      });
      return ok({ ok: true, ...result });
    }

    // ── POST finalizar-tarea-v2 ───────────────────────────────────────────
    if (action === 'finalizar-tarea-v2' && req.method === 'POST') {
      const { empleado_id, registro_id, estado_final = 'finalizado' } = body;
      if (!empleado_id) return err('empleado_id requerido', 400);
      const result = await _finalizarTareaImpl(supabase, {
        empleado_id,
        registro_id,
        estado_final,
      });
      return ok({ ok: true, ...result });
    }

    // ── GET tiempo-activo-v2 ──────────────────────────────────────────────
    if (action === 'tiempo-activo-v2' && req.method === 'GET') {
      const empleado_id = url.searchParams.get('empleado_id');
      if (!empleado_id) return err('empleado_id requerido', 400);
      const result = await _tiempoActivoImpl(supabase, { empleado_id });
      return ok({ ok: true, ...result });
    }

    // ══════════════════════════════════════════════════════════════════════
    // AUTENTICACIÓN Y USUARIOS
    // ══════════════════════════════════════════════════════════════════════

    // ── POST login admin (email + PIN) ───────────────────────────────────
    if (action === 'login-admin' && req.method === 'POST') {
      const { email, pin } = body;
      if (!email || !pin) return err('email y pin requeridos', 400);
      const { data, error } = await supabase
        .from('empleados')
        .select('id, nombre, email, categoria, rol_app')
        .eq('email', email)
        .eq('pin', pin)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return new Response(JSON.stringify({ ok: false, error: 'Credenciales incorrectas' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
      if (data.rol_app === 'operario') return new Response(JSON.stringify({ ok: false, error: 'Tu rol no permite acceso a admin', redirect: 'planta2' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      return ok({ ok: true, usuario: { id: data.id, nombre: data.nombre, email: data.email, rol_app: data.rol_app, categoria: data.categoria } });
    }

    // ── POST cambiar PIN propio ───────────────────────────────────────────
    if (action === 'cambiar-pin' && req.method === 'POST') {
      const { empleado_id, pin_actual, pin_nuevo } = body;
      if (!empleado_id || !pin_actual || !pin_nuevo) return err('empleado_id, pin_actual y pin_nuevo requeridos', 400);
      if (!/^\d{4}$/.test(pin_nuevo)) return new Response(JSON.stringify({ ok: false, error: 'PIN debe ser 4 dígitos' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
      const { data: emp, error: eErr } = await supabase
        .from('empleados').select('pin').eq('id', empleado_id).maybeSingle();
      if (eErr) throw eErr;
      if (!emp) return err('Empleado no encontrado', 404);
      if (emp.pin !== pin_actual) return new Response(JSON.stringify({ ok: false, error: 'PIN actual incorrecto' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
      const { error: uErr } = await supabase.from('empleados').update({ pin: pin_nuevo }).eq('id', empleado_id);
      if (uErr) throw uErr;
      return ok({ ok: true });
    }

    // ── POST verificar PIN (login planta — server-side, no devuelve pin) ──
    if (action === 'verificar-pin' && req.method === 'POST') {
      const { cedula, pin } = body;
      if (!cedula || !pin) return err('cedula y pin requeridos', 400);
      if (!/^\d{4}$/.test(pin)) {
        return new Response(JSON.stringify({ ok: false, error: 'PIN inválido' }), {
          status: 401, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }
      const { data, error } = await supabase
        .from('empleados')
        .select('id, nombre, cedula, email, rol_app, categoria, centros_autorizados, horario_entrada, horario_salida')
        .eq('cedula', cedula)
        .eq('pin', pin)
        .eq('activo', true)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return new Response(JSON.stringify({ ok: false, error: 'Cédula o PIN incorrectos' }), {
          status: 401, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }
      return ok({ ok: true, empleado: data });
    }

    // ── POST resetear PIN ajeno (admin/oficina con jerarquía) ────────────
    if (action === 'resetear-pin' && req.method === 'POST') {
      const { admin_id, empleado_id } = body;
      if (!admin_id || !empleado_id) return err('admin_id y empleado_id requeridos', 400);
      if (admin_id === empleado_id) {
        return new Response(JSON.stringify({ ok: false, error: 'Para cambiar tu propio PIN usá la sección Mi cuenta' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
      const [{ data: actor, error: aErr }, { data: target, error: tErr }] = await Promise.all([
        supabase.from('empleados').select('rol_app').eq('id', admin_id).maybeSingle(),
        supabase.from('empleados').select('rol_app').eq('id', empleado_id).maybeSingle(),
      ]);
      if (aErr) throw aErr;
      if (tErr) throw tErr;
      if (!actor) return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      if (!target) return err('Empleado no encontrado', 404);
      const canReset =
        actor.rol_app === 'admin' ||
        (actor.rol_app === 'oficina' && target.rol_app === 'operario');
      if (!canReset) {
        return new Response(JSON.stringify({ ok: false, error: 'No tenés permisos para resetear el PIN de este usuario' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
      const { error: uErr } = await supabase.from('empleados').update({ pin: '1234' }).eq('id', empleado_id);
      if (uErr) throw uErr;
      return ok({ ok: true, pin_reseteado: '1234' });
    }

    // ── POST guardar proyecto completo ────────────────────────────────────
    if (action === 'guardar-proyecto' && req.method === 'POST') {
      const { id, numero, obra, clienteNombre, fechaInicio, fechaEntrega,
              notas, estado, muebles, materiales, sosCargadas, modulos, creadoEn,
              activo: activoBody } = body;
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
          activo: activoBody !== undefined ? activoBody : true,
          sincronizado_at: new Date().toISOString(),
        }, { onConflict: 'id' })
        .select();
      if (error) throw error;
      return ok({ proyecto: (data || [])[0] || null, ok: true });
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

    // ── GET metricas-dia (estado completo del día para admin) ─────────────
    if (action === 'metricas-dia' && req.method === 'GET') {
      const empleado_id = url.searchParams.get('empleado_id');
      if (!empleado_id) return err('empleado_id requerido', 400);

      const hoy = new Date().toISOString().split('T')[0];
      const ahora = new Date();

      // 1. Jornada abierta de hoy
      const { data: jornada, error: jErr } = await supabase
        .from('jornadas').select('*')
        .eq('empleado_id', empleado_id).eq('fecha', hoy).is('salida', null)
        .maybeSingle();
      if (jErr) throw jErr;

      if (!jornada) {
        return ok({ ok: true, jornada: null, tarea_activa: null, registros_dia: [], totales: {
          duracion_jornada_minutos: 0,
          descanso_acumulado_minutos: 0,
          tiempo_clasificado_minutos: 0,
          tiempo_no_clasificado_minutos: 0,
        }});
      }

      // 2. Registros del día ordenados por inicio
      const { data: registros, error: rErr } = await supabase
        .from('registros_trabajo').select('*')
        .eq('empleado_id', empleado_id)
        .eq('jornada_id', jornada.id)
        .order('inicio', { ascending: true });
      if (rErr) throw rErr;

      const regs = registros || [];
      const tarea_activa = regs.find(r => r.estado === 'activo') || null;

      // 3. Determinar qué centros son descanso + modalidad del empleado
      const centroNames = [...new Set(regs.map(r => r.centro).filter(Boolean))];
      const descanso_centros = new Set();
      if (centroNames.length > 0) {
        const { data: cvs } = await supabase
          .from('centros_virtuales').select('nombre, es_descanso').in('nombre', centroNames);
        (cvs || []).forEach(cv => { if (cv.es_descanso) descanso_centros.add(cv.nombre); });
      }

      const { data: empDescanso } = await supabase
        .from('empleados').select('descanso_modalidad').eq('id', empleado_id).maybeSingle();
      const descanso_modalidad = empDescanso?.descanso_modalidad || null;

      // 4. Calcular totales
      const fin_ref = jornada.salida ? new Date(jornada.salida) : ahora;
      const duracion_jornada_minutos = Math.round((fin_ref - new Date(jornada.entrada)) / 60000);
      const descanso_acumulado_minutos = jornada.descanso_minutos || 0;
      const descanso_excedido_minutos  = jornada.descanso_excedido_minutos || 0;

      // Minutos de la sesión de descanso activa en curso (si la hay)
      let descanso_minutos_actual_sesion = 0;
      if (tarea_activa && descanso_centros.has(tarea_activa.centro)) {
        descanso_minutos_actual_sesion = Math.round((ahora - new Date(tarea_activa.inicio)) / 60000);
      }

      // Exceso visible (solo relevante para paga_30)
      const descanso_total = descanso_acumulado_minutos + descanso_minutos_actual_sesion;
      const descanso_excede_limite = descanso_modalidad === 'paga_30' && descanso_total > 30;
      const descanso_exceso_minutos = descanso_excede_limite ? Math.max(0, descanso_total - 30) : 0;

      // tiempo_no_clasificado: gaps entre registros (ordenados por inicio) — acumulado del día
      let tiempo_no_clasificado_minutos = 0;
      let gap_start = new Date(jornada.entrada);
      for (const reg of regs) {
        const reg_inicio = new Date(reg.inicio);
        if (reg_inicio > gap_start) {
          tiempo_no_clasificado_minutos += Math.round((reg_inicio - gap_start) / 60000);
        }
        const reg_fin = reg.fin ? new Date(reg.fin) : (reg.estado === 'activo' ? ahora : null);
        if (reg_fin && reg_fin > gap_start) gap_start = reg_fin;
      }
      // Trailing gap solo si no hay tarea activa
      if (!tarea_activa && gap_start < fin_ref) {
        tiempo_no_clasificado_minutos += Math.round((fin_ref - gap_start) / 60000);
      }

      // hueco_actual: solo el gap vigente desde el fin del último registro hasta ahora
      // Usado para decidir el bloqueo (≠ acumulado del día)
      let hueco_actual_minutos = 0;
      if (!tarea_activa && jornada) {
        // gap_start quedó apuntando al fin del último registro (o entrada si no hay)
        // Reutilizamos esa variable que ya tiene el valor correcto
        hueco_actual_minutos = Math.max(0, Math.round((ahora - gap_start) / 60000));
      }

      // tiempo_clasificado: suma de duraciones de registros no-descanso
      let tiempo_clasificado_minutos = 0;
      for (const reg of regs) {
        if (descanso_centros.has(reg.centro)) continue;
        const reg_inicio = new Date(reg.inicio);
        const reg_fin = reg.fin ? new Date(reg.fin) : (reg.estado === 'activo' ? ahora : null);
        if (reg_fin) {
          tiempo_clasificado_minutos += Math.max(0, Math.round((reg_fin - reg_inicio) / 60000));
        }
      }

      // tiempo_pago: trabajo + descanso pago según modalidad
      const tiempo_pago_minutos = descanso_modalidad === 'paga_30'
        ? tiempo_clasificado_minutos + descanso_acumulado_minutos
        : tiempo_clasificado_minutos;

      return ok({ ok: true, jornada, tarea_activa, registros_dia: regs, totales: {
        duracion_jornada_minutos,
        descanso_acumulado_minutos,
        descanso_excedido_minutos,
        descanso_minutos_actual_sesion,
        descanso_excede_limite,
        descanso_exceso_minutos,
        tiempo_clasificado_minutos,
        tiempo_pago_minutos,
        tiempo_no_clasificado_minutos,
        hueco_actual_minutos,
        descanso_modalidad,
      }});
    }

    // ── GET tipos-cambio ─────────────────────────────────────────────────
    if (action === 'tipos-cambio' && req.method === 'GET') {
      const { data, error } = await supabase
        .from('tipo_cambio')
        .select('id, moneda_origen, moneda_destino, valor, actualizado_en')
        .order('moneda_origen');
      if (error) throw error;
      return ok({ tipos: data });
    }

    // ── POST actualizar-tipo-cambio (solo admin) ──────────────────────────
    if (action === 'actualizar-tipo-cambio' && req.method === 'POST') {
      const { admin_id, moneda_origen, moneda_destino, valor } = body;
      if (!admin_id || !moneda_origen || !moneda_destino || valor === undefined)
        return err('admin_id, moneda_origen, moneda_destino y valor requeridos', 400);
      if (typeof valor !== 'number' || valor < 0)
        return err('valor debe ser número >= 0', 400);
      const { data: caller } = await supabase
        .from('empleados').select('rol_app').eq('id', admin_id).maybeSingle();
      if (!caller || caller.rol_app !== 'admin')
        return new Response(JSON.stringify({ ok: false, error: 'Solo admin puede modificar el tipo de cambio' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      const { data, error } = await supabase
        .from('tipo_cambio')
        .update({ valor, actualizado_en: new Date().toISOString() })
        .eq('moneda_origen', moneda_origen)
        .eq('moneda_destino', moneda_destino)
        .select().single();
      if (error) throw error;
      return ok({ ok: true, tipo_cambio: data });
    }

    // ── GET tarifas-horarias ──────────────────────────────────────────────
    if (action === 'tarifas-horarias' && req.method === 'GET') {
      const { data, error } = await supabase
        .from('tarifas_horarias')
        .select('categoria, monto_usd, actualizado_en')
        .order('categoria');
      if (error) throw error;
      return ok({ tarifas: data });
    }

    // ── POST actualizar-tarifa (solo admin) ───────────────────────────────
    if (action === 'actualizar-tarifa' && req.method === 'POST') {
      const { admin_id, categoria, monto_usd } = body;
      if (!admin_id || !categoria || monto_usd === undefined) {
        return err('admin_id, categoria y monto_usd requeridos', 400);
      }
      if (!['directo','indirecto','tecnico','administrativo'].includes(categoria)) {
        return err('categoría inválida', 400);
      }
      if (typeof monto_usd !== 'number' || monto_usd < 0) {
        return err('monto_usd debe ser número >= 0', 400);
      }
      const { data: caller } = await supabase
        .from('empleados').select('rol_app').eq('id', admin_id).maybeSingle();
      if (!caller || caller.rol_app !== 'admin') {
        return new Response(JSON.stringify({ ok: false, error: 'Solo admin puede modificar tarifas' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
      const { data, error } = await supabase
        .from('tarifas_horarias')
        .update({ monto_usd, actualizado_en: new Date().toISOString() })
        .eq('categoria', categoria)
        .select().single();
      if (error) throw error;
      return ok({ ok: true, tarifa: data });
    }

    // ── GET costos-proyecto (solo admin) ──────────────────────────────────
    if (action === 'costos-proyecto' && req.method === 'GET') {
      const proyecto_id = url.searchParams.get('proyecto_id');
      const admin_id    = url.searchParams.get('admin_id');
      if (!proyecto_id) return err('proyecto_id requerido', 400);
      if (!admin_id)    return err('admin_id requerido', 400);
      const { data: caller } = await supabase
        .from('empleados').select('rol_app').eq('id', admin_id).maybeSingle();
      if (!caller || caller.rol_app !== 'admin') {
        return new Response(JSON.stringify({ ok: false, error: 'Solo admin puede ver costos' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
      // Proyecto
      const { data: pr } = await supabase
        .from('proyectos_cache')
        .select('id, numero, nombre, obra, cliente_nombre, materiales')
        .eq('id', proyecto_id).maybeSingle();
      if (!pr) return err('Proyecto no encontrado', 404);
      // Registros de trabajo finalizados
      const { data: regs, error: rErr } = await supabase
        .from('registros_trabajo')
        .select('inicio, fin, empleado_id')
        .eq('proyecto_id', proyecto_id)
        .not('fin', 'is', null);
      if (rErr) throw rErr;
      // Categorías de empleados
      const empIds = [...new Set((regs || []).map(r => r.empleado_id))];
      let catMap = {};
      if (empIds.length) {
        const { data: emps } = await supabase
          .from('empleados').select('id, categoria').in('id', empIds);
        catMap = Object.fromEntries((emps || []).map(e => [e.id, e.categoria]));
      }
      // Tarifas
      const { data: tarifasArr } = await supabase
        .from('tarifas_horarias').select('categoria, monto_usd');
      const tarifaMap = Object.fromEntries((tarifasArr || []).map(t => [t.categoria, t.monto_usd]));
      // Calcular MO por categoría
      const horasCat = {};
      let registros_sin_categoria = 0;
      for (const r of (regs || [])) {
        const cat = catMap[r.empleado_id];
        if (!cat) { registros_sin_categoria++; continue; }
        const horas = (new Date(r.fin) - new Date(r.inicio)) / 3600000;
        horasCat[cat] = (horasCat[cat] || 0) + horas;
      }
      const CATS = ['directo','indirecto','tecnico','administrativo'];
      const por_categoria = CATS
        .filter(c => horasCat[c] !== undefined)
        .map(c => ({
          categoria: c,
          horas: Math.round(horasCat[c] * 100) / 100,
          tarifa_usd: tarifaMap[c] || 0,
          subtotal_usd: Math.round(horasCat[c] * (tarifaMap[c] || 0) * 100) / 100,
        }));
      const total_horas = por_categoria.reduce((a, x) => a + x.horas, 0);
      const mo_total_usd = por_categoria.reduce((a, x) => a + x.subtotal_usd, 0);
      // Calcular materiales
      const matsArr = pr.materiales || [];
      let mat_total_usd = 0;
      let materiales_sin_costo = 0;
      const matItems = matsArr.map((m, i) => {
        const cant = m.requerido || m.cantidad || 0;
        const cu = m.costo_unitario_usd != null ? Number(m.costo_unitario_usd) : null;
        if (cu == null) { materiales_sin_costo++; }
        const ct = cu != null ? Math.round(cant * cu * 100) / 100 : null;
        if (ct != null) mat_total_usd += ct;
        return { index: i, nombre: m.nombre, cantidad: cant, unidad: m.unidad, costo_unitario_usd: cu, costo_total_usd: ct };
      });
      const total_proyecto_usd = Math.round((mo_total_usd + mat_total_usd) * 100) / 100;
      return ok({
        ok: true,
        proyecto: { id: pr.id, codigo: pr.numero, nombre: pr.nombre || pr.obra, cliente_nombre: pr.cliente_nombre },
        mano_obra: { por_categoria, total_horas: Math.round(total_horas * 100) / 100, total_usd: Math.round(mo_total_usd * 100) / 100 },
        materiales: { items: matItems, total_usd: Math.round(mat_total_usd * 100) / 100 },
        total_proyecto_usd,
        sin_costear: { registros_sin_categoria, materiales_sin_costo },
      });
    }

    // ── POST editar-costo-material (solo admin) ───────────────────────────
    if (action === 'editar-costo-material' && req.method === 'POST') {
      const { admin_id, proyecto_id, material_index, costo_unitario_usd } = body;
      if (!admin_id || !proyecto_id || material_index === undefined || costo_unitario_usd === undefined) {
        return err('admin_id, proyecto_id, material_index y costo_unitario_usd requeridos', 400);
      }
      if (typeof costo_unitario_usd !== 'number' || costo_unitario_usd < 0) {
        return err('costo_unitario_usd debe ser número >= 0', 400);
      }
      const { data: caller } = await supabase
        .from('empleados').select('rol_app').eq('id', admin_id).maybeSingle();
      if (!caller || caller.rol_app !== 'admin') {
        return new Response(JSON.stringify({ ok: false, error: 'Solo admin puede editar costos' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
      const { data: pr, error: prErr } = await supabase
        .from('proyectos_cache').select('materiales').eq('id', proyecto_id).maybeSingle();
      if (prErr) throw prErr;
      if (!pr) return err('Proyecto no encontrado', 404);
      const mats = pr.materiales || [];
      const idx = Number(material_index);
      if (isNaN(idx) || idx < 0 || idx >= mats.length) {
        return err('material_index fuera de rango', 400);
      }
      const cant = mats[idx].requerido || mats[idx].cantidad || 0;
      mats[idx] = {
        ...mats[idx],
        costo_unitario_usd,
        costo_total_usd: Math.round(cant * costo_unitario_usd * 100) / 100,
      };
      const { error: uErr } = await supabase
        .from('proyectos_cache').update({ materiales: mats }).eq('id', proyecto_id);
      if (uErr) throw uErr;
      return ok({ ok: true, material: mats[idx] });
    }

    return err('Acción no reconocida: ' + action);

  } catch (e) {
    if (e instanceof ApiError) return err(e.message, e.status);
    return err(e.message, 500);
  }
}
