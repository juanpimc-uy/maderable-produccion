// api/maquinas.js — Catálogo de máquinas y sus partes (Edge runtime)
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

    // ── GET listar (admin/oficina) ───────────────────────────────────────
    if (action === 'listar' && req.method === 'GET') {
      const caller = await verificarSesion(url.searchParams.get('session_token'));
      if (!caller || !['admin', 'oficina'].includes(caller.rol_app))
        return err('Acceso denegado', 401);

      let query = supabase.from('maquinas').select('*').order('orden').order('codigo');
      if (url.searchParams.get('incluir_inactivas') !== '1') query = query.eq('activo', true);
      const { data, error } = await query;
      if (error) return err(error.message, 500);
      return ok({ ok: true, maquinas: data || [] });
    }

    // ── POST crear (admin/oficina) ───────────────────────────────────────
    if (action === 'crear' && req.method === 'POST') {
      const caller = await verificarSesion(body.session_token);
      if (!caller || !['admin', 'oficina'].includes(caller.rol_app))
        return err('Acceso denegado', 401);

      const codigo = (body.codigo || '').trim().toUpperCase().replace(/\s+/g, '');
      if (!codigo) return err('codigo requerido');
      const nombre = (body.nombre || '').trim();
      if (!nombre) return err('nombre requerido');

      const fila = { codigo, nombre };
      if (body.centro_codigo !== undefined) fila.centro_codigo = body.centro_codigo;
      if (body.marca !== undefined) fila.marca = body.marca;
      if (body.modelo !== undefined) fila.modelo = body.modelo;
      if (body.nro_serie !== undefined) fila.nro_serie = body.nro_serie;
      if (body.notas !== undefined) fila.notas = body.notas;
      if (body.orden !== undefined) fila.orden = body.orden;

      const { data, error } = await supabase.from('maquinas').insert(fila).select().single();
      if (error) {
        if (error.code === '23505') return err('El código "' + codigo + '" ya existe', 409);
        return err(error.message, 500);
      }
      return ok({ ok: true, maquina: data });
    }

    // ── POST editar (admin/oficina) ──────────────────────────────────────
    if (action === 'editar' && req.method === 'POST') {
      const caller = await verificarSesion(body.session_token);
      if (!caller || !['admin', 'oficina'].includes(caller.rol_app))
        return err('Acceso denegado', 401);

      const id = body.id;
      if (!id) return err('id requerido');
      if (body.codigo !== undefined) return err('El código no se puede editar: está impreso en el sticker de la máquina');

      const campos = {};
      if (body.nombre !== undefined) campos.nombre = body.nombre;
      if (body.centro_codigo !== undefined) campos.centro_codigo = body.centro_codigo;
      if (body.marca !== undefined) campos.marca = body.marca;
      if (body.modelo !== undefined) campos.modelo = body.modelo;
      if (body.nro_serie !== undefined) campos.nro_serie = body.nro_serie;
      if (body.notas !== undefined) campos.notas = body.notas;
      if (body.activo !== undefined) campos.activo = body.activo;
      if (body.orden !== undefined) campos.orden = body.orden;

      if (Object.keys(campos).length === 0) return err('Nada que actualizar');

      const { data, error } = await supabase.from('maquinas').update(campos).eq('id', id).select().single();
      if (error) return err(error.message, 500);
      if (!data) return err('Máquina no encontrada', 404);
      return ok({ ok: true, maquina: data });
    }

    // ── GET listar-partes (admin/oficina) ────────────────────────────────
    if (action === 'listar-partes' && req.method === 'GET') {
      const caller = await verificarSesion(url.searchParams.get('session_token'));
      if (!caller || !['admin', 'oficina'].includes(caller.rol_app))
        return err('Acceso denegado', 401);

      const maquina_id = url.searchParams.get('maquina_id');
      if (!maquina_id) return err('maquina_id requerido');

      const { data, error } = await supabase.from('maquina_partes')
        .select('*')
        .eq('maquina_id', maquina_id)
        .eq('activo', true)
        .order('orden')
        .order('nombre');
      if (error) return err(error.message, 500);
      return ok({ ok: true, partes: data || [] });
    }

    // ── POST crear-parte (admin/oficina) ─────────────────────────────────
    if (action === 'crear-parte' && req.method === 'POST') {
      const caller = await verificarSesion(body.session_token);
      if (!caller || !['admin', 'oficina'].includes(caller.rol_app))
        return err('Acceso denegado', 401);

      const { maquina_id, nombre } = body;
      if (!maquina_id) return err('maquina_id requerido');
      if (!(nombre || '').trim()) return err('nombre requerido');

      // Código correlativo MP-000001, con reintento ante colisión.
      for (let intento = 0; intento < 3; intento++) {
        const { data: ultimos } = await supabase.from('maquina_partes')
          .select('codigo').order('codigo', { ascending: false }).limit(1);
        const ultimoNum = (ultimos && ultimos.length)
          ? parseInt(String(ultimos[0].codigo).replace(/\D/g, ''), 10) || 0
          : 0;
        const codigo = 'MP-' + String(ultimoNum + 1 + intento).padStart(6, '0');

        const fila = { codigo, maquina_id, nombre: nombre.trim() };
        if (body.codigo_fabricante !== undefined) fila.codigo_fabricante = body.codigo_fabricante;
        if (body.marca !== undefined) fila.marca = body.marca;
        if (body.modelo !== undefined) fila.modelo = body.modelo;
        if (body.notas !== undefined) fila.notas = body.notas;
        if (body.orden !== undefined) fila.orden = body.orden;

        const { data, error: insErr } = await supabase.from('maquina_partes')
          .insert(fila).select().single();
        if (!insErr) return ok({ ok: true, parte: data });
        if (insErr.code !== '23505') return err(insErr.message, 500);
      }
      return err('No se pudo generar un código libre, reintentá', 500);
    }

    // ── POST editar-parte (admin/oficina) ────────────────────────────────
    if (action === 'editar-parte' && req.method === 'POST') {
      const caller = await verificarSesion(body.session_token);
      if (!caller || !['admin', 'oficina'].includes(caller.rol_app))
        return err('Acceso denegado', 401);

      const id = body.id;
      if (!id) return err('id requerido');
      if (body.codigo !== undefined) return err('El código no se puede editar: está impreso en el sticker de la parte');

      const campos = {};
      if (body.nombre !== undefined) campos.nombre = body.nombre;
      if (body.codigo_fabricante !== undefined) campos.codigo_fabricante = body.codigo_fabricante;
      if (body.marca !== undefined) campos.marca = body.marca;
      if (body.modelo !== undefined) campos.modelo = body.modelo;
      if (body.notas !== undefined) campos.notas = body.notas;
      if (body.activo !== undefined) campos.activo = body.activo;
      if (body.orden !== undefined) campos.orden = body.orden;

      if (Object.keys(campos).length === 0) return err('Nada que actualizar');

      const { data, error } = await supabase.from('maquina_partes').update(campos).eq('id', id).select().single();
      if (error) return err(error.message, 500);
      if (!data) return err('Parte no encontrada', 404);
      return ok({ ok: true, parte: data });
    }

    return err('action no reconocida', 404);

  } catch (e) {
    console.error('[maquinas]', e);
    return err(e.message || 'Error interno', 500);
  }
}
