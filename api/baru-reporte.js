// api/baru-reporte.js — GET reporte de partidas completadas BARU (protegido)
import { createClient } from '@supabase/supabase-js';
import { verificarToken, ok, err, options } from './_baru-auth-helper.js';
export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xhfeurinovvsbgobkidy.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

function getWeekRange(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay(); // 0=dom
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMon);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    desde: monday.toISOString().split('T')[0],
    hasta: sunday.toISOString().split('T')[0],
  };
}

function getMonthRange(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const y = d.getFullYear(), m = d.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  return {
    desde: first.toISOString().split('T')[0],
    hasta: last.toISOString().split('T')[0],
  };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return options();
  if (req.method !== 'GET') return err('Method not allowed', 405);

  const valid = await verificarToken(req.headers.get('authorization'));
  if (!valid) return err('Token inválido o expirado', 401);

  const url = new URL(req.url);
  const periodo = url.searchParams.get('periodo') || 'semana';
  const fecha = url.searchParams.get('fecha') || new Date().toISOString().split('T')[0];

  const rango = periodo === 'mes' ? getMonthRange(fecha) : getWeekRange(fecha);

  try {
    const desde = rango.desde + 'T00:00:00';
    const hasta = rango.hasta + 'T23:59:59';
    const { data, error } = await supabase
      .from('partidas_terceros')
      .select('numero_envio, proyecto_num, obra, cliente, mueble_nombre, baru_items, fecha_despacho, fecha_recepcion_proveedor, baru_completado_at, fecha_recepcion, estado_recep')
      .eq('proveedor_nombre', 'BARU')
      .or(`and(baru_completado_at.gte.${desde},baru_completado_at.lte.${hasta}),and(estado.eq.recibida,fecha_recepcion.gte.${desde},fecha_recepcion.lte.${hasta})`)
      .order('baru_completado_at', { ascending: true, nullsFirst: false });

    if (error) throw error;

    return ok({ ok: true, partidas: data || [], rango });
  } catch (e) {
    return err(e.message, 500);
  }
}
