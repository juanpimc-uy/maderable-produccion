// api/baru-confirmar-recepcion.js — POST confirmación pública (página QR)
import { createClient } from '@supabase/supabase-js';
import { ok, err, options } from './_baru-auth-helper.js';
export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xhfeurinovvsbgobkidy.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

export default async function handler(req) {
  if (req.method === 'OPTIONS') return options();
  if (req.method !== 'POST') return err('Method not allowed', 405);

  try {
    const { id, fecha } = await req.json();
    if (!id) return err('id requerido', 400);

    const fechaRecepcion = fecha
      ? new Date(fecha + 'T12:00:00').toISOString()
      : new Date().toISOString();

    // Primero obtener estado actual
    const { data: partida } = await supabase
      .from('partidas_terceros')
      .select('estado')
      .eq('id', id)
      .maybeSingle();

    const updateFields = { fecha_recepcion_proveedor: fechaRecepcion };
    // Auto-despacho: si estaba en_taller, pasar a en_proveedor
    if (partida?.estado === 'en_taller') updateFields.estado = 'en_proveedor';

    const { error } = await supabase
      .from('partidas_terceros')
      .update(updateFields)
      .eq('id', id)
      .is('fecha_recepcion_proveedor', null);

    if (error) throw error;
    return ok({ ok: true });
  } catch (e) {
    return err(e.message, 500);
  }
}
