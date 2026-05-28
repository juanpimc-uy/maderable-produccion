// api/lustre-tipos.js — GET tipos de lustre activos (público)
import { createClient } from '@supabase/supabase-js';
import { ok, err, options } from './_baru-auth-helper.js';
export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xhfeurinovvsbgobkidy.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

export default async function handler(req) {
  if (req.method === 'OPTIONS') return options();
  if (req.method !== 'GET') return err('Method not allowed', 405);

  try {
    const { data, error } = await supabase
      .from('lustre_tipos')
      .select('id, nombre, categoria, precio_exterior, precio_interior_visto, precio_interior_no_visto')
      .eq('activo', true)
      .order('orden');

    if (error) throw error;
    return ok({ ok: true, tipos: data || [] });
  } catch (e) {
    return err(e.message, 500);
  }
}
