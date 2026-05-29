// api/baru-completar.js — POST marcar partida como completada por BARU (protegido)
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
    const { id, items } = await req.json();
    if (!id) return err('id requerido', 400);
    if (!Array.isArray(items) || items.length === 0) return err('items debe ser un array no vacío', 400);

    // Cargar tipos válidos desde DB (3 precios por superficie)
    const { data: tiposDB } = await supabase
      .from('lustre_tipos').select('nombre, precio_exterior, precio_interior_visto, precio_interior_no_visto').eq('activo', true);
    const precioMap = {};
    (tiposDB || []).forEach(t => {
      precioMap[t.nombre] = {
        exterior: t.precio_exterior || 0,
        interior_visto: t.precio_interior_visto ?? null,
        interior_no_visto: t.precio_interior_no_visto ?? null,
      };
    });
    const nombresValidos = new Set(Object.keys(precioMap));
    const superficiesValidas = new Set(['exterior', 'interior_visto', 'interior_no_visto']);

    for (const item of items) {
      if (!item.tipo_lustre || typeof item.tipo_lustre !== 'string' || !item.tipo_lustre.trim()) {
        return err('Cada item debe tener tipo_lustre', 400);
      }
      if (!nombresValidos.has(item.tipo_lustre)) {
        return err(`Tipo de lustre no válido: ${item.tipo_lustre}`, 400);
      }
      if (item.superficie && !superficiesValidas.has(item.superficie)) {
        return err(`Superficie no válida: ${item.superficie}`, 400);
      }
      if (typeof item.metros_cuadrados !== 'number' || item.metros_cuadrados <= 0) {
        return err('Cada item debe tener metros_cuadrados > 0', 400);
      }
    }

    // Enriquecer items con precio snapshot y calcular total
    let total_usd = 0;
    const enrichedItems = items.map(it => {
      const precioTipo = precioMap[it.tipo_lustre] || {};
      const superficie = it.superficie || 'exterior';
      const precio = precioTipo[superficie] ?? precioTipo['exterior'] ?? 0;
      const subtotal = Math.round(it.metros_cuadrados * precio * 100) / 100;
      total_usd += subtotal;
      return { tipo_lustre: it.tipo_lustre, metros_cuadrados: it.metros_cuadrados, superficie, precio_usd_m2: precio, subtotal };
    });
    total_usd = Math.round(total_usd * 100) / 100;

    const { error } = await supabase
      .from('partidas_terceros')
      .update({
        baru_items: enrichedItems,
        baru_completado_at: new Date().toISOString(),
        monto_usd: total_usd,
      })
      .eq('id', id)
      .eq('proveedor_nombre', 'BARU');

    if (error) throw error;
    return ok({ ok: true, total_usd });
  } catch (e) {
    return err(e.message, 500);
  }
}
