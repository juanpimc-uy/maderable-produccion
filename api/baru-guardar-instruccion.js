// api/baru-guardar-instruccion.js — POST guardar instrucción de lustre (auth Maderable)
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
    const { id, instruccion_lustre } = await req.json();
    if (!id) return err('id requerido', 400);

    const { error } = await supabase
      .from('partidas_terceros')
      .update({ instruccion_lustre: instruccion_lustre || null })
      .eq('id', id);

    if (error) throw error;
    return ok({ ok: true });
  } catch (e) {
    return err(e.message, 500);
  }
}
