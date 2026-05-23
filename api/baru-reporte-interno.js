// api/baru-reporte-interno.js — GET reporte BARU con auth Maderable (no requiere token BARU)
import { createClient } from '@supabase/supabase-js';
import { ok, err, options, CORS } from './_baru-auth-helper.js';
export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xhfeurinovvsbgobkidy.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

function getWeekRange(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(d); monday.setDate(d.getDate() + diffToMon);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  return { desde: monday.toISOString().split('T')[0], hasta: sunday.toISOString().split('T')[0] };
}

function getMonthRange(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { desde: first.toISOString().split('T')[0], hasta: last.toISOString().split('T')[0] };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return options();
  if (req.method !== 'GET') return err('Method not allowed', 405);

  const url = new URL(req.url);
  const callerId = url.searchParams.get('caller_id');
  if (!callerId) return err('caller_id requerido', 401);

  // Verificar auth Maderable (admin u oficina)
  const { data: caller } = await supabase
    .from('empleados').select('rol_app').eq('id', callerId).maybeSingle();
  if (!caller || (caller.rol_app !== 'admin' && caller.rol_app !== 'oficina'))
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }),
      { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const periodo = url.searchParams.get('periodo') || 'semana';
  const fecha = url.searchParams.get('fecha') || new Date().toISOString().split('T')[0];
  const rango = periodo === 'mes' ? getMonthRange(fecha) : getWeekRange(fecha);

  try {
    const desde = rango.desde + 'T00:00:00';
    const hasta = rango.hasta + 'T23:59:59';
    const { data, error } = await supabase
      .from('partidas_terceros')
      .select('id, numero_envio, proyecto_num, obra, cliente, mueble_nombre, mueble_codigo, baru_items, fecha_despacho, fecha_recepcion_proveedor, baru_completado_at, fecha_recepcion, estado_recep, instruccion_lustre, monto_usd, proveedor_nombre')
      .eq('proveedor_nombre', 'BARU')
      .or(`and(baru_completado_at.gte.${desde},baru_completado_at.lte.${hasta}),and(estado.eq.recibida,fecha_recepcion.gte.${desde},fecha_recepcion.lte.${hasta})`)
      .order('baru_completado_at', { ascending: true, nullsFirst: false });

    if (error) throw error;
    return ok({ ok: true, partidas: data || [], rango });
  } catch (e) {
    return err(e.message, 500);
  }
}
