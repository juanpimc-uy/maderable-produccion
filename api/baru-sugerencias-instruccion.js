// api/baru-sugerencias-instruccion.js — GET sugerencias de instrucción (auth Maderable)
import { createClient } from '@supabase/supabase-js';
import { ok, err, options, CORS } from './_baru-auth-helper.js';
export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xhfeurinovvsbgobkidy.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

export default async function handler(req) {
  if (req.method === 'OPTIONS') return options();
  if (req.method !== 'GET') return err('Method not allowed', 405);

  const url = new URL(req.url);
  const proyectoNum = url.searchParams.get('proyecto_num');
  if (!proyectoNum) return err('proyecto_num requerido', 400);

  try {
    const { data, error } = await supabase
      .from('partidas_terceros')
      .select('instruccion_lustre')
      .eq('proyecto_num', proyectoNum)
      .eq('proveedor_nombre', 'BARU')
      .not('instruccion_lustre', 'is', null)
      .neq('instruccion_lustre', '');

    if (error) throw error;

    const unique = [...new Set((data || []).map(r => r.instruccion_lustre))].sort();
    return ok({ ok: true, sugerencias: unique });
  } catch (e) {
    return err(e.message, 500);
  }
}
