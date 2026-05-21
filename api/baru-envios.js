// api/baru-envios.js — GET lista de envíos BARU (protegido)
import { createClient } from '@supabase/supabase-js';
import { verificarToken, ok, err, options } from './_baru-auth-helper.js';
export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xhfeurinovvsbgobkidy.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

export default async function handler(req) {
  if (req.method === 'OPTIONS') return options();
  if (req.method !== 'GET') return err('Method not allowed', 405);

  const valid = await verificarToken(req.headers.get('authorization'));
  if (!valid) return err('Token inválido o expirado', 401);

  const url = new URL(req.url);
  const estado = url.searchParams.get('estado'); // por_recibir | en_proceso | completados

  try {
    let query = supabase
      .from('partidas_terceros')
      .select('*')
      .eq('proveedor_nombre', 'BARU')
      .eq('archivada', false)
      .order('creado_at', { ascending: false });

    if (estado === 'por_recibir') {
      query = query
        .eq('estado', 'despachada')
        .is('fecha_recepcion_proveedor', null)
        .is('baru_completado_at', null);
    } else if (estado === 'en_proceso') {
      query = query
        .eq('estado', 'despachada')
        .not('fecha_recepcion_proveedor', 'is', null)
        .is('baru_completado_at', null);
    } else if (estado === 'completados') {
      query = query.not('baru_completado_at', 'is', null);
    }

    const { data, error } = await query;
    if (error) throw error;

    return ok({ ok: true, partidas: data || [] });
  } catch (e) {
    return err(e.message, 500);
  }
}
