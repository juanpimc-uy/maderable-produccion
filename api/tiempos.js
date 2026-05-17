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

// ── Zoho token cache (module-level, persiste mientras la instancia Edge está caliente)
// Mismo patrón que api/zoho-token.js pero self-contained para no cruzar funciones.
let _zohoToken = null;
let _zohoTokenExpiry = 0;
async function getZohoToken() {
  if (_zohoToken && _zohoTokenExpiry > Date.now() + 60000) return _zohoToken;
  const params = new URLSearchParams();
  params.append('client_id',     process.env.ZOHO_CLIENT_ID);
  params.append('client_secret', process.env.ZOHO_CLIENT_SECRET);
  params.append('refresh_token', process.env.ZOHO_REFRESH_TOKEN);
  params.append('grant_type',    'refresh_token');
  const res  = await fetch('https://accounts.zoho.com/oauth/v2/token', { method: 'POST', body: params });
  const data = await res.json();
  if (!data.access_token) throw new Error('No se pudo obtener token de Zoho: ' + (data.error || JSON.stringify(data)));
  _zohoToken       = data.access_token;
  _zohoTokenExpiry = Date.now() + ((data.expires_in || 3600) * 1000);
  return _zohoToken;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── Password hashing (PBKDF2 via Web Crypto — edge compatible) ───────────
function _hexEncode(buf) { return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join(''); }
function _hexDecode(hex) { const a = new Uint8Array(hex.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.substr(i * 2, 2), 16); return a; }

async function scryptHash(password) {
  const salt = _hexEncode(crypto.getRandomValues(new Uint8Array(16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: _hexDecode(salt), iterations: 100000, hash: 'SHA-256' }, key, 512);
  return salt + ':' + _hexEncode(bits);
}

async function scryptVerify(password, stored) {
  const [salt, hash] = stored.split(':');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: _hexDecode(salt), iterations: 100000, hash: 'SHA-256' }, key, 512);
  return _hexEncode(bits) === hash;
}

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
  // Blindaje: cerrar cualquier tarea activa de días anteriores antes de abrir nueva jornada
  await _cerrarTareasActivasDe(sb, empleado_id, ahora);
  const { data, error } = await sb.from('jornadas')
    .upsert({ empleado_id, fecha: hoy, entrada: ahora, tarde, salida: null }, { onConflict: 'empleado_id,fecha' })
    .select().single();
  if (error) throw error;
  return { jornada: data };
}

async function _salidaImpl(sb, { empleado_id }) {
  const hoy = new Date().toISOString().split('T')[0];
  const ahora = new Date().toISOString();
  // Cerrar TODOS los registros activos como 'pausado'
  await _cerrarTareasActivasDe(sb, empleado_id, ahora);
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
      .select('es_descanso').eq('codigo', data.centro).maybeSingle();
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

  // 3. Validar centro en centros_virtuales (lookup por codigo canónico)
  const { data: cv } = await sb.from('centros_virtuales')
    .select('id, es_descanso, activo, requiere_mueble, requiere_proyecto')
    .eq('codigo', centro).maybeSingle();
  if (!cv || !cv.activo) throw new ApiError('Centro no válido o inactivo', 400);
  const es_descanso = cv.es_descanso || false;

  // 4. Validar autorización del operario (si centros_autorizados está configurado)
  if (emp.rol_app === 'operario') {
    const autorizados = emp.centros_autorizados || [];
    if (autorizados.length > 0 && !autorizados.includes(centro)) {
      throw new ApiError('Centro no autorizado para este empleado', 400);
    }
  }

  // 5. Validar proyecto / item según configuración del centro
  if (!es_descanso) {
    if (cv.requiere_proyecto && !proyecto_id) throw new ApiError('proyecto_id requerido para este centro', 400);
    if (cv.requiere_mueble && !item_id) throw new ApiError('item_id requerido para este centro', 400);
    if (item_id && proyecto_id) {
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
  // item_id se persiste siempre que venga informado y no sea descanso
  const persistirItem = !es_descanso && (item_id != null);
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
      ultima_actividad: ahora,
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

async function _cerrarTareasActivasDe(sb, empleado_id, fin_ts = null) {
  const ts = fin_ts || new Date().toISOString();
  const { data: activos } = await sb.from('registros_trabajo')
    .select('id').eq('empleado_id', empleado_id).eq('estado', 'activo');
  if (!activos || activos.length === 0) return { cerrados: 0 };
  const { error } = await sb.from('registros_trabajo')
    .update({ fin: ts, estado: 'pausado' })
    .eq('empleado_id', empleado_id).eq('estado', 'activo');
  if (error) throw error;
  return { cerrados: activos.length };
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
        .select('id,nombre,cedula,email,rol_app,categoria,centros_autorizados,horario_entrada,horario_salida,descanso_modalidad,acceso_tiempos,pit_stop_minutos')
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

      let existing = null;
      if (body.id) {
        const { data } = await supabase
          .from('empleados').select('id, rol_app').eq('id', body.id).maybeSingle();
        existing = data;
      }
      if (!existing) {
        const { data } = await supabase
          .from('empleados').select('id, rol_app').eq('nombre', nombre).maybeSingle();
        existing = data;
      }

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
        // Validar pit_stop_minutos si viene
        if (body.pit_stop_minutos !== undefined) {
          const psm = parseInt(body.pit_stop_minutos, 10);
          if (isNaN(psm) || psm < 0) return err('pit_stop_minutos debe ser entero >= 0', 400);
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
          ...(body.pit_stop_minutos !== undefined ? { pit_stop_minutos: parseInt(body.pit_stop_minutos, 10) } : {}),
          ...(body.acceso_tiempos   !== undefined ? { acceso_tiempos: body.acceso_tiempos }                   : {}),
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
            pit_stop_minutos: 0,
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

    // ── GET dashboard-snapshot (U1.B — vista completa para admin) ────────────
    if (action === 'dashboard-snapshot' && req.method === 'GET') {
      const ahora = new Date();
      const hoy = ahora.toISOString().split('T')[0];
      const UMBRAL_SIN_SENAL_MIN = 15;

      // 1. Pull paralelo: empleados activos + jornadas hoy + registros activos + catálogo centros
      const [empleadosRes, jornadasRes, activosRes, centrosRes] = await Promise.all([
        supabase.from('empleados')
          .select('id, nombre, activo, rol_app, horario_entrada')
          .eq('activo', true),
        supabase.from('jornadas')
          .select('id, empleado_id, entrada, salida')
          .eq('fecha', hoy),
        supabase.from('registros_trabajo')
          .select('id, empleado_id, jornada_id, proyecto_id, proyecto_nombre, item_id, item_nombre, centro, inicio, ultima_actividad')
          .eq('estado', 'activo'),
        supabase.from('centros_virtuales')
          .select('codigo, nombre, tipo, orden, mostrar_dashboard_siempre')
          .eq('activo', true)
          .order('orden', { ascending: true }),
      ]);

      if (empleadosRes.error) throw empleadosRes.error;
      if (jornadasRes.error) throw jornadasRes.error;
      if (activosRes.error) throw activosRes.error;
      if (centrosRes.error) throw centrosRes.error;

      const empleados    = empleadosRes.data || [];
      const jornadas     = jornadasRes.data  || [];
      const activos      = activosRes.data   || [];
      const centrosCat   = centrosRes.data   || [];

      // Mapa codigo → nombre para resolución de labels
      const centroLabelMap = Object.fromEntries(centrosCat.map(c => [c.codigo, c.nombre]));

      // 2. Pull proyectos para resolver cliente/obra y nombre real del mueble
      const proyectoIds = [...new Set(activos.map(r => r.proyecto_id).filter(Boolean))];
      let proyectosMap = {};
      if (proyectoIds.length > 0) {
        const { data: proys, error: pErr } = await supabase
          .from('proyectos_cache')
          .select('id, cliente, cliente_nombre, obra, nombre, muebles')
          .in('id', proyectoIds);
        if (pErr) throw pErr;
        for (const p of (proys || [])) proyectosMap[p.id] = p;
      }

      // 3. Construir índices auxiliares
      const jornadaPorEmp = {};
      for (const j of jornadas) {
        if (!j.salida) jornadaPorEmp[j.empleado_id] = j;
      }
      const activoPorEmp = {};
      for (const r of activos) activoPorEmp[r.empleado_id] = r;

      // 3b. Lookup última sesión para ausentes
      const ausentesIds = empleados.filter(e => !jornadaPorEmp[e.id]).map(e => e.id);
      let ultimosPorAusente = {};
      if (ausentesIds.length > 0) {
        const { data: ultRegs } = await supabase
          .from('registros_trabajo')
          .select('empleado_id, centro, proyecto_id, proyecto_nombre, item_id, item_nombre, inicio')
          .in('empleado_id', ausentesIds)
          .order('inicio', { ascending: false });
        (ultRegs || []).forEach(r => {
          if (!ultimosPorAusente[r.empleado_id]) ultimosPorAusente[r.empleado_id] = r;
        });
      }

      // 4. Construir lista de operarios
      const operariosOut = empleados.map(emp => {
        const jornada = jornadaPorEmp[emp.id] || null;
        const activo  = activoPorEmp[emp.id]  || null;
        let estado;
        let tiempo_minutos    = 0;
        let sin_senal_minutos = 0;
        if (!jornada) {
          estado = 'ausente';
        } else if (!activo) {
          estado = 'sin_tarea';
        } else {
          const inicioMs = new Date(activo.inicio).getTime();
          tiempo_minutos = Math.floor((ahora.getTime() - inicioMs) / 60000);
          const ultMs   = new Date(activo.ultima_actividad).getTime();
          const diffMin = Math.floor((ahora.getTime() - ultMs) / 60000);
          estado = 'en_tarea';
          if (diffMin > UMBRAL_SIN_SENAL_MIN) sin_senal_minutos = diffMin;
        }

        let proyectoOut = null;
        let muebleOut   = null;
        if (activo && activo.proyecto_id) {
          const p = proyectosMap[activo.proyecto_id];
          proyectoOut = {
            id:      activo.proyecto_id,
            odf:     p?.nombre          || activo.proyecto_nombre || '',
            cliente: p?.cliente_nombre  || p?.cliente             || '',
            obra:    p?.obra            || '',
          };
          if (activo.item_id) {
            const muebles = Array.isArray(p?.muebles) ? p.muebles : [];
            const m = muebles.find(x => String(x.id) === String(activo.item_id));
            muebleOut = {
              id:     activo.item_id,
              codigo: m?.codigo || '',
              nombre: m?.nombre || activo.item_nombre || '',
            };
          }
        }

        const ultReg = estado === 'ausente' ? ultimosPorAusente[emp.id] : null;

        return {
          id:                emp.id,
          nombre:            emp.nombre,
          rol_app:           emp.rol_app,
          entrada:           jornada?.entrada || null,
          estado,
          centro:            activo?.centro  || null,
          centro_label:      activo?.centro ? (centroLabelMap[activo.centro] || activo.centro.toUpperCase()) : null,
          proyecto:          proyectoOut,
          mueble:            muebleOut,
          tiempo_minutos,
          sin_senal_minutos,
          registro_id:       activo?.id      || null,
          ultimo_centro:       ultReg?.centro || null,
          ultimo_centro_label: ultReg?.centro ? (centroLabelMap[ultReg.centro] || ultReg.centro.toUpperCase()) : null,
          ultimo_proyecto:     ultReg ? { nombre: ultReg.proyecto_nombre } : null,
          ultimo_mueble:       ultReg ? { nombre: ultReg.item_nombre } : null,
        };
      });

      // 5. Ordenar: en_tarea → sin_tarea → ausente; alfabético dentro
      const ordenEstado = { en_tarea: 0, sin_tarea: 1, ausente: 2 };
      operariosOut.sort((a, b) => {
        const oa = ordenEstado[a.estado] ?? 9;
        const ob = ordenEstado[b.estado] ?? 9;
        if (oa !== ob) return oa - ob;
        return (a.nombre || '').localeCompare(b.nombre || '', 'es');
      });

      // 6. Counters
      const counters = {
        total:          operariosOut.length,
        en_tarea:       operariosOut.filter(o => o.estado === 'en_tarea').length,
        sin_senal:      operariosOut.filter(o => o.sin_senal_minutos > 0).length,
        sin_tarea:      operariosOut.filter(o => o.estado === 'sin_tarea').length,
        ausentes:       operariosOut.filter(o => o.estado === 'ausente').length,
      };

      // 7. Agrupar por centro — todos los centros tipo 'planta' del catálogo, ordenados por orden
      const porCentro = {};
      for (const op of operariosOut) {
        if (op.estado !== 'en_tarea') continue;
        if (!op.centro) continue;
        if (!porCentro[op.centro]) porCentro[op.centro] = { centro: op.centro, label: centroLabelMap[op.centro] || op.centro.toUpperCase(), total: 0, sin_senal: 0, muebles: [] };
        porCentro[op.centro].total++;
        if (op.sin_senal_minutos > 0) porCentro[op.centro].sin_senal++;
        porCentro[op.centro].muebles.push({
          odf:           op.proyecto?.odf  || '',
          mueble_codigo: op.mueble?.codigo || '',
          mueble_nombre: op.mueble?.nombre || '',
          sin_senal:     op.sin_senal_minutos > 0,
        });
      }
      const centrosOut = centrosCat
        .filter(c => c.tipo === 'planta')
        .filter(c => c.mostrar_dashboard_siempre === true || porCentro[c.codigo])
        .map(c => porCentro[c.codigo] || { centro: c.codigo, label: c.nombre, total: 0, sin_senal: 0, muebles: [] });

      return ok({
        timestamp: ahora.toISOString(),
        counters,
        operarios: operariosOut,
        centros:   centrosOut,
      });
    }

    // ── GET planta-snapshot (Sprint 3 — vista tablet por centro) ─────────
    if (action === 'planta-snapshot' && req.method === 'GET') {
      const empleado_id = url.searchParams.get('empleado_id');
      if (!empleado_id) return err('empleado_id requerido', 400);

      const ahora = new Date();
      const hoy   = ahora.toISOString().split('T')[0];

      // 1. Pull paralelo: jornada hoy + registro activo del empleado + proyectos activos
      //    + registros activos globales + nombres de empleados
      const [jornadaRes, activosGlobalRes, proyectosRes, empleadosRes] = await Promise.all([
        supabase.from('jornadas')
          .select('id, entrada, salida')
          .eq('empleado_id', empleado_id).eq('fecha', hoy).maybeSingle(),
        supabase.from('registros_trabajo')
          .select('id, empleado_id, proyecto_id, item_id, centro, inicio, ultima_actividad, es_retrabajo')
          .eq('estado', 'activo'),
        supabase.from('proyectos_cache')
          .select('id, numero, nombre, obra, cliente, cliente_nombre, muebles')
          .eq('activo', true).order('nombre'),
        supabase.from('empleados')
          .select('id, nombre').eq('activo', true),
      ]);

      const jornada        = jornadaRes.data       || null;
      const activosGlobal  = activosGlobalRes.data || [];
      const proyectos      = proyectosRes.data     || [];
      const empleadosList  = empleadosRes.data     || [];

      // Registro activo del empleado actual
      const registroActivo = activosGlobal.find(r => r.empleado_id === empleado_id) || null;

      // 2. Últimos 3 proyectos distintos en que trabajó el empleado
      const { data: ultRegs } = await supabase.from('registros_trabajo')
        .select('proyecto_id, inicio')
        .eq('empleado_id', empleado_id)
        .not('proyecto_id', 'is', null)
        .order('inicio', { ascending: false })
        .limit(60);

      const seenProyectos  = new Set();
      const ultimos3ProyIds = [];
      for (const r of (ultRegs || [])) {
        if (r.proyecto_id && !seenProyectos.has(r.proyecto_id)) {
          seenProyectos.add(r.proyecto_id);
          ultimos3ProyIds.push(r.proyecto_id);
          if (ultimos3ProyIds.length >= 3) break;
        }
      }

      // 3. Historial: último registro NO-activo por item_id (para saber si fue iniciado / retrabajo)
      const allItemIds = [];
      for (const p of proyectos) {
        for (const m of (p.muebles || [])) {
          if (m.id != null) allItemIds.push(String(m.id));
        }
      }
      const historialPorItem = {}; // item_id → registro más reciente no-activo
      if (allItemIds.length > 0) {
        const { data: histRegs } = await supabase.from('registros_trabajo')
          .select('id, empleado_id, item_id, centro, inicio, estado, es_retrabajo')
          .in('item_id', allItemIds)
          .not('estado', 'eq', 'activo')
          .order('inicio', { ascending: false })
          .limit(1000);
        for (const r of (histRegs || [])) {
          if (!historialPorItem[r.item_id]) historialPorItem[r.item_id] = r;
        }
      }

      // 4. Índices auxiliares
      const empleadoNombreById = Object.fromEntries(empleadosList.map(e => [e.id, e.nombre]));
      const proyectoById       = Object.fromEntries(proyectos.map(p => [p.id, p]));

      // Registros activos de OTROS operarios, indexados por proyecto_id::item_id
      const activoPorItemOtro = {};
      for (const r of activosGlobal) {
        if (r.item_id && r.empleado_id !== empleado_id) {
          activoPorItemOtro[`${r.proyecto_id}::${r.item_id}`] = r;
        }
      }

      // 5. Construir ultimos_3_proyectos
      const ultimos3Proyectos = ultimos3ProyIds.map(pid => {
        const p = proyectoById[pid];
        if (!p) return { id: pid, numero: pid, obra: '', cliente: '' };
        return {
          id:      p.id,
          numero:  p.numero || p.nombre || '',
          obra:    p.obra   || p.nombre || '',
          cliente: p.cliente_nombre || p.cliente || '',
        };
      });

      // 6. Construir odfs_activas con estado_display por mueble
      const odfsActivas = proyectos.map(p => {
        const muebles = (p.muebles || []).map(m => {
          const itemId = String(m.id ?? '');

          const activoOtro = activoPorItemOtro[`${p.id}::${itemId}`] || null;
          // "último" de toda la historia: si hay un activo de OTRO, ese es el más reciente;
          // si hay un activo propio, ese es el más reciente; si no, el historial.
          const propioActivo   = (registroActivo?.item_id === itemId) ? registroActivo : null;
          const ultimaHistoria = historialPorItem[itemId] || null;

          let estado_display;
          let operario_actual = null;

          if (activoOtro) {
            estado_display  = 'en_uso';
            operario_actual = empleadoNombreById[activoOtro.empleado_id] || activoOtro.empleado_id;
          } else if (propioActivo) {
            // Este operario lo tiene activo ahora mismo — 'en_uso' con nombre propio
            estado_display  = 'en_uso';
            operario_actual = empleadoNombreById[empleado_id] || empleado_id;
          } else if (!ultimaHistoria) {
            estado_display = 'sin_iniciar';
          } else {
            estado_display = 'normal';
          }

          // es_ultimo_del_operario: el último reg histórico (no-activo) de este item fue de este empleado
          const es_ultimo_del_operario = ultimaHistoria?.empleado_id === empleado_id;

          return {
            id:                   itemId,
            codigo:               m.codigo || '',
            nombre:               m.nombre || '',
            ultimo_centro:        ultimaHistoria?.centro || null,
            estado_display,
            operario_actual,
            es_ultimo_del_operario,
          };
        });

        return {
          id:      p.id,
          numero:  p.numero || p.nombre || '',
          obra:    p.obra   || p.nombre || '',
          cliente: p.cliente_nombre || p.cliente || '',
          muebles,
        };
      });

      // 7. Info del operario
      const operarioOut = {
        id:              empleado_id,
        nombre:          empleadoNombreById[empleado_id] || empleado_id,
        jornada_activa:  !!jornada && !jornada.salida,
        entrada:         jornada?.entrada || null,
        registro_activo: registroActivo ? {
          id:          registroActivo.id,
          proyecto_id: registroActivo.proyecto_id,
          item_id:     registroActivo.item_id,
          centro:      registroActivo.centro,
          inicio:      registroActivo.inicio,
        } : null,
      };

      return ok({
        timestamp:            ahora.toISOString(),
        operario:             operarioOut,
        ultimos_3_proyectos:  ultimos3Proyectos,
        odfs_activas:         odfsActivas,
      });
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

    // ── PATCH/POST editar jornada ─────────────────────────────────────────
    if (action === 'editar-jornada' && (req.method === 'PATCH' || req.method === 'POST')) {
      const { jornada_id, entrada, salida, descanso_minutos, tomo_descanso, editor_id } = body;

      if (!editor_id)  return err('editor_id requerido', 400);
      if (!jornada_id) return err('jornada_id requerido', 400);

      // Permisos
      const { data: editor, error: edErr } = await supabase
        .from('empleados').select('rol_app, nombre').eq('id', editor_id).maybeSingle();
      if (edErr) throw edErr;
      if (!editor)
        return new Response(JSON.stringify({ ok: false, error: 'Editor no encontrado' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      if (editor.rol_app !== 'admin' && editor.rol_app !== 'oficina')
        return new Response(JSON.stringify({ ok: false, error: 'Solo admin u oficina pueden editar jornadas' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });

      // Cargar jornada
      const { data: jornada, error: jErr } = await supabase
        .from('jornadas').select('id, empleado_id, fecha, entrada, salida')
        .eq('id', jornada_id).maybeSingle();
      if (jErr) throw jErr;
      if (!jornada) return err('Jornada no encontrada', 404);

      // Solo roles sin permisos de edición están limitados a sus propias jornadas
      if (editor.rol_app !== 'admin' && editor.rol_app !== 'oficina' && jornada.empleado_id !== editor_id)
        return new Response(JSON.stringify({ ok: false, error: 'Solo puede editar sus propias jornadas' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });

      // Validar entrada
      if (entrada !== undefined && entrada !== null) {
        if (new Date(entrada).toString() === 'Invalid Date')
          return err('entrada no es una fecha válida', 400);
      }
      // Validar salida
      if (salida !== undefined && salida !== null) {
        if (new Date(salida).toString() === 'Invalid Date')
          return err('salida no es una fecha válida', 400);
      }
      // Validar entrada < salida si ambas definidas
      const entradaEfectiva = entrada !== undefined ? entrada : jornada.entrada;
      const salidaEfectiva  = salida  !== undefined ? salida  : jornada.salida;
      if (entradaEfectiva && salidaEfectiva && new Date(entradaEfectiva) >= new Date(salidaEfectiva))
        return err('La entrada debe ser anterior a la salida', 400);
      // Validar descanso_minutos
      if (descanso_minutos !== undefined && descanso_minutos !== null) {
        if (!Number.isInteger(descanso_minutos) || descanso_minutos < 0)
          return err('descanso_minutos debe ser entero >= 0', 400);
      }
      // Consistencia: si entrada cambia, no puede haber registros con inicio anterior
      if (entrada !== undefined && entrada !== null && entrada !== jornada.entrada) {
        const { data: conflictos } = await supabase
          .from('registros_trabajo')
          .select('id, inicio')
          .eq('jornada_id', jornada_id)
          .eq('eliminada', false)
          .lt('inicio', entrada);
        if (conflictos && conflictos.length > 0) {
          return new Response(JSON.stringify({
            ok: false,
            error: 'No se puede mover entrada de jornada porque hay registros con inicio anterior. Editá o eliminá esos registros primero.',
            conflictos: conflictos.map(r => r.id),
          }), { status: 409, headers: { ...CORS, 'Content-Type': 'application/json' } });
        }
      }

      const camposJ = {};
      if (entrada          !== undefined) camposJ.entrada          = entrada;
      if (salida           !== undefined) camposJ.salida           = salida;
      if (descanso_minutos !== undefined) camposJ.descanso_minutos = descanso_minutos;
      if (tomo_descanso    !== undefined) camposJ.tomo_descanso    = tomo_descanso;
      camposJ.descanso_editado = true;
      camposJ.editado_por      = editor_id;

      const { data: jornadaUpd, error: uJErr } = await supabase
        .from('jornadas').update(camposJ).eq('id', jornada_id).select().single();
      if (uJErr) throw uJErr;
      // Si se está cerrando una jornada que estaba abierta, cerrar tareas activas
      if (salida !== undefined && salida !== null && !jornada.salida) {
        await _cerrarTareasActivasDe(supabase, jornada.empleado_id, salida);
      }
      return ok({ ok: true, jornada: jornadaUpd });
    }

    // ── GET jornadas-rango ────────────────────────────────────────────────
    if (action === 'jornadas-rango' && req.method === 'GET') {
      const desde     = url.searchParams.get('desde');
      const hasta     = url.searchParams.get('hasta');
      const emp_param = url.searchParams.get('empleado_id');
      const caller_id = url.searchParams.get('caller_id');

      if (!desde || !hasta) return err('desde y hasta requeridos (YYYY-MM-DD)', 400);
      if (!caller_id)       return err('caller_id requerido', 400);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta))
        return err('desde y hasta deben tener formato YYYY-MM-DD', 400);
      if (desde > hasta) return err('desde debe ser anterior o igual a hasta', 400);
      if ((new Date(hasta) - new Date(desde)) / 86400000 > 31)
        return err('Rango máximo permitido: 31 días', 400);

      const { data: callerR, error: cRErr } = await supabase
        .from('empleados').select('rol_app').eq('id', caller_id).maybeSingle();
      if (cRErr) throw cRErr;
      if (!callerR)
        return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      if (callerR.rol_app !== 'admin' && callerR.rol_app !== 'oficina')
        return new Response(JSON.stringify({ ok: false, error: 'Solo admin u oficina pueden consultar jornadas' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });

      let empleado_id_filtro = emp_param || null;
      if (callerR.rol_app === 'oficina') {
        if (emp_param && emp_param !== caller_id)
          return new Response(JSON.stringify({ ok: false, error: 'Solo puede consultar sus propias jornadas' }),
            { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
        empleado_id_filtro = caller_id;
      }

      let jornadasQ = supabase
        .from('jornadas')
        .select('id, empleado_id, fecha, entrada, salida, descanso_minutos, descanso_excedido_minutos, descanso_editado, editado_por, notas, alerta_15h, tarde, ausente')
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('fecha', { ascending: true })
        .order('empleado_id', { ascending: true });
      if (empleado_id_filtro) jornadasQ = jornadasQ.eq('empleado_id', empleado_id_filtro);
      const { data: jornadasData, error: jRErr } = await jornadasQ;
      if (jRErr) throw jRErr;

      if (!jornadasData || jornadasData.length === 0)
        return ok({ ok: true, rango: { desde, hasta }, empleados: [], jornadas: [] });

      const jornadaIds  = jornadasData.map(j => j.id);
      const empleadoIds = [...new Set(jornadasData.map(j => j.empleado_id))];

      const [{ data: registrosR, error: rRErr }, { data: empleadosData, error: eRErr }] = await Promise.all([
        supabase.from('registros_trabajo')
          .select('id, jornada_id, inicio, fin, estado, centro, proyecto_id, proyecto_nombre, item_id, item_nombre, es_retrabajo, motivo_retrabajo')
          .in('jornada_id', jornadaIds)
          .eq('eliminada', false)
          .order('inicio', { ascending: true }),
        supabase.from('empleados')
          .select('id, nombre, categoria, descanso_modalidad')
          .in('id', empleadoIds),
      ]);
      if (rRErr) throw rRErr;
      if (eRErr) throw eRErr;

      const regsMapR = {};
      (registrosR || []).forEach(r => {
        if (!regsMapR[r.jornada_id]) regsMapR[r.jornada_id] = [];
        regsMapR[r.jornada_id].push(r);
      });

      return ok({
        ok: true,
        rango: { desde, hasta },
        empleados: empleadosData || [],
        jornadas: jornadasData.map(j => ({
          id: j.id, empleado_id: j.empleado_id, fecha: j.fecha,
          entrada: j.entrada, salida: j.salida,
          descanso_minutos: j.descanso_minutos,
          descanso_excedido_minutos: j.descanso_excedido_minutos,
          descanso_editado: j.descanso_editado, editado_por: j.editado_por,
          notas: j.notas, alerta_15h: j.alerta_15h, tarde: j.tarde, ausente: j.ausente,
          sesiones: regsMapR[j.id] || [],
        })),
      });
    }

    // ── POST editar-sesion ────────────────────────────────────────────────
    if (action === 'editar-sesion' && req.method === 'POST') {
      const { sesion_id, registro_id, inicio, fin, centro, proyecto_id, proyecto_nombre,
              item_id, item_nombre, estado, caller_id } = body;
      const reg_id = sesion_id || registro_id;

      if (!reg_id)    return err('sesion_id requerido', 400);
      if (!caller_id) return err('caller_id requerido', 400);

      const { data: regS, error: regSErr } = await supabase
        .from('registros_trabajo')
        .select('id, empleado_id, jornada_id, inicio, fin, proyecto_id, eliminada')
        .eq('id', reg_id).maybeSingle();
      if (regSErr) throw regSErr;
      if (!regS || regS.eliminada) return err('Registro no encontrado o ya eliminado', 404);

      const { data: callerS, error: cSErr } = await supabase
        .from('empleados').select('rol_app, acceso_tiempos').eq('id', caller_id).maybeSingle();
      if (cSErr) throw cSErr;
      if (!callerS)
        return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      if (callerS.rol_app !== 'admin' && callerS.rol_app !== 'oficina')
        return new Response(JSON.stringify({ ok: false, error: 'Sin acceso' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      if (callerS.rol_app !== 'admin' && callerS.rol_app !== 'oficina' && !callerS.acceso_tiempos && regS.empleado_id !== caller_id)
        return new Response(JSON.stringify({ ok: false, error: 'Sin acceso a tiempos de otros empleados' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });

      if (inicio !== undefined && inicio !== null && new Date(inicio).toString() === 'Invalid Date')
        return err('inicio no es una fecha válida', 400);
      if (fin !== undefined && fin !== null && new Date(fin).toString() === 'Invalid Date')
        return err('fin no es una fecha válida', 400);

      const inicioEfectivo = inicio !== undefined ? inicio : regS.inicio;
      const finEfectivo    = fin    !== undefined ? fin    : regS.fin;
      if (inicioEfectivo && finEfectivo && new Date(inicioEfectivo) >= new Date(finEfectivo))
        return err('inicio debe ser anterior a fin', 400);

      // estado='finalizado' requiere fin
      if (estado === 'finalizado' && !finEfectivo)
        return err('Para marcar como finalizado se requiere un fin', 400);

      // Validación de centro si viene en el body
      if (centro !== undefined) {
        const { data: cvES, error: cvESErr } = await supabase
          .from('centros_virtuales').select('activo, requiere_proyecto').eq('codigo', centro).maybeSingle();
        if (cvESErr) throw cvESErr;
        if (!cvES || !cvES.activo) return err('Centro no válido o inactivo', 400);
        if (cvES.requiere_proyecto) {
          const proyEfectivo = proyecto_id !== undefined ? proyecto_id : regS.proyecto_id;
          if (!proyEfectivo) return err('El centro seleccionado requiere un proyecto', 400);
        }
      }

      // Solapamiento (fin null en DB = sesión activa, equivale a infinito)
      const inicioISO   = inicioEfectivo ? new Date(inicioEfectivo).toISOString() : null;
      const finChequeoS = finEfectivo
        ? new Date(finEfectivo).toISOString()
        : '9999-12-31T23:59:59Z';
      if (inicioISO) {
        const { data: solapadosS } = await supabase
          .from('registros_trabajo')
          .select('id, inicio, fin')
          .eq('empleado_id', regS.empleado_id)
          .eq('eliminada', false)
          .neq('id', reg_id)
          .lt('inicio', finChequeoS)
          .or(`fin.is.null,fin.gt.${inicioISO}`);
        if (solapadosS && solapadosS.length > 0) {
          const s = solapadosS[0];
          return new Response(JSON.stringify({
            ok: false, error: `Solapamiento con sesión ${s.id} (${s.inicio} - ${s.fin})`,
          }), { status: 409, headers: { ...CORS, 'Content-Type': 'application/json' } });
        }
      }

      const camposS = {};
      if (inicio          !== undefined) camposS.inicio          = inicio;
      if (fin             !== undefined) camposS.fin             = fin;
      if (centro          !== undefined) camposS.centro          = centro;
      if (proyecto_id     !== undefined) camposS.proyecto_id     = proyecto_id;
      if (proyecto_nombre !== undefined) camposS.proyecto_nombre = proyecto_nombre;
      if (item_id         !== undefined) camposS.item_id         = item_id;
      if (item_nombre     !== undefined) camposS.item_nombre     = item_nombre;
      if (estado          !== undefined) camposS.estado          = estado;

      const { data: regSUpd, error: uSErr } = await supabase
        .from('registros_trabajo').update(camposS).eq('id', reg_id).select().single();
      if (uSErr) throw uSErr;
      return ok({ ok: true, sesion: regSUpd });
    }

    // ── POST agregar-sesion ───────────────────────────────────────────────
    if (action === 'agregar-sesion' && req.method === 'POST') {
      const { jornada_id, inicio, fin, centro, estado,
              proyecto_id, proyecto_nombre, item_id, item_nombre, caller_id } = body;

      if (!jornada_id) return err('jornada_id requerido', 400);
      if (!inicio)     return err('inicio requerido', 400);
      if (!centro)     return err('centro requerido', 400);
      if (!caller_id)  return err('caller_id requerido', 400);
      if (new Date(inicio).toString() === 'Invalid Date') return err('inicio no es una fecha válida', 400);
      if (fin != null) {
        if (new Date(fin).toString() === 'Invalid Date') return err('fin no es una fecha válida', 400);
        if (new Date(inicio) >= new Date(fin)) return err('inicio debe ser anterior a fin', 400);
      }

      const { data: callerAg, error: cAgErr } = await supabase
        .from('empleados').select('rol_app').eq('id', caller_id).maybeSingle();
      if (cAgErr) throw cAgErr;
      if (!callerAg)
        return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      if (callerAg.rol_app !== 'admin')
        return new Response(JSON.stringify({ ok: false, error: 'Solo admin puede agregar sesiones' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });

      const { data: jornAg, error: jAgErr } = await supabase
        .from('jornadas').select('id, empleado_id').eq('id', jornada_id).maybeSingle();
      if (jAgErr) throw jAgErr;
      if (!jornAg) return err('Jornada no encontrada', 404);

      const { data: cvAg, error: cvAgErr } = await supabase
        .from('centros_virtuales').select('activo, requiere_proyecto').eq('codigo', centro).maybeSingle();
      if (cvAgErr) throw cvAgErr;
      if (!cvAg || !cvAg.activo) return err('Centro no válido o inactivo', 400);
      if (cvAg.requiere_proyecto && !proyecto_id)
        return err('El centro seleccionado requiere un proyecto', 400);

      const inicioISO  = new Date(inicio).toISOString();
      const finChequeo = fin ? new Date(fin).toISOString() : '9999-12-31T23:59:59Z';
      const { data: solapadosAg } = await supabase
        .from('registros_trabajo')
        .select('id, inicio, fin')
        .eq('empleado_id', jornAg.empleado_id)
        .eq('eliminada', false)
        .lt('inicio', finChequeo)
        .or(`fin.is.null,fin.gt.${inicioISO}`);
      if (solapadosAg && solapadosAg.length > 0) {
        const s = solapadosAg[0];
        return new Response(JSON.stringify({
          ok: false, error: `Solapamiento con sesión ${s.id} (${s.inicio} - ${s.fin})`,
        }), { status: 409, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }

      const { data: regNew, error: insAgErr } = await supabase
        .from('registros_trabajo')
        .insert({
          jornada_id,
          empleado_id:     jornAg.empleado_id,
          inicio,
          fin:             fin || null,
          centro,
          estado:          estado || 'finalizado',
          proyecto_id:     proyecto_id     || null,
          proyecto_nombre: proyecto_nombre || null,
          item_id:         item_id         || null,
          item_nombre:     item_nombre     || null,
          eliminada: false,
        })
        .select().single();
      if (insAgErr) throw insAgErr;
      return ok({ ok: true, sesion: regNew });
    }

    // ── POST eliminar-sesion (soft delete) ────────────────────────────────
    if (action === 'eliminar-sesion' && req.method === 'POST') {
      const { registro_id, caller_id } = body;

      if (!registro_id) return err('registro_id requerido', 400);
      if (!caller_id)   return err('caller_id requerido', 400);

      const { data: regDel, error: regDelErr } = await supabase
        .from('registros_trabajo')
        .select('id, empleado_id, estado, eliminada')
        .eq('id', registro_id).maybeSingle();
      if (regDelErr) throw regDelErr;
      if (!regDel || regDel.eliminada) return err('Registro no encontrado o ya eliminado', 404);

      if (regDel.estado === 'activo')
        return err('No se puede eliminar una sesión activa. Finalizala primero.', 400);

      const { data: callerDel, error: cDelErr } = await supabase
        .from('empleados').select('rol_app, acceso_tiempos').eq('id', caller_id).maybeSingle();
      if (cDelErr) throw cDelErr;
      if (!callerDel)
        return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      if (callerDel.rol_app !== 'admin' && callerDel.rol_app !== 'oficina')
        return new Response(JSON.stringify({ ok: false, error: 'Sin acceso' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      if (callerDel.rol_app !== 'admin' && callerDel.rol_app !== 'oficina' && !callerDel.acceso_tiempos && regDel.empleado_id !== caller_id)
        return new Response(JSON.stringify({ ok: false, error: 'Sin acceso a tiempos de otros empleados' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });

      const { error: uDelErr } = await supabase
        .from('registros_trabajo')
        .update({ eliminada: true })
        .eq('id', registro_id);
      if (uDelErr) throw uDelErr;
      return ok({ ok: true });
    }

    // ── PATCH actualizar empleado existente ───────────────────────────────
    if (action === 'actualizar-empleado' && req.method === 'PATCH') {
      const { id, nombre, categoria, centros_autorizados, cedula, descanso_modalidad, pit_stop_minutos, acceso_tiempos } = body;
      if (!id) return err('id requerido');
      if (descanso_modalidad !== undefined && descanso_modalidad !== null) {
        if (!['paga_30', 'no_paga_60', 'sin_limite'].includes(descanso_modalidad))
          return err('descanso_modalidad debe ser paga_30, no_paga_60 o sin_limite', 400);
      }
      if (pit_stop_minutos !== undefined) {
        const psm = parseInt(pit_stop_minutos, 10);
        if (isNaN(psm) || psm < 0) return err('pit_stop_minutos debe ser entero >= 0', 400);
      }
      const campos = {
        ...(nombre               !== undefined ? { nombre }                                                      : {}),
        ...(cedula               !== undefined ? { cedula: cedula || null }                                      : {}),
        ...(categoria            !== undefined ? { categoria }                                                   : {}),
        ...(centros_autorizados  !== undefined ? { centros_autorizados }                                         : {}),
        ...(descanso_modalidad   !== undefined ? { descanso_modalidad: descanso_modalidad || null }              : {}),
        ...(pit_stop_minutos     !== undefined ? { pit_stop_minutos: parseInt(pit_stop_minutos, 10) }            : {}),
        ...(acceso_tiempos       !== undefined ? { acceso_tiempos }                                              : {}),
      };
      if (Object.keys(campos).length === 0) return err('Nada que actualizar', 400);
      const { data, error } = await supabase
        .from('empleados').update(campos).eq('id', id).select().single();
      if (error) throw error;
      return ok({ ok: true, empleado: data });
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

    // ── GET verifica si existe registro finalizado para combinación empleado/proyecto/item/centro ──
    if (action === 'registro-finalizado-existe' && req.method === 'GET') {
      const empleado_id = url.searchParams.get('empleado_id');
      const proyecto_id = url.searchParams.get('proyecto_id');
      const item_id     = url.searchParams.get('item_id');
      const centro      = url.searchParams.get('centro');
      if (!empleado_id || !proyecto_id || !item_id || !centro)
        return err('empleado_id, proyecto_id, item_id y centro son requeridos', 400);
      const { data, error } = await supabase
        .from('registros_trabajo')
        .select('id, fin')
        .eq('empleado_id', empleado_id)
        .eq('proyecto_id', proyecto_id)
        .eq('item_id',     item_id)
        .eq('centro',      centro)
        .eq('estado',      'finalizado')
        .eq('eliminada',   false)
        .order('fin', { ascending: false })
        .limit(1);
      if (error) throw error;
      return ok({ ok: true, existe: data && data.length > 0, ultimo: data?.[0] || null });
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
        .select('id, codigo, nombre, es_descanso, requiere_proyecto, requiere_mueble')
        .eq('activo', true)
        .order('nombre');
      if (error) throw error;
      return ok({ centros: data || [] });
    }

    // ── POST heartbeat (actualiza ultima_actividad del registro activo) ──────
    if (action === 'heartbeat' && req.method === 'POST') {
      const { empleado_id, registro_id } = body;
      if (!empleado_id || !registro_id) {
        throw new ApiError('empleado_id y registro_id requeridos', 400);
      }
      const { data: reg } = await supabase
        .from('registros_trabajo')
        .select('id, empleado_id, estado')
        .eq('id', registro_id)
        .maybeSingle();
      if (!reg) throw new ApiError('Registro no encontrado', 404);
      if (reg.empleado_id !== empleado_id) {
        throw new ApiError('No autorizado', 403);
      }
      if (reg.estado !== 'activo') {
        return ok({ ok: true, stale: true, reason: 'registro no activo' });
      }
      const ts = new Date().toISOString();
      const { error } = await supabase
        .from('registros_trabajo')
        .update({ ultima_actividad: ts })
        .eq('id', registro_id);
      if (error) throw error;
      return ok({ ok: true, ts });
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
      await _cerrarTareasActivasDe(supabase, j.empleado_id, salida);
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

    // ── POST reanudar-tarea (retoma o finaliza un registro pausado) ──────────
    if (action === 'reanudar-tarea' && req.method === 'POST') {
      const { empleado_id, registro_id, modo = 'retomar' } = body;
      if (!empleado_id || !registro_id) return err('empleado_id y registro_id requeridos', 400);
      if (!['retomar', 'finalizar'].includes(modo)) return err('modo debe ser retomar o finalizar', 400);

      const { data: reg, error: rErr } = await supabase
        .from('registros_trabajo')
        .select('id, empleado_id, estado')
        .eq('id', registro_id).maybeSingle();
      if (rErr) throw rErr;
      if (!reg) return err('Registro no encontrado', 404);
      if (reg.empleado_id !== empleado_id) return err('No autorizado', 403);
      if (reg.estado !== 'pausado') return err('El registro no está pausado', 400);

      const ahora = new Date().toISOString();
      if (modo === 'retomar') {
        // Cerrar cualquier activo existente
        await _cerrarTareasActivasDe(supabase, empleado_id, ahora);
        const { data: updated, error: upErr } = await supabase
          .from('registros_trabajo')
          .update({ estado: 'activo', inicio: ahora, ultima_actividad: ahora })
          .eq('id', registro_id)
          .select().single();
        if (upErr) throw upErr;
        return ok({ ok: true, registro: updated });
      } else {
        // modo=finalizar: marcar como finalizado
        const { data: updated, error: upErr } = await supabase
          .from('registros_trabajo')
          .update({ estado: 'finalizado', fin: ahora })
          .eq('id', registro_id)
          .select().single();
        if (upErr) throw upErr;
        return ok({ ok: true, registro: updated });
      }
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
      const { email, pin, password } = body;
      const credential = password || pin;
      if (!email || !credential) return err('email y credencial requeridos', 400);
      const { data, error } = await supabase
        .from('empleados')
        .select('id, nombre, email, categoria, rol_app, pin, password_hash, acceso_tiempos, centros_autorizados')
        .eq('email', email)
        .in('rol_app', ['admin', 'oficina'])
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return new Response(JSON.stringify({ ok: false, error: 'Credenciales incorrectas' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });

      let valid = false;
      if (data.rol_app === 'admin' && data.password_hash) {
        // Admin con hash: verificar contra hash
        try {
          valid = await scryptVerify(credential, data.password_hash);
          console.log('[debug-login] scryptVerify result:', valid, '| credential length:', credential?.length, '| hash prefix:', data.password_hash?.substring(0, 10));
        } catch(e) {
          console.error('[debug-login] scryptVerify threw:', e.message);
          valid = false;
        }
      } else {
        // Oficina siempre, o admin sin hash: comparar PIN plain text
        valid = (String(data.pin) === String(credential));
        // Migración silenciosa: admin con pin correcto → hashear
        if (valid && data.rol_app === 'admin') {
          const hash = await scryptHash(credential);
          await supabase.from('empleados').update({ password_hash: hash }).eq('id', data.id);
        }
      }
      if (!valid) return new Response(JSON.stringify({ ok: false, error: 'Credenciales incorrectas' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
      return ok({ ok: true, usuario: { id: data.id, nombre: data.nombre, email: data.email, rol_app: data.rol_app, categoria: data.categoria, acceso_tiempos: data.acceso_tiempos ?? false, centros_autorizados: data.centros_autorizados || [] } });
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
      if (String(emp.pin) !== String(pin_actual)) return new Response(JSON.stringify({ ok: false, error: 'PIN actual incorrecto' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
      const { error: uErr } = await supabase.from('empleados').update({ pin: pin_nuevo }).eq('id', empleado_id);
      if (uErr) throw uErr;
      return ok({ ok: true });
    }

    // ── POST cambiar contraseña (admin con hash) ────────────────────────────
    if (action === 'cambiar-password' && req.method === 'POST') {
      const { empleado_id, password_actual, password_nuevo, password_confirmar } = body;
      if (!empleado_id || !password_actual || !password_nuevo || !password_confirmar)
        return err('empleado_id, password_actual, password_nuevo y password_confirmar requeridos', 400);
      if (password_nuevo !== password_confirmar)
        return new Response(JSON.stringify({ ok: false, error: 'Las contraseñas no coinciden' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
      if (password_nuevo.length < 6)
        return new Response(JSON.stringify({ ok: false, error: 'La contraseña debe tener mínimo 6 caracteres' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
      const { data: emp, error: eErr } = await supabase
        .from('empleados').select('pin, password_hash, rol_app').eq('id', empleado_id).maybeSingle();
      if (eErr) throw eErr;
      if (!emp) return err('Empleado no encontrado', 404);
      if (emp.rol_app !== 'admin')
        return new Response(JSON.stringify({ ok: false, error: 'Solo usuarios admin pueden cambiar contraseña' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      let valid = false;
      if (emp.password_hash) {
        valid = await scryptVerify(password_actual, emp.password_hash);
      } else {
        valid = (String(emp.pin) === String(password_actual));
      }
      if (!valid)
        return new Response(JSON.stringify({ ok: false, error: 'Contraseña actual incorrecta' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
      const hash = await scryptHash(password_nuevo);
      const { error: uErr } = await supabase.from('empleados').update({ password_hash: hash }).eq('id', empleado_id);
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
      const { id, nombre, numero, obra, clienteNombre, fechaInicio, fechaEntrega,
              notas, estado, muebles, materiales, sosCargadas, modulos, creadoEn,
              activo: activoBody } = body;
      const { data, error } = await supabase.from('proyectos_cache')
        .upsert({
          id, nombre: nombre || numero || obra, numero, obra,
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

    // ── GET proveedores-terceros ─────────────────────────────────────────
    if (action === 'proveedores-terceros' && req.method === 'GET') {
      const { data, error } = await supabase.from('proveedores_terceros')
        .select('*').eq('activo', true).order('creado_en');
      if (error) throw error;
      return ok({ ok: true, proveedores: data || [] });
    }

    // ── POST guardar-proveedor ────────────────────────────────────────────
    if (action === 'guardar-proveedor' && req.method === 'POST') {
      const { id, nombre, tipo, icono } = body;
      if (!nombre) return err('nombre requerido', 400);
      if (id) {
        // Update existing
        const { error } = await supabase.from('proveedores_terceros')
          .update({ nombre, tipo: tipo || null, icono: icono || '✨' })
          .eq('id', id);
        if (error) throw error;
      } else {
        // Insert new
        const { error } = await supabase.from('proveedores_terceros')
          .insert({ nombre, tipo: tipo || null, icono: icono || '✨', activo: true });
        if (error) throw error;
      }
      return ok({ ok: true });
    }

    // ── POST eliminar-proveedor (soft delete) ─────────────────────────────
    if (action === 'eliminar-proveedor' && req.method === 'POST') {
      const { id } = body;
      if (!id) return err('id requerido', 400);
      const { error } = await supabase.from('proveedores_terceros')
        .update({ activo: false }).eq('id', id);
      if (error) throw error;
      return ok({ ok: true });
    }

    // ── GET get-envio (público, sin auth) ────────────────────────────────
    if (action === 'get-envio' && req.method === 'GET') {
      const numero = url.searchParams.get('numero');
      if (!numero) return err('numero requerido', 400);
      const { data, error } = await supabase.from('partidas_terceros')
        .select('*').eq('numero_envio', numero).maybeSingle();
      if (error) throw error;
      if (!data) return ok({ ok: false, error: 'no encontrado' });
      const provs = {};
      try {
        const { data: cfg } = await supabase.from('config_global').select('valor').eq('clave', 'proveedores').maybeSingle();
        if (cfg?.valor) { provs.tap = cfg.valor.tap; provs.lus = cfg.valor.lus; }
      } catch(e) {}
      return ok({ ok: true, envio: {
        numero_envio: data.numero_envio,
        estado: data.estado,
        cliente: data.cliente || '',
        obra: data.obra || '',
        proyectoNum: data.proyecto_num || '',
        mueble_nombre: data.mueble_nombre || '',
        mueble_codigo: data.mueble_codigo || '',
        proveedor: data.tipo === 'tap' ? (provs.tap || 'Tapicero') : (provs.lus || 'Lustrador'),
        fecha_despacho: data.fecha_despacho || '',
        fecha_retorno_estimada: data.fecha_retorno_estimada || '',
        fecha_recepcion: data.fecha_recepcion || '',
        obs: data.obs || '',
      }});
    }

    // ── GET partidas tercerizados ─────────────────────────────────────────
    if (action === 'partidas' && req.method === 'GET') {
      const { data, error } = await supabase.from('partidas_terceros').select('*').order('creado_at', { ascending: false });
      if (error) throw error;
      return ok({ partidas: (data || []).map(p => ({
        id: p.id, tipo: p.tipo, proyectoNum: p.proyecto_num, obra: p.obra,
        cliente: p.cliente || '', muebleCodigo: p.mueble_codigo, muebleNombre: p.mueble_nombre,
        estado: p.estado, partes: p.partes, tipoDespacho: p.tipo_despacho,
        fechaDespacho: p.fecha_despacho, fechaRecepcion: p.fecha_recepcion,
        estadoRecep: p.estado_recep, obs: p.obs, nota: p.nota,
        bultos: p.bultos || 0, numero_envio: p.numero_envio || '',
        fechaRetornoEstimada: p.fecha_retorno_estimada || '',
      })) });
    }

    // ── POST guardar partida ──────────────────────────────────────────────
    if (action === 'guardar-partida' && req.method === 'POST') {
      const { id, tipo, proyectoNum, obra, cliente, muebleCodigo, muebleNombre,
              estado, partes, tipoDespacho, fechaDespacho, fechaRecepcion,
              estadoRecep, obs, nota, bultos, numero_envio, fechaRetornoEstimada } = body;
      // Asignar ENV al crear (si no tiene numero_envio y es registro nuevo)
      let envioFinal = numero_envio || null;
      if (!envioFinal && id) {
        // Check if record already exists in DB
        const { data: existing } = await supabase.from('partidas_terceros')
          .select('numero_envio').eq('id', id).maybeSingle();
        if (existing?.numero_envio) {
          envioFinal = existing.numero_envio; // Keep existing
        } else if (!existing) {
          // New record — generate ENV
          try {
            const { data: seqData, error: seqErr } = await supabase.rpc('nextval_envio');
            if (!seqErr && seqData) envioFinal = 'ENV-' + String(seqData).padStart(4, '0');
          } catch(e) {}
        }
      }
      const row = { id, tipo: tipo || null, proyecto_num: proyectoNum, obra, cliente: cliente || '',
                  mueble_codigo: muebleCodigo, mueble_nombre: muebleNombre,
                  estado: estado || 'en_taller', partes, tipo_despacho: tipoDespacho,
                  fecha_despacho: fechaDespacho, fecha_recepcion: fechaRecepcion,
                  estado_recep: estadoRecep, obs, nota,
                  bultos: bultos || 0, numero_envio: envioFinal };
      if (fechaRetornoEstimada) row.fecha_retorno_estimada = fechaRetornoEstimada;
      const { data, error } = await supabase.from('partidas_terceros')
        .upsert(row, { onConflict: 'id' })
        .select().single();
      if (error) throw error;
      return ok({ partida: data, numero_envio: envioFinal });
    }

    // ── POST despachar-partida (asigna numero_envio) ─────────────────────
    if (action === 'despachar-partida' && req.method === 'POST') {
      const { partida_id, bultos, partes, fecha, nota, tipoDespacho } = body;
      if (!partida_id) return err('partida_id requerido', 400);
      // Verificar si ya tiene numero_envio; si no, asignar como fallback
      const { data: existing } = await supabase.from('partidas_terceros')
        .select('numero_envio').eq('id', partida_id).maybeSingle();
      let numero_envio = existing?.numero_envio || null;
      if (!numero_envio) {
        try {
          const { data: seqData, error: seqErr } = await supabase.rpc('nextval_envio');
          if (!seqErr && seqData) numero_envio = 'ENV-' + String(seqData).padStart(4, '0');
        } catch(e) {}
      }
      const updateRow = {
        estado: 'despachada', tipo_despacho: tipoDespacho || 'total',
        bultos: bultos || 1, partes: partes || '', nota: nota || '',
        fecha_despacho: fecha || new Date().toISOString().split('T')[0],
      };
      if (numero_envio) updateRow.numero_envio = numero_envio;
      const { data, error } = await supabase.from('partidas_terceros')
        .update(updateRow).eq('id', partida_id).select().single();
      if (error) throw error;
      return ok({ ok: true, numero_envio: numero_envio || data?.numero_envio, partida: data });
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

      const fechaParam = url.searchParams.get('fecha');
      const hoy = new Date().toISOString().split('T')[0];
      const fecha = fechaParam || hoy;
      const esHoy = fecha === hoy;
      const ahora = new Date();

      // 1. Jornada del día solicitado
      let jornadaQuery = supabase.from('jornadas').select('*')
        .eq('empleado_id', empleado_id).eq('fecha', fecha);
      if (esHoy) jornadaQuery = jornadaQuery.is('salida', null);
      const { data: jornada, error: jErr } = await jornadaQuery.maybeSingle();
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
      const centroCodes = [...new Set(regs.map(r => r.centro).filter(Boolean))];
      const descanso_centros = new Set();
      if (centroCodes.length > 0) {
        const { data: cvs } = await supabase
          .from('centros_virtuales').select('codigo, es_descanso').in('codigo', centroCodes);
        (cvs || []).forEach(cv => { if (cv.es_descanso) descanso_centros.add(cv.codigo); });
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

      // tiempo_pago: trabajo + descanso pago según modalidad y tomo_descanso
      const tomo_descanso = jornada.tomo_descanso ?? true;
      let tiempo_pago_minutos;
      if (descanso_modalidad === 'paga_30') {
        tiempo_pago_minutos = tiempo_clasificado_minutos +
          (tomo_descanso ? descanso_acumulado_minutos : 0);
      } else if (descanso_modalidad === 'no_paga_60') {
        tiempo_pago_minutos = Math.max(0,
          tiempo_clasificado_minutos - (tomo_descanso ? 60 : 0));
      } else {
        tiempo_pago_minutos = tiempo_clasificado_minutos;
      }

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
        tomo_descanso,
      }});
    }

    // ── GET tipos-cambio ─────────────────────────────────────────────────
    if (action === 'tipos-cambio' && req.method === 'GET') {
      const { data, error } = await supabase
        .from('tipo_cambio')
        .select('id, moneda_origen, moneda_destino, valor, actualizado_en')
        .order('moneda_origen');
      if (error) throw error;
      return ok({ ok: true, tipos_cambio: data });
    }

    // ── POST actualizar-tipo-cambio (solo admin) ──────────────────────────
    if (action === 'actualizar-tipo-cambio' && req.method === 'POST') {
      const { admin_id, moneda_origen, moneda_destino, valor } = body;
      if (!admin_id || !moneda_origen || !moneda_destino || valor === undefined)
        return err('admin_id, moneda_origen, moneda_destino y valor requeridos', 400);
      if (typeof valor !== 'number' || valor <= 0)
        return err('valor debe ser mayor a 0', 400);
      const { data: caller } = await supabase
        .from('empleados').select('rol_app').eq('id', admin_id).maybeSingle();
      if (!caller || caller.rol_app !== 'admin')
        return new Response(JSON.stringify({ ok: false, error: 'Solo admin puede modificar el tipo de cambio' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      const { data, error } = await supabase
        .from('tipo_cambio')
        .upsert(
          { moneda_origen, moneda_destino, valor, actualizado_en: new Date().toISOString(), actualizado_por: admin_id },
          { onConflict: 'moneda_origen,moneda_destino' }
        )
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
      return ok({ ok: true, tarifas: data });
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
        .not('fin', 'is', null)
        .eq('eliminada', false);
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
        .map(c => {
          const horas = Math.round(horasCat[c] * 10) / 10;
          return {
            categoria: c,
            horas,
            tarifa_usd: tarifaMap[c] || 0,
            subtotal_usd: Math.round(horas * (tarifaMap[c] || 0) * 100) / 100,
          };
        });
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
      // Costos directos
      const { data: costosDir, error: cdErr } = await supabase
        .from('costos_directos_proyecto')
        .select('id, tipo, descripcion, monto_usd, fecha, moneda_original, monto_original, tc_aplicado, oc_numero, oc_total_usd, creado_en')
        .eq('proyecto_id', proyecto_id)
        .order('fecha', { ascending: false })
        .order('creado_en', { ascending: false });
      if (cdErr) throw cdErr;
      const costos_directos = costosDir || [];
      const costos_directos_total_usd = costos_directos.reduce((a, r) => a + Number(r.monto_usd), 0);
      // Totales redondeados primero para que la suma sea consistente con los parciales mostrados
      const mo_total_usd_round = Math.round(mo_total_usd * 100) / 100;
      const mat_total_usd_round = Math.round(mat_total_usd * 100) / 100;
      const cd_total_usd_round = Math.round(costos_directos_total_usd * 100) / 100;
      const total_proyecto_usd = Math.round((mo_total_usd_round + mat_total_usd_round + cd_total_usd_round) * 100) / 100;
      return ok({
        ok: true,
        proyecto: { id: pr.id, codigo: pr.numero, nombre: pr.nombre || pr.obra, cliente_nombre: pr.cliente_nombre },
        mano_obra: { por_categoria, total_horas: Math.round(total_horas * 100) / 100, total_usd: mo_total_usd_round },
        materiales: { items: matItems, total_usd: mat_total_usd_round },
        costos_directos: { items: costos_directos, total_usd: cd_total_usd_round },
        total_proyecto_usd,
        sin_costear: { registros_sin_categoria, materiales_sin_costo },
      });
    }

    // ── POST editar-costo-material (solo admin) ───────────────────────────
    if (action === 'editar-costo-material' && req.method === 'POST') {
      const { admin_id, proyecto_id, key, costo_unitario_usd, cantidad } = body;
      if (!admin_id || !proyecto_id || !key || costo_unitario_usd === undefined) {
        return err('admin_id, proyecto_id, key y costo_unitario_usd requeridos', 400);
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
      const cant = Number(cantidad) || 0;
      const costo_total_usd = Math.round(cant * costo_unitario_usd * 100) / 100;
      const existIdx = mats.findIndex(o => o.key === key);
      if (existIdx >= 0) {
        mats[existIdx] = { ...mats[existIdx], costo_unitario_usd, costo_total_usd };
      } else {
        mats.push({ key, costo_unitario_usd, costo_total_usd });
      }
      const { error: uErr } = await supabase
        .from('proyectos_cache').update({ materiales: mats }).eq('id', proyecto_id);
      if (uErr) throw uErr;
      return ok({ ok: true });
    }

    // ── GET materiales-proyecto ─────────────────────────────────────────────
    if (action === 'materiales-proyecto' && req.method === 'GET') {
      const proyecto_id = url.searchParams.get('proyecto_id');
      if (!proyecto_id) return err('proyecto_id requerido', 400);

      // SOs vinculadas al proyecto
      const { data: sos, error: soErr } = await supabase
        .from('so_estado')
        .select('so_zoho_id, so_numero, mueble, obra, estado')
        .eq('proyecto_id', proyecto_id)
        .eq('oculta', false);
      if (soErr) throw soErr;

      // Overrides de precios guardados
      const { data: pr } = await supabase
        .from('proyectos_cache')
        .select('materiales')
        .eq('id', proyecto_id)
        .maybeSingle();
      const overrides = pr?.materiales || [];

      // Fetch cada SO de Zoho en paralelo
      const orgId = process.env.ZOHO_ORG_ID;
      const zoho_token = await getZohoToken();

      const results = await Promise.all((sos || []).map(async (so) => {
        try {
          // Buscar SO por número
          const searchUrl = `https://www.zohoapis.com/books/v3/salesorders?salesorder_number=${encodeURIComponent(so.so_numero)}&organization_id=${orgId}`;
          const searchRes = await fetch(searchUrl, { headers: { 'Authorization': `Zoho-oauthtoken ${zoho_token}` } });
          if (!searchRes.ok) throw new Error('Zoho search ' + searchRes.status);
          const searchData = await searchRes.json();
          const soFound = (searchData.salesorders || [])[0];
          if (!soFound) return { so_numero: so.so_numero, so_zoho_id: so.so_zoho_id, mueble: so.mueble, estado: so.estado, lineas: [], error: 'SO no encontrada en Zoho' };

          // Detalle de la SO
          const detUrl = `https://www.zohoapis.com/books/v3/salesorders/${soFound.salesorder_id}?organization_id=${orgId}`;
          const detRes = await fetch(detUrl, { headers: { 'Authorization': `Zoho-oauthtoken ${zoho_token}` } });
          if (!detRes.ok) throw new Error('Zoho detail ' + detRes.status);
          const detData = await detRes.json();
          const lineItems = detData.salesorder?.line_items || [];

          const lineas = lineItems.map(li => {
            const key = so.so_numero + '::' + li.line_item_id;
            const ov = overrides.find(o => o.key === key);
            const cu = ov?.costo_unitario_usd ?? null;
            const cant = li.quantity || 0;
            return {
              key,
              nombre: li.name || li.description || '',
              cantidad: cant,
              unidad: li.unit || 'u',
              precio_zoho: li.rate || 0,
              costo_unitario_usd: cu,
              costo_total_usd: cu != null ? Math.round(cu * cant * 100) / 100 : null,
            };
          });

          return { so_numero: so.so_numero, so_zoho_id: so.so_zoho_id, mueble: so.mueble, estado: so.estado, lineas };
        } catch (e) {
          return { so_numero: so.so_numero, so_zoho_id: so.so_zoho_id, mueble: so.mueble, estado: so.estado, lineas: [], error: e.message };
        }
      }));

      return ok({ ok: true, materiales: results });
    }

    // ── GET buscar-oc-zoho ────────────────────────────────────────────────
    if (action === 'buscar-oc-zoho' && req.method === 'GET') {
      const oc_raw           = url.searchParams.get('oc_numero');
      const excluir_costo_id = url.searchParams.get('excluir_costo_id') || null;
      if (!oc_raw) return err('oc_numero requerido', 400);

      // Token obtenido server-side (no expuesto al cliente)
      const zoho_token = await getZohoToken();

      // Búsqueda en Zoho: 3 formatos de número (strip prefix, sin padding, con padding 5 dígitos)
      const orgId = process.env.ZOHO_ORG_ID;
      const base = oc_raw.replace(/^OC-?/i, '').trim();
      const candidatos = [`OC-${base}`, `OC-${base.padStart(5, '0')}`, base];
      let ocSummary = null, ocNumUsado = null;
      for (const candidato of candidatos) {
        const zUrl = `https://www.zohoapis.com/books/v3/purchaseorders?purchaseorder_number=${encodeURIComponent(candidato)}&organization_id=${orgId}`;
        const zRes = await fetch(zUrl, { headers: { 'Authorization': `Zoho-oauthtoken ${zoho_token}` } });
        const zData = await zRes.json();
        const found = zData.purchaseorders?.[0];
        if (found) { ocSummary = found; ocNumUsado = candidato; break; }
      }
      if (!ocSummary) return err(`OC "${oc_raw}" no encontrada en Zoho Books`, 404);

      // Detalle completo (para total, fecha, moneda)
      const zDetailUrl = `https://www.zohoapis.com/books/v3/purchaseorders/${ocSummary.purchaseorder_id}?organization_id=${orgId}`;
      const zDetailRes = await fetch(zDetailUrl, { headers: { 'Authorization': `Zoho-oauthtoken ${zoho_token}` } });
      const zDetail = await zDetailRes.json();
      const oc = zDetail.purchaseorder;
      if (!oc) return err('Error al obtener detalle de la OC desde Zoho', 502);

      // Moneda y conversión
      const moneda_original = oc.currency_code || 'USD';
      const total_original  = Number(oc.total) || 0;
      let total_usd = total_original;
      let tc_aplicado = null;
      if (moneda_original === 'UYU') {
        const { data: tcRow, error: tcErr } = await supabase
          .from('tipo_cambio').select('valor')
          .eq('moneda_origen', 'UYU').eq('moneda_destino', 'USD').maybeSingle();
        if (tcErr) throw tcErr;
        const tcValor = tcRow ? Number(tcRow.valor) : 0;
        if (!tcValor || tcValor <= 0)
          return err('Tipo de cambio UYU/USD no configurado', 500);
        tc_aplicado = tcValor;
        total_usd   = total_original / tcValor;
      } else if (moneda_original !== 'USD') {
        return err(`Moneda ${moneda_original} no soportada. Usá un costo manual para imputar este gasto.`, 422);
      }

      // Cross-project: suma de lo ya imputado para esta OC
      let imputadosQ = supabase
        .from('costos_directos_proyecto')
        .select('id, proyecto_id, monto_usd, fecha')
        .eq('oc_numero', ocNumUsado);
      if (excluir_costo_id) imputadosQ = imputadosQ.neq('id', excluir_costo_id);
      const { data: imputados, error: impErr } = await imputadosQ;
      if (impErr) throw impErr;
      const ya_imputado_usd = (imputados || []).reduce((a, r) => a + Number(r.monto_usd), 0);
      const disponible_usd  = total_usd - ya_imputado_usd; // puede ser negativo, no es error

      return ok({
        ok: true,
        oc: {
          numero:          ocNumUsado,
          fecha:           oc.date || null,
          moneda_original,
          total_original:  Math.round(total_original * 100) / 100,
          total_usd:       Math.round(total_usd * 100) / 100,
          tc_aplicado,
        },
        imputaciones: {
          ya_imputado_usd: Math.round(ya_imputado_usd * 100) / 100,
          disponible_usd:  Math.round(disponible_usd * 100) / 100,
          detalle: (imputados || []).map(r => ({
            costo_id:   r.id,
            proyecto_id: r.proyecto_id,
            monto_usd:  Number(r.monto_usd),
            fecha:      r.fecha,
          })),
        },
      });
    }

    // ── POST agregar-costo-directo (solo admin) ───────────────────────────
    if (action === 'agregar-costo-directo' && req.method === 'POST') {
      const { admin_id, proyecto_id, tipo, fecha,
              monto_original: mont_orig_raw, moneda_original,
              oc_numero: oc_raw, descripcion } = body;

      // 1) Campos comunes obligatorios
      if (!admin_id || !proyecto_id || !tipo || !fecha || mont_orig_raw === undefined || !moneda_original)
        return err('admin_id, proyecto_id, tipo, fecha, monto_original y moneda_original son requeridos', 400);

      // 2) Admin check
      const { data: caller } = await supabase
        .from('empleados').select('rol_app').eq('id', admin_id).maybeSingle();
      if (!caller || caller.rol_app !== 'admin')
        return new Response(JSON.stringify({ ok: false, error: 'Solo admin puede agregar costos directos' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });

      // 3) tipo válido
      if (!['oc', 'manual'].includes(tipo))
        return err('tipo debe ser "oc" o "manual"', 400);

      // 4) monto_original > 0
      const monto_original = Number(mont_orig_raw);
      if (isNaN(monto_original) || monto_original <= 0)
        return err('monto_original debe ser número > 0', 400);

      // 5) moneda_original soportada
      if (!['USD', 'UYU'].includes(moneda_original))
        return err(`Moneda ${moneda_original} no soportada. Solo USD o UYU.`, 422);

      // 6) fecha formato YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha))
        return err('fecha debe tener formato YYYY-MM-DD', 400);

      // 7) oc_numero requerido si tipo === 'oc'
      if (tipo === 'oc' && (!oc_raw || !String(oc_raw).trim()))
        return err('oc_numero es requerido para tipo oc', 400);

      // 8) descripcion requerida si tipo === 'manual'
      if (tipo === 'manual' && (!descripcion || !String(descripcion).trim()))
        return err('descripcion es requerida para tipo manual', 400);

      // 9) proyecto_id existe
      const { data: proyecto, error: prErr } = await supabase
        .from('proyectos_cache').select('id').eq('id', proyecto_id).maybeSingle();
      if (prErr) throw prErr;
      if (!proyecto) return err('Proyecto no encontrado', 404);

      let monto_usd, tc_aplicado = null;
      let oc_numero = null, oc_total_usd = null;

      // ── LOGICA MANUAL ──────────────────────────────────────────────────
      if (tipo === 'manual') {
        if (moneda_original === 'USD') {
          monto_usd = monto_original;
        } else {
          const { data: tcRow, error: tcErr } = await supabase
            .from('tipo_cambio').select('valor')
            .eq('moneda_origen', 'UYU').eq('moneda_destino', 'USD').maybeSingle();
          if (tcErr) throw tcErr;
          const tcValor = tcRow ? Number(tcRow.valor) : 0;
          if (!tcValor || tcValor <= 0)
            return err('Tipo de cambio UYU/USD no configurado', 500);
          tc_aplicado = tcValor;
          monto_usd = Math.round((monto_original / tcValor) * 100) / 100;
        }
        const { data: nuevo, error: insErr } = await supabase
          .from('costos_directos_proyecto')
          .insert({
            proyecto_id, tipo: 'manual',
            descripcion: String(descripcion).trim(),
            oc_numero: null, oc_total_usd: null,
            monto_usd, moneda_original, monto_original, tc_aplicado,
            fecha, creado_por: admin_id,
          })
          .select().single();
        if (insErr) throw insErr;
        return ok({ ok: true, costo: nuevo });
      }

      // ── LOGICA OC ─────────────────────────────────────────────────────
      // a) Buscar OC en Zoho server-side (3 formatos, token server-side)
      const zoho_token = await getZohoToken();
      const orgId = process.env.ZOHO_ORG_ID;
      const base = String(oc_raw).replace(/^(OC-|oc-)/i, '').trim();
      const candidatos = [`OC-${base}`, `OC-${base.padStart(5, '0')}`, base];
      let ocSummary = null, ocNumUsado = null;
      for (const candidato of candidatos) {
        const zUrl = `https://www.zohoapis.com/books/v3/purchaseorders?purchaseorder_number=${encodeURIComponent(candidato)}&organization_id=${orgId}`;
        const zRes = await fetch(zUrl, { headers: { 'Authorization': `Zoho-oauthtoken ${zoho_token}` } });
        const zData = await zRes.json();
        const found = zData.purchaseorders?.[0];
        if (found) { ocSummary = found; ocNumUsado = candidato; break; }
      }
      if (!ocSummary) return err(`OC "${oc_raw}" no encontrada en Zoho Books`, 404);

      const zDetailUrl = `https://www.zohoapis.com/books/v3/purchaseorders/${ocSummary.purchaseorder_id}?organization_id=${orgId}`;
      const zDetailRes = await fetch(zDetailUrl, { headers: { 'Authorization': `Zoho-oauthtoken ${zoho_token}` } });
      const zDetail = await zDetailRes.json();
      const oc = zDetail.purchaseorder;
      if (!oc) return err('Error al obtener detalle de la OC desde Zoho', 502);

      // b) Verificar que la moneda de la OC coincide con moneda_original del body
      const oc_currency = oc.currency_code || 'USD';
      if (oc_currency !== moneda_original)
        return err(`La moneda de la OC en Zoho (${oc_currency}) no coincide con la indicada (${moneda_original})`, 422);

      // c) Calcular oc_total_usd y tc (mismo TC que se usará en d)
      const oc_total_moneda = Number(oc.total) || 0;
      let tc = null;
      if (oc_currency === 'USD') {
        oc_total_usd = oc_total_moneda;
      } else {
        const { data: tcRow, error: tcErr } = await supabase
          .from('tipo_cambio').select('valor')
          .eq('moneda_origen', 'UYU').eq('moneda_destino', 'USD').maybeSingle();
        if (tcErr) throw tcErr;
        tc = tcRow ? Number(tcRow.valor) : 0;
        if (!tc || tc <= 0)
          return err('Tipo de cambio UYU/USD no configurado', 500);
        oc_total_usd = oc_total_moneda / tc;
        tc_aplicado = tc;
      }

      // d) Calcular monto_usd a imputar (mismo TC que paso c)
      if (moneda_original === 'USD') {
        monto_usd = monto_original;
      } else {
        monto_usd = Math.round((monto_original / tc) * 100) / 100;
      }

      // e) Validar cross-project
      const { data: imputados, error: impErr } = await supabase
        .from('costos_directos_proyecto').select('monto_usd').eq('oc_numero', ocNumUsado);
      if (impErr) throw impErr;
      const ya_imputado_usd = (imputados || []).reduce((a, r) => a + Number(r.monto_usd), 0);
      const disponible_usd = oc_total_usd - ya_imputado_usd;
      if (monto_usd > disponible_usd + 0.01) {
        return err(
          `Monto excede disponible. Disponible: $${disponible_usd.toFixed(2)} USD. ` +
          `Intentas imputar: $${monto_usd.toFixed(2)} USD. ` +
          `Ya imputado en otros proyectos: $${ya_imputado_usd.toFixed(2)} USD.`,
          422
        );
      }

      // f) INSERT OC
      oc_numero = ocNumUsado;
      const { data: nuevo, error: insErr } = await supabase
        .from('costos_directos_proyecto')
        .insert({
          proyecto_id, tipo: 'oc',
          oc_numero,
          oc_total_usd: Math.round(oc_total_usd * 100) / 100,
          descripcion: null,
          monto_usd: Math.round(monto_usd * 100) / 100,
          moneda_original, monto_original, tc_aplicado,
          fecha, creado_por: admin_id,
        })
        .select().single();
      if (insErr) throw insErr;
      return ok({ ok: true, costo: nuevo });
    }

    // ── GET costos-directos-proyecto ─────────────────────────────────────
    if (action === 'costos-directos-proyecto' && req.method === 'GET') {
      const proyecto_id = url.searchParams.get('proyecto_id');
      if (!proyecto_id) return err('proyecto_id requerido', 400);
      const { data, error } = await supabase
        .from('costos_directos_proyecto')
        .select('id, tipo, oc_numero, oc_total_usd, descripcion, monto_usd, moneda_original, monto_original, tc_aplicado, fecha, creado_por, creado_en')
        .eq('proyecto_id', proyecto_id)
        .order('fecha', { ascending: false })
        .order('creado_en', { ascending: false });
      if (error) throw error;
      const total_usd = (data || []).reduce((a, r) => a + Number(r.monto_usd), 0);
      return ok({ ok: true, costos: data || [], total_usd: Math.round(total_usd * 100) / 100 });
    }

    // ── POST editar-costo-directo (solo admin) ────────────────────────────
    if (action === 'editar-costo-directo' && req.method === 'POST') {
      const { admin_id, costo_id, fecha,
              monto_original: mont_orig_raw, moneda_original,
              oc_numero: oc_raw, descripcion } = body;

      // 1) Campos comunes obligatorios
      if (!admin_id || !costo_id || !fecha || mont_orig_raw === undefined || !moneda_original)
        return err('admin_id, costo_id, fecha, monto_original y moneda_original son requeridos', 400);

      // 2) Admin check
      const { data: caller } = await supabase
        .from('empleados').select('rol_app').eq('id', admin_id).maybeSingle();
      if (!caller || caller.rol_app !== 'admin')
        return new Response(JSON.stringify({ ok: false, error: 'Solo admin puede editar costos directos' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });

      // 3) Buscar registro existente (tipo y proyecto_id son inmutables)
      const { data: costo, error: fetchErr } = await supabase
        .from('costos_directos_proyecto').select('*').eq('id', costo_id).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!costo) return err('Costo directo no encontrado', 404);
      const { tipo } = costo;

      // 4) monto_original > 0
      const monto_original = Number(mont_orig_raw);
      if (isNaN(monto_original) || monto_original <= 0)
        return err('monto_original debe ser número > 0', 400);

      // 5) moneda_original soportada
      if (!['USD', 'UYU'].includes(moneda_original))
        return err(`Moneda ${moneda_original} no soportada. Solo USD o UYU.`, 422);

      // 6) fecha formato YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha))
        return err('fecha debe tener formato YYYY-MM-DD', 400);

      // 7) oc_numero requerido si tipo === 'oc'
      if (tipo === 'oc' && (!oc_raw || !String(oc_raw).trim()))
        return err('oc_numero es requerido para tipo oc', 400);

      // 8) descripcion requerida si tipo === 'manual'
      if (tipo === 'manual' && (!descripcion || !String(descripcion).trim()))
        return err('descripcion es requerida para tipo manual', 400);

      let monto_usd, tc_aplicado = null;

      // ── LOGICA MANUAL ──────────────────────────────────────────────────
      if (tipo === 'manual') {
        if (moneda_original === 'USD') {
          monto_usd = monto_original;
        } else {
          const { data: tcRow, error: tcErr } = await supabase
            .from('tipo_cambio').select('valor')
            .eq('moneda_origen', 'UYU').eq('moneda_destino', 'USD').maybeSingle();
          if (tcErr) throw tcErr;
          const tcValor = tcRow ? Number(tcRow.valor) : 0;
          if (!tcValor || tcValor <= 0)
            return err('Tipo de cambio UYU/USD no configurado', 500);
          tc_aplicado = tcValor;
          monto_usd = Math.round((monto_original / tcValor) * 100) / 100;
        }
        const { data: updated, error: updErr } = await supabase
          .from('costos_directos_proyecto')
          .update({
            descripcion: String(descripcion).trim(),
            monto_usd, moneda_original, monto_original, tc_aplicado, fecha,
          })
          .eq('id', costo_id)
          .select().single();
        if (updErr) throw updErr;
        return ok({ ok: true, costo: updated });
      }

      // ── LOGICA OC ─────────────────────────────────────────────────────
      // a) Buscar OC en Zoho server-side (3 formatos, token server-side)
      const zoho_token = await getZohoToken();
      const orgId = process.env.ZOHO_ORG_ID;
      const base = String(oc_raw).replace(/^(OC-|oc-)/i, '').trim();
      const candidatos = [`OC-${base}`, `OC-${base.padStart(5, '0')}`, base];
      let ocSummary = null, ocNumUsado = null;
      for (const candidato of candidatos) {
        const zUrl = `https://www.zohoapis.com/books/v3/purchaseorders?purchaseorder_number=${encodeURIComponent(candidato)}&organization_id=${orgId}`;
        const zRes = await fetch(zUrl, { headers: { 'Authorization': `Zoho-oauthtoken ${zoho_token}` } });
        const zData = await zRes.json();
        const found = zData.purchaseorders?.[0];
        if (found) { ocSummary = found; ocNumUsado = candidato; break; }
      }
      if (!ocSummary) return err(`OC "${oc_raw}" no encontrada en Zoho Books`, 404);

      const zDetailUrl = `https://www.zohoapis.com/books/v3/purchaseorders/${ocSummary.purchaseorder_id}?organization_id=${orgId}`;
      const zDetailRes = await fetch(zDetailUrl, { headers: { 'Authorization': `Zoho-oauthtoken ${zoho_token}` } });
      const zDetail = await zDetailRes.json();
      const oc = zDetail.purchaseorder;
      if (!oc) return err('Error al obtener detalle de la OC desde Zoho', 502);

      // b) Verificar que la moneda de la OC coincide con moneda_original del body
      const oc_currency = oc.currency_code || 'USD';
      if (oc_currency !== moneda_original)
        return err(`La moneda de la OC en Zoho (${oc_currency}) no coincide con la indicada (${moneda_original})`, 422);

      // c) Calcular oc_total_usd y tc (mismo TC que se usará en d)
      const oc_total_moneda = Number(oc.total) || 0;
      let tc = null, oc_total_usd;
      if (oc_currency === 'USD') {
        oc_total_usd = oc_total_moneda;
        tc_aplicado = null;
      } else {
        const { data: tcRow, error: tcErr } = await supabase
          .from('tipo_cambio').select('valor')
          .eq('moneda_origen', 'UYU').eq('moneda_destino', 'USD').maybeSingle();
        if (tcErr) throw tcErr;
        tc = tcRow ? Number(tcRow.valor) : 0;
        if (!tc || tc <= 0)
          return err('Tipo de cambio UYU/USD no configurado', 500);
        oc_total_usd = oc_total_moneda / tc;
        tc_aplicado = tc;
      }

      // d) Calcular monto_usd a imputar (mismo TC que paso c)
      if (moneda_original === 'USD') {
        monto_usd = monto_original;
      } else {
        monto_usd = Math.round((monto_original / tc) * 100) / 100;
      }

      // e) Validar cross-project excluyendo el registro actual
      const { data: imputados, error: impErr } = await supabase
        .from('costos_directos_proyecto').select('monto_usd')
        .eq('oc_numero', ocNumUsado)
        .neq('id', costo_id);
      if (impErr) throw impErr;
      const ya_imputado_usd = (imputados || []).reduce((a, r) => a + Number(r.monto_usd), 0);
      const disponible_usd = oc_total_usd - ya_imputado_usd;
      if (monto_usd > disponible_usd + 0.01) {
        return err(
          `Monto excede disponible. Disponible: $${disponible_usd.toFixed(2)} USD. ` +
          `Intentas imputar: $${monto_usd.toFixed(2)} USD. ` +
          `Ya imputado en otros proyectos: $${ya_imputado_usd.toFixed(2)} USD.`,
          422
        );
      }

      // f) UPDATE OC
      const { data: updated, error: updErr } = await supabase
        .from('costos_directos_proyecto')
        .update({
          oc_numero: ocNumUsado,
          oc_total_usd: Math.round(oc_total_usd * 100) / 100,
          monto_usd: Math.round(monto_usd * 100) / 100,
          moneda_original, monto_original, tc_aplicado, fecha,
        })
        .eq('id', costo_id)
        .select().single();
      if (updErr) throw updErr;
      return ok({ ok: true, costo: updated });
    }

    // ── POST eliminar-costo-directo (solo admin) ──────────────────────────
    if (action === 'eliminar-costo-directo' && req.method === 'POST') {
      const { admin_id, costo_id } = body;
      if (!admin_id || !costo_id) return err('admin_id y costo_id requeridos', 400);
      const { data: caller } = await supabase
        .from('empleados').select('rol_app').eq('id', admin_id).maybeSingle();
      if (!caller || caller.rol_app !== 'admin')
        return new Response(JSON.stringify({ ok: false, error: 'Solo admin puede eliminar costos directos' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      const { data: existente, error: fetchErr } = await supabase
        .from('costos_directos_proyecto').select('id').eq('id', costo_id).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existente) return err('Costo directo no encontrado', 404);
      const { error } = await supabase
        .from('costos_directos_proyecto').delete().eq('id', costo_id);
      if (error) throw error;
      return ok({ ok: true, eliminado: { id: costo_id } });
    }

    // ── POST login-publico ────────────────────────────────────────────────
    if (action === 'login-publico' && req.method === 'POST') {
      const { password } = body;
      const expected = process.env.DASHBOARD_PUBLIC_PASSWORD || 'maderable2026';
      if (!password || password !== expected)
        return new Response(JSON.stringify({ ok: false, error: 'Contraseña incorrecta' }),
          { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
      return ok({ ok: true });
    }

    // ── GET centros (catálogo activos para operarios/tablets) ────────────────
    if (action === 'centros' && req.method === 'GET') {
      const { data, error } = await supabase
        .from('centros_virtuales')
        .select('id, codigo, nombre, tipo, requiere_mueble, requiere_proyecto, es_descanso, mostrar_dashboard_siempre, orden, activo')
        .eq('activo', true)
        .order('orden', { ascending: true });
      if (error) throw error;
      return ok({ ok: true, centros: data || [] });
    }

    // ── GET centros-todos (admin — incluye inactivos, para Ajustes) ──────────
    if (action === 'centros-todos' && req.method === 'GET') {
      const admin_id = url.searchParams.get('admin_id');
      if (!admin_id) return err('admin_id requerido', 400);
      const { data: caller } = await supabase
        .from('empleados').select('rol_app').eq('id', admin_id).maybeSingle();
      if (!caller || caller.rol_app !== 'admin')
        return new Response(JSON.stringify({ ok: false, error: 'Solo admin puede acceder a este endpoint' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      const { data, error } = await supabase
        .from('centros_virtuales')
        .select('id, codigo, nombre, tipo, requiere_mueble, requiere_proyecto, es_descanso, mostrar_dashboard_siempre, orden, activo')
        .order('orden', { ascending: true });
      if (error) throw error;
      return ok({ ok: true, centros: data || [] });
    }

    // ── POST crear-centro (admin only) ───────────────────────────────────────
    if (action === 'crear-centro' && req.method === 'POST') {
      const { admin_id, codigo, nombre, tipo, requiere_mueble, requiere_proyecto, es_descanso, mostrar_dashboard_siempre, orden } = body;
      if (!admin_id) return err('admin_id requerido', 400);
      const { data: caller } = await supabase
        .from('empleados').select('rol_app').eq('id', admin_id).maybeSingle();
      if (!caller || caller.rol_app !== 'admin')
        return new Response(JSON.stringify({ ok: false, error: 'Solo admin puede crear centros' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      if (!codigo || !nombre) return err('codigo y nombre requeridos', 400);
      if (!tipo || !['planta', 'oficina'].includes(tipo)) return err("tipo debe ser 'planta' u 'oficina'", 400);
      const { data: existing } = await supabase.from('centros_virtuales').select('id').eq('codigo', codigo).maybeSingle();
      if (existing) return err(`El codigo '${codigo}' ya existe`, 409);
      const { data, error } = await supabase.from('centros_virtuales')
        .insert({
          codigo,
          nombre,
          tipo,
          requiere_mueble:           requiere_mueble           ?? false,
          requiere_proyecto:         requiere_proyecto         ?? false,
          es_descanso:               es_descanso               ?? false,
          mostrar_dashboard_siempre: mostrar_dashboard_siempre ?? false,
          orden:                     orden                     ?? 99,
          activo:                    true,
        })
        .select().single();
      if (error) throw error;
      return ok({ ok: true, centro: data });
    }

    // ── POST editar-centro (admin only) ─────────────────────────────────────
    if (action === 'editar-centro' && req.method === 'POST') {
      const { admin_id, id, nombre, tipo, requiere_mueble, requiere_proyecto, es_descanso, mostrar_dashboard_siempre, orden } = body;
      if (!admin_id) return err('admin_id requerido', 400);
      const { data: caller } = await supabase
        .from('empleados').select('rol_app').eq('id', admin_id).maybeSingle();
      if (!caller || caller.rol_app !== 'admin')
        return new Response(JSON.stringify({ ok: false, error: 'Solo admin puede editar centros' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      if (!id) return err('id requerido', 400);
      if (tipo !== undefined && !['planta', 'oficina'].includes(tipo)) return err("tipo debe ser 'planta' u 'oficina'", 400);
      const campos = {
        ...(nombre                     !== undefined ? { nombre }                     : {}),
        ...(tipo                       !== undefined ? { tipo }                       : {}),
        ...(requiere_mueble            !== undefined ? { requiere_mueble }            : {}),
        ...(requiere_proyecto          !== undefined ? { requiere_proyecto }          : {}),
        ...(es_descanso                !== undefined ? { es_descanso }                : {}),
        ...(mostrar_dashboard_siempre  !== undefined ? { mostrar_dashboard_siempre }  : {}),
        ...(orden                      !== undefined ? { orden }                      : {}),
      };
      if (Object.keys(campos).length === 0) return err('Nada que actualizar', 400);
      const { data, error } = await supabase.from('centros_virtuales')
        .update(campos).eq('id', id).select().single();
      if (error) throw error;
      return ok({ ok: true, centro: data });
    }

    // ── POST toggle-centro (admin only) ─────────────────────────────────────
    if (action === 'toggle-centro' && req.method === 'POST') {
      const { admin_id, id, activo } = body;
      if (!admin_id) return err('admin_id requerido', 400);
      const { data: caller } = await supabase
        .from('empleados').select('rol_app').eq('id', admin_id).maybeSingle();
      if (!caller || caller.rol_app !== 'admin')
        return new Response(JSON.stringify({ ok: false, error: 'Solo admin puede activar/desactivar centros' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      if (!id || activo === undefined) return err('id y activo requeridos', 400);
      const { data, error } = await supabase.from('centros_virtuales')
        .update({ activo: !!activo }).eq('id', id).select().single();
      if (error) throw error;
      return ok({ ok: true, centro: data });
    }

    // ── POST asignar-centros (admin only) ────────────────────────────────────
    if (action === 'asignar-centros' && req.method === 'POST') {
      const { admin_id, empleado_id, codigos } = body;
      if (!admin_id) return err('admin_id requerido', 400);
      const { data: caller } = await supabase
        .from('empleados').select('rol_app').eq('id', admin_id).maybeSingle();
      if (!caller || caller.rol_app !== 'admin')
        return new Response(JSON.stringify({ ok: false, error: 'Solo admin puede asignar centros' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      if (!empleado_id) return err('empleado_id requerido', 400);
      if (!Array.isArray(codigos)) return err('codigos debe ser un array', 400);
      if (codigos.length > 0) {
        const { data: validos } = await supabase.from('centros_virtuales')
          .select('codigo').in('codigo', codigos).eq('activo', true);
        const codigosValidos = (validos || []).map(c => c.codigo);
        const invalidos = codigos.filter(c => !codigosValidos.includes(c));
        if (invalidos.length > 0) return err(`Códigos inválidos: ${invalidos.join(', ')}`, 400);
      }
      const { data, error } = await supabase.from('empleados')
        .update({ centros_autorizados: codigos }).eq('id', empleado_id).select('id, nombre, centros_autorizados').single();
      if (error) throw error;
      return ok({ ok: true, empleado: data });
    }

    // ── GET sesiones-dia ──────────────────────────────────────────────────
    if (action === 'sesiones-dia' && req.method === 'GET') {
      const fecha     = url.searchParams.get('fecha');
      const caller_id = url.searchParams.get('caller_id');

      if (!fecha)     return err('fecha requerida (YYYY-MM-DD)', 400);
      if (!caller_id) return err('caller_id requerido', 400);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return err('fecha debe tener formato YYYY-MM-DD', 400);

      const { data: callerSD, error: cSDErr } = await supabase
        .from('empleados').select('rol_app, acceso_tiempos').eq('id', caller_id).maybeSingle();
      if (cSDErr) throw cSDErr;
      if (!callerSD)
        return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      if (callerSD.rol_app !== 'admin' && callerSD.rol_app !== 'oficina')
        return new Response(JSON.stringify({ ok: false, error: 'Sin acceso' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });

      let jornadasQSD = supabase
        .from('jornadas')
        .select('id, empleado_id, fecha, entrada, salida, descanso_minutos')
        .eq('fecha', fecha);
      if (callerSD.rol_app !== 'admin' && !callerSD.acceso_tiempos) jornadasQSD = jornadasQSD.eq('empleado_id', caller_id);
      const { data: jornadasSD, error: jSDErr } = await jornadasQSD;
      if (jSDErr) throw jSDErr;

      if (!jornadasSD || jornadasSD.length === 0)
        return ok({ ok: true, fecha, empleados: [] });

      const jornadaIdsSD  = jornadasSD.map(j => j.id);
      const empleadoIdsSD = [...new Set(jornadasSD.map(j => j.empleado_id))];

      const [{ data: registrosSD, error: rSDErr }, { data: empleadosSD, error: eSDErr }] = await Promise.all([
        supabase.from('registros_trabajo')
          .select('id, jornada_id, inicio, fin, centro, proyecto_id, proyecto_nombre, item_id, item_nombre, estado')
          .in('jornada_id', jornadaIdsSD)
          .eq('eliminada', false)
          .order('inicio', { ascending: true }),
        supabase.from('empleados')
          .select('id, nombre, descanso_modalidad')
          .in('id', empleadoIdsSD),
      ]);
      if (rSDErr) throw rSDErr;
      if (eSDErr) throw eSDErr;

      const ahoraSD   = new Date();
      const regsMapSD = {};
      (registrosSD || []).forEach(r => {
        if (!regsMapSD[r.jornada_id]) regsMapSD[r.jornada_id] = [];
        regsMapSD[r.jornada_id].push(r);
      });
      const empMapSD = {};
      (empleadosSD || []).forEach(e => { empMapSD[e.id] = e; });

      return ok({
        ok: true, fecha,
        empleados: jornadasSD.map(j => {
          const sesiones = regsMapSD[j.id] || [];
          const totalMs  = sesiones.reduce((acc, r) => {
            const ini = new Date(r.inicio);
            const fin = r.fin ? new Date(r.fin) : (r.estado === 'activo' ? ahoraSD : ini);
            return acc + Math.max(0, fin - ini);
          }, 0);
          return {
            empleado_id:        j.empleado_id,
            nombre:             empMapSD[j.empleado_id]?.nombre || '',
            descanso_modalidad: empMapSD[j.empleado_id]?.descanso_modalidad || null,
            jornada:            { id: j.id, entrada: j.entrada, salida: j.salida, descanso_minutos: j.descanso_minutos },
            sesiones,
            total_minutos: Math.round(totalMs / 60000),
          };
        }),
      });
    }

    // ── GET sesiones-empleado ─────────────────────────────────────────────
    if (action === 'sesiones-empleado' && req.method === 'GET') {
      const empleado_id = url.searchParams.get('empleado_id');
      const desde       = url.searchParams.get('desde');
      const hasta       = url.searchParams.get('hasta');
      const caller_id   = url.searchParams.get('caller_id');

      if (!empleado_id) return err('empleado_id requerido', 400);
      if (!caller_id)   return err('caller_id requerido', 400);

      const { data: callerSE, error: cSEErr } = await supabase
        .from('empleados').select('id, nombre, rol_app, acceso_tiempos, descanso_modalidad').eq('id', caller_id).maybeSingle();
      if (cSEErr) throw cSEErr;
      if (!callerSE)
        return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      if (callerSE.rol_app !== 'admin' && callerSE.rol_app !== 'oficina')
        return new Response(JSON.stringify({ ok: false, error: 'Sin acceso' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      if (callerSE.rol_app !== 'admin' && !callerSE.acceso_tiempos && empleado_id !== caller_id)
        return new Response(JSON.stringify({ ok: false, error: 'Sin acceso a tiempos de otros empleados' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });

      let empNombreSE = callerSE.nombre;
      let empDescansoModalidadSE = callerSE.descanso_modalidad || null;
      if (empleado_id !== caller_id) {
        const { data: empTargetSE } = await supabase.from('empleados')
          .select('nombre, descanso_modalidad').eq('id', empleado_id).maybeSingle();
        empNombreSE = empTargetSE?.nombre || '';
        empDescansoModalidadSE = empTargetSE?.descanso_modalidad || null;
      }

      let jornadasQSE = supabase
        .from('jornadas')
        .select('id, empleado_id, fecha, entrada, salida, descanso_minutos')
        .eq('empleado_id', empleado_id)
        .order('fecha', { ascending: true });
      if (desde) jornadasQSE = jornadasQSE.gte('fecha', desde);
      if (hasta) jornadasQSE = jornadasQSE.lte('fecha', hasta);
      const { data: jornadasSE, error: jSEErr } = await jornadasQSE;
      if (jSEErr) throw jSEErr;

      if (!jornadasSE || jornadasSE.length === 0)
        return ok({ ok: true, empleado_id, nombre: empNombreSE, dias: [] });

      const jornadaIdsSE = jornadasSE.map(j => j.id);
      const { data: registrosSE, error: rSEErr } = await supabase
        .from('registros_trabajo')
        .select('id, jornada_id, inicio, fin, centro, proyecto_id, proyecto_nombre, item_id, item_nombre, estado')
        .in('jornada_id', jornadaIdsSE)
        .eq('eliminada', false)
        .order('inicio', { ascending: true });
      if (rSEErr) throw rSEErr;

      const ahoraSE   = new Date();
      const regsMapSE = {};
      (registrosSE || []).forEach(r => {
        if (!regsMapSE[r.jornada_id]) regsMapSE[r.jornada_id] = [];
        regsMapSE[r.jornada_id].push(r);
      });

      return ok({
        ok: true, empleado_id, nombre: empNombreSE, descanso_modalidad: empDescansoModalidadSE,
        dias: jornadasSE.map(j => {
          const sesiones = regsMapSE[j.id] || [];
          const totalMs  = sesiones.reduce((acc, r) => {
            const ini = new Date(r.inicio);
            const fin = r.fin ? new Date(r.fin) : (r.estado === 'activo' ? ahoraSE : ini);
            return acc + Math.max(0, fin - ini);
          }, 0);
          return {
            fecha:         j.fecha,
            jornada:       { id: j.id, entrada: j.entrada, salida: j.salida, descanso_minutos: j.descanso_minutos },
            sesiones,
            total_minutos: Math.round(totalMs / 60000),
          };
        }),
      });
    }

    // ── GET reporte-horas ─────────────────────────────────────────────────
    if (action === 'reporte-horas' && req.method === 'GET') {
      const desde     = url.searchParams.get('desde');
      const hasta     = url.searchParams.get('hasta');
      const emp_param = url.searchParams.get('empleado_id');
      const caller_id = url.searchParams.get('caller_id');

      if (!desde || !hasta) return err('desde y hasta requeridos (YYYY-MM-DD)', 400);
      if (!caller_id)       return err('caller_id requerido', 400);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta))
        return err('desde y hasta deben tener formato YYYY-MM-DD', 400);
      if (desde > hasta) return err('desde debe ser anterior o igual a hasta', 400);

      const { data: callerRH, error: cRHErr } = await supabase
        .from('empleados').select('id, nombre, rol_app, acceso_tiempos').eq('id', caller_id).maybeSingle();
      if (cRHErr) throw cRHErr;
      if (!callerRH)
        return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      if (callerRH.rol_app !== 'admin' && callerRH.rol_app !== 'oficina')
        return new Response(JSON.stringify({ ok: false, error: 'Sin acceso' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      if (callerRH.rol_app !== 'admin' && !callerRH.acceso_tiempos && emp_param && emp_param !== caller_id)
        return new Response(JSON.stringify({ ok: false, error: 'Sin acceso a tiempos de otros empleados' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });

      // Oficina sin acceso_tiempos: forzar a ver solo lo propio
      const efectivo_emp = (callerRH.rol_app !== 'admin' && !callerRH.acceso_tiempos) ? caller_id : emp_param;

      let empleadosRH = [];
      if ((callerRH.rol_app === 'admin' || callerRH.acceso_tiempos) && !efectivo_emp) {
        const { data: todosRH, error: tRHErr } = await supabase
          .from('empleados').select('id, nombre').eq('activo', true);
        if (tRHErr) throw tRHErr;
        empleadosRH = todosRH || [];
      } else {
        const targetIdRH = efectivo_emp || caller_id;
        const { data: oneRH, error: oRHErr } = await supabase
          .from('empleados').select('id, nombre').eq('id', targetIdRH).maybeSingle();
        if (oRHErr) throw oRHErr;
        if (oneRH) empleadosRH = [oneRH];
      }

      if (empleadosRH.length === 0)
        return ok({ ok: true, desde, hasta, empleados: [] });

      const empleadoIdsRH = empleadosRH.map(e => e.id);
      const { data: registrosRH, error: rRHErr } = await supabase
        .from('registros_trabajo')
        .select('id, empleado_id, inicio, fin')
        .in('empleado_id', empleadoIdsRH)
        .eq('estado', 'finalizado')
        .eq('eliminada', false)
        .gte('inicio', desde + 'T00:00:00.000Z')
        .lte('inicio', hasta + 'T23:59:59.999Z')
        .order('inicio', { ascending: true });
      if (rRHErr) throw rRHErr;

      function _rhIsoMonday(ts) {
        const d = new Date(ts);
        const day = d.getUTCDay(); // 0=Dom, 1=Lun, ..., 6=Sáb
        const offset = day === 0 ? 6 : day - 1;
        d.setUTCDate(d.getUTCDate() - offset);
        return d.toISOString().split('T')[0];
      }
      function _rhIsoSunday(mondayStr) {
        const d = new Date(mondayStr + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + 6);
        return d.toISOString().split('T')[0];
      }

      const regsPorEmpRH = {};
      (registrosRH || []).forEach(r => {
        if (!regsPorEmpRH[r.empleado_id]) regsPorEmpRH[r.empleado_id] = [];
        regsPorEmpRH[r.empleado_id].push(r);
      });

      return ok({
        ok: true, desde, hasta,
        empleados: empleadosRH.map(emp => {
          const regs = regsPorEmpRH[emp.id] || [];
          const semanasMap = {};
          regs.forEach(r => {
            if (!r.fin) return;
            const monday = _rhIsoMonday(r.inicio);
            if (!semanasMap[monday]) semanasMap[monday] = 0;
            semanasMap[monday] += Math.max(0, Math.round((new Date(r.fin) - new Date(r.inicio)) / 60000));
          });
          const semanas = Object.keys(semanasMap).sort().map(monday => ({
            semana_inicio:  monday,
            semana_fin:     _rhIsoSunday(monday),
            total_minutos:  semanasMap[monday],
            extras_minutos: Math.max(0, semanasMap[monday] - 2700),
          }));
          const total_minutos        = semanas.reduce((acc, s) => acc + s.total_minutos, 0);
          const total_extras_minutos = semanas.reduce((acc, s) => acc + s.extras_minutos, 0);
          return { empleado_id: emp.id, nombre: emp.nombre, semanas, total_minutos, total_extras_minutos };
        }),
      });
    }

    return err('Acción no reconocida: ' + action);

  } catch (e) {
    if (e instanceof ApiError) return err(e.message, e.status);
    return err(e.message, 500);
  }
}
