// api/baru-guardar-items.js — POST guardar items como borrador (sin completar)
import { createClient } from '@supabase/supabase-js';
import { verificarToken, ok, err, options } from './_baru-auth-helper.js';
export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xhfeurinovvsbgobkidy.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

const TIPOS_VALIDOS = [
  'LUSTRE 5%', 'LUSTRE EMP.', 'LACA BLANCO', 'LACA COLOR >3m2',
  'LACA BLANCO RUTEADO', 'LACA COLOR RUTEADO', 'LITRO DE PINTURA COLOR',
  'ROBLE PORO ABIERTO BLANCO', 'ROBLE PORO ABIERTO COLOR',
  'OTRAS PATINAS', 'LACA METALIZADA BR 20',
  'LACA MET. BR 100 S/PULIR', 'LACA MET. BR 100 PULIDO',
];

export default async function handler(req) {
  if (req.method === 'OPTIONS') return options();
  if (req.method !== 'POST') return err('Method not allowed', 405);

  const valid = await verificarToken(req.headers.get('authorization'));
  if (!valid) return err('Token inválido o expirado', 401);

  try {
    const { id, items } = await req.json();
    if (!id) return err('id requerido', 400);
    if (!Array.isArray(items)) return err('items debe ser un array', 400);

    // Validar items que tengan datos (permitir items parcialmente vacíos en borrador)
    for (const item of items) {
      if (item.tipo_lustre && !TIPOS_VALIDOS.includes(item.tipo_lustre)) {
        return err(`Tipo de lustre no válido: ${item.tipo_lustre}`, 400);
      }
    }

    const { error } = await supabase
      .from('partidas_terceros')
      .update({ baru_items: items })
      .eq('id', id)
      .eq('proveedor_nombre', 'BARU');

    if (error) throw error;
    return ok({ ok: true });
  } catch (e) {
    return err(e.message, 500);
  }
}
