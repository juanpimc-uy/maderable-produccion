// api/baru-partida.js — GET partida pública (para página QR)
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

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return err('id requerido', 400);

  try {
    const { data, error } = await supabase
      .from('partidas_terceros')
      .select('id, numero_envio, mueble_nombre, mueble_codigo, obra, cliente, bultos, fecha_despacho, fecha_retorno_estimada, instruccion_lustre, fecha_recepcion_proveedor, estado, proveedor_nombre')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return err('Partida no encontrada', 404);

    return ok({ ok: true, partida: data });
  } catch (e) {
    return err(e.message, 500);
  }
}
