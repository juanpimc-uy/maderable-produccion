// api/baru-reabrir.js — POST reabrir partida completada (volver a en proceso)
import { createClient } from '@supabase/supabase-js';
import { verificarToken, ok, err, options } from './_baru-auth-helper.js';
export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xhfeurinovvsbgobkidy.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

export default async function handler(req) {
  if (req.method === 'OPTIONS') return options();
  if (req.method !== 'POST') return err('Method not allowed', 405);

  const valid = await verificarToken(req.headers.get('authorization'));
  if (!valid) return err('Token inválido o expirado', 401);

  try {
    const { id } = await req.json();
    if (!id) return err('id requerido', 400);

    const { error } = await supabase
      .from('partidas_terceros')
      .update({ baru_completado_at: null })
      .eq('id', id)
      .eq('proveedor_nombre', 'BARU');

    if (error) throw error;
    return ok({ ok: true });
  } catch (e) {
    return err(e.message, 500);
  }
}
