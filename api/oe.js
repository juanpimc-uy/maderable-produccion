// api/oe.js — Gestión del OE mensual (fuente única de verdad: tabla oe_mensual)
// Edge runtime, session-based (browser).
import { createClient } from '@supabase/supabase-js';
export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xhfeurinovvsbgobkidy.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function ok(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
function err(msg, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function verificarSesion(token) {
  if (!token) return null;
  const { data } = await supabase
    .from('empleados')
    .select('id, rol_app, nombre')
    .eq('session_token', token)
    .gt('session_expires_at', new Date().toISOString())
    .eq('activo', true)
    .maybeSingle();
  return data || null;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS });

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  let body = {};
  if (req.method === 'POST') {
    try { body = await req.json(); } catch { body = {}; }
  }

  try {

    // ── GET listar-oe-mensual (admin/oficina, session_token por query) ────
    if (action === 'listar-oe-mensual' && req.method === 'GET') {
      const user = await verificarSesion(url.searchParams.get('session_token'));
      if (!user) return err('Sesión inválida o expirada', 401);
      if (user.rol_app !== 'admin' && user.rol_app !== 'oficina') return err('No autorizado', 403);

      // 1. Filas de oe_mensual
      const { data: rows, error: oErr } = await supabase
        .from('oe_mensual')
        .select('*')
        .order('periodo', { ascending: true })
        .limit(500);
      if (oErr) return err(oErr.message, 500);

      const hoy = new Date();
      const mesActual = hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0') + '-01';
      const existePeriodos = new Set((rows || []).map(r => r.periodo));

      // 2. Empleados directos
      const { data: directos, error: dErr } = await supabase
        .from('empleados').select('id').eq('categoria', 'directo').limit(200);
      if (dErr) return err(dErr.message, 500);
      const directoIds = (directos || []).map(e => e.id);

      // 3. Horas fichadas por mes (misma regla que RPC rentabilidad_mensual:
      //    jornada_segmentos con salida, empleados directos, duración 0–15h)
      const horasPorMes = {};
      if (directoIds.length > 0) {
        const desde = rows && rows.length > 0 ? rows[0].periodo : mesActual;
        const { data: jornadas, error: jErr } = await supabase
          .from('jornadas').select('id, fecha, empleado_id')
          .in('empleado_id', directoIds)
          .gte('fecha', desde)
          .limit(10000);
        if (jErr) return err(jErr.message, 500);

        const jMap = {};
        for (const j of (jornadas || [])) jMap[j.id] = j;
        const jIds = Object.keys(jMap);

        for (let i = 0; i < jIds.length; i += 200) {
          const batch = jIds.slice(i, i + 200);
          const { data: segs, error: sErr } = await supabase
            .from('jornada_segmentos')
            .select('jornada_id, entrada, salida')
            .in('jornada_id', batch)
            .not('salida', 'is', null)
            .limit(5000);
          if (sErr) return err(sErr.message, 500);
          for (const s of (segs || [])) {
            const horas = (new Date(s.salida) - new Date(s.entrada)) / 3600000;
            if (horas < 0 || horas > 15) continue;
            const j = jMap[s.jornada_id];
            if (!j) continue;
            const mes = j.fecha.slice(0, 7) + '-01';
            horasPorMes[mes] = (horasPorMes[mes] || 0) + horas;
          }
        }
      }

      // 4. Armar salida: filas reales + fila virtual del mes actual si no existe
      const meses = (rows || []).slice();
      if (!existePeriodos.has(mesActual)) {
        if (meses.length > 0) {
          const ultimo = meses[meses.length - 1];
          meses.push({
            periodo: mesActual,
            oe_total_usd: ultimo.oe_total_usd,
            horas_base: ultimo.horas_base,
            datos_completos: false,
            nota: null,
            cierre_manual: null,
            actualizado_por: null,
            actualizado_en: null,
          });
        } else {
          meses.push({
            periodo: mesActual,
            oe_total_usd: null,
            horas_base: null,
            datos_completos: false,
            nota: null,
            cierre_manual: null,
          });
        }
      }

      // 5. Enriquecer cada fila
      const result = meses.map(r => {
        const horas_fichadas = Math.round((horasPorMes[r.periodo] || 0) * 10) / 10;
        const heredado = !existePeriodos.has(r.periodo);

        // cerrado: cierre_manual override, si no → mes ya terminó
        let cerrado;
        if (r.cierre_manual != null) {
          cerrado = r.cierre_manual;
        } else {
          const [y, m] = r.periodo.split('-').map(Number);
          const ultimoDia = new Date(y, m, 0); // último día del mes
          cerrado = ultimoDia < new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
        }

        return { ...r, horas_fichadas, heredado, cerrado };
      });

      return ok({ ok: true, meses: result });
    }

    // ── POST guardar-oe-mensual (admin) ──────────────────────────────────
    if (action === 'guardar-oe-mensual' && req.method === 'POST') {
      const user = await verificarSesion(body.session_token);
      if (!user) return err('Sesión inválida o expirada', 401);
      if (user.rol_app !== 'admin') return err('No autorizado', 403);

      const { periodo, oe_total_usd, horas_base, datos_completos, cierre_manual, nota } = body;

      if (!periodo || !/^\d{4}-\d{2}-01$/.test(periodo))
        return err('periodo obligatorio, formato YYYY-MM-01', 400);

      if (oe_total_usd !== undefined) {
        if (!isFinite(Number(oe_total_usd)) || Number(oe_total_usd) < 0)
          return err('oe_total_usd debe ser un número >= 0', 400);
      }
      if (horas_base !== undefined) {
        if (!isFinite(Number(horas_base)) || Number(horas_base) < 0)
          return err('horas_base debe ser un número >= 0', 400);
      }

      // Spread condicional con !== undefined
      const payload = {
        periodo,
        actualizado_por: user.nombre,
        actualizado_en: new Date().toISOString(),
      };
      if (oe_total_usd !== undefined) payload.oe_total_usd = Number(oe_total_usd);
      if (horas_base !== undefined) payload.horas_base = Number(horas_base);
      if (datos_completos !== undefined) payload.datos_completos = datos_completos;
      if (cierre_manual !== undefined) payload.cierre_manual = cierre_manual;
      if (nota !== undefined) payload.nota = nota;

      const { data: guardado, error: uErr } = await supabase
        .from('oe_mensual')
        .upsert(payload, { onConflict: 'periodo' })
        .select()
        .single();
      if (uErr) return err(uErr.message, 500);

      return ok({ ok: true, periodo, guardado });
    }

    return err('Acción no reconocida: ' + action);

  } catch (e) {
    return err(e.message, 500);
  }
}
