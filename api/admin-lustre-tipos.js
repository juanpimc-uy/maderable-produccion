// api/admin-lustre-tipos.js — POST CRUD tipos de lustre (auth Maderable admin)
import { createClient } from '@supabase/supabase-js';
import { ok, err, options, CORS } from './_baru-auth-helper.js';
export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xhfeurinovvsbgobkidy.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

async function checkAdmin(adminId) {
  if (!adminId) return false;
  const { data } = await supabase
    .from('empleados').select('rol_app').eq('id', adminId).maybeSingle();
  return data?.rol_app === 'admin';
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return options();
  if (req.method !== 'POST') return err('Method not allowed', 405);

  try {
    const body = await req.json();
    const { action, admin_id } = body;

    if (!await checkAdmin(admin_id)) {
      return new Response(JSON.stringify({ ok: false, error: 'Solo admin' }),
        { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    if (action === 'update') {
      const { id, nombre, categoria, precio_exterior, precio_interior_visto, precio_interior_no_visto, activo } = body;
      if (!id) return err('id requerido', 400);
      const campos = {};
      if (nombre !== undefined) campos.nombre = nombre;
      if (categoria !== undefined) campos.categoria = categoria;
      if (precio_exterior !== undefined) campos.precio_exterior = Number(precio_exterior);
      if (precio_interior_visto !== undefined) campos.precio_interior_visto = precio_interior_visto === null ? null : Number(precio_interior_visto);
      if (precio_interior_no_visto !== undefined) campos.precio_interior_no_visto = precio_interior_no_visto === null ? null : Number(precio_interior_no_visto);
      if (activo !== undefined) campos.activo = activo;
      const { error } = await supabase.from('lustre_tipos').update(campos).eq('id', id);
      if (error) throw error;
      return ok({ ok: true });
    }

    if (action === 'create') {
      const { nombre, categoria, precio_exterior, precio_interior_visto, precio_interior_no_visto } = body;
      if (!nombre) return err('nombre requerido', 400);
      // orden = max + 1
      const { data: maxRow } = await supabase
        .from('lustre_tipos').select('orden').order('orden', { ascending: false }).limit(1).maybeSingle();
      const orden = (maxRow?.orden || 0) + 1;
      const { error } = await supabase.from('lustre_tipos').insert({
        nombre,
        categoria: categoria || 'LUSTRE',
        precio_exterior: Number(precio_exterior) || 0,
        precio_interior_visto: precio_interior_visto != null ? Number(precio_interior_visto) : null,
        precio_interior_no_visto: precio_interior_no_visto != null ? Number(precio_interior_no_visto) : null,
        activo: true,
        orden,
      });
      if (error) throw error;
      return ok({ ok: true });
    }

    if (action === 'delete') {
      const { id } = body;
      if (!id) return err('id requerido', 400);
      // Verificar que no tiene partidas asociadas
      const { data: tipo } = await supabase.from('lustre_tipos').select('nombre').eq('id', id).maybeSingle();
      if (!tipo) return err('Tipo no encontrado', 404);
      const { data: partidas } = await supabase
        .from('partidas_terceros')
        .select('id')
        .contains('baru_items', [{ tipo_lustre: tipo.nombre }])
        .limit(1);
      if (partidas && partidas.length > 0) {
        return err('No se puede eliminar: hay partidas con este tipo de lustre', 400);
      }
      const { error } = await supabase.from('lustre_tipos').delete().eq('id', id);
      if (error) throw error;
      return ok({ ok: true });
    }

    return err('action no reconocida', 400);
  } catch (e) {
    return err(e.message, 500);
  }
}
