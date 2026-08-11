// api/capacidad.js — Semáforo de capacidad semanal de taller (Edge runtime)
// Lectura sin auth (misma política que planificacion/proyectos-activos).
// La capacidad por semana se guarda en config_global.capacidad_semanal vía
// /api/tiempos?action=guardar-config (con sesión) — acá solo se lee.
import { createClient } from '@supabase/supabase-js';
export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xhfeurinovvsbgobkidy.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
function ok(data) {
  return new Response(JSON.stringify(data), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
function err(msg, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: msg }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Defaults (fallback si config_global no tiene las claves)
const COEF_DEF = { corte: 0.8, enchapado: 0.3, armado: 1 };
const DIF_DEF = { 1: 0.7, 2: 1.0, 3: 1.5, 4: 2.2 };
const CAP_DEF = { cap_default: 320, semanas: {}, aprox_sin_estimar: 35 };

// Hoy en UTC-3 (Uruguay, sin DST)
function hoyUY() {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}
// Lunes de la semana de una fecha YYYY-MM-DD
function lunesDe(fechaStr) {
  const d = new Date(fechaStr + 'T00:00:00Z');
  if (isNaN(d)) return null;
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// Un mueble está estimado de verdad: tiene placas y dif cargados, no está
// marcado sin_datos, y NO es el default envenenado 4/M (los viejos quedaron así).
function estimadoValido(m) {
  if (!m || m.sin_datos) return false;
  if (m.placas == null || m.dif == null) return false;
  if (Number(m.placas) === 4 && Number(m.dif) === 2) return false;
  return true;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  try {
    if (action === 'semanas' && req.method === 'GET') {
      const [gantt, fichadas, proys, cfgRows] = await Promise.all([
        supabase.rpc('planificacion_gantt', { p_dias_strip: 1 }),
        supabase.rpc('capacidad_horas_fichadas'),
        supabase.from('proyectos_cache').select('id, muebles').eq('estado', 'en_produccion'),
        supabase.from('config_global').select('clave, valor').in('clave', ['formula_coef', 'capacidad_semanal']),
      ]);
      if (gantt.error) throw gantt.error;
      if (fichadas.error) throw fichadas.error;
      if (proys.error) throw proys.error;

      // Config
      const cfgMap = {};
      (cfgRows.data || []).forEach(r => {
        cfgMap[r.clave] = typeof r.valor === 'string' ? JSON.parse(r.valor) : r.valor;
      });
      const formula = cfgMap.formula_coef || {};
      const coef = formula.coef || COEF_DEF;
      const dif = formula.dif || DIF_DEF;
      const hxPlaca = (Number(coef.corte) || 0) + (Number(coef.enchapado) || 0) + (Number(coef.armado) || 0);
      const capCfg = { ...CAP_DEF, ...(cfgMap.capacidad_semanal || {}) };

      // Muebles JSONB por proyecto|item
      const mMap = {};
      (proys.data || []).forEach(p => {
        (Array.isArray(p.muebles) ? p.muebles : []).forEach(m => { mMap[p.id + '|' + m.id] = m; });
      });
      // Horas fichadas por proyecto|item
      const fMap = {};
      (fichadas.data || []).forEach(f => { fMap[f.proyecto_id + '|' + f.item_id] = Number(f.horas) || 0; });

      const pendientes = (gantt.data && gantt.data.muebles) || [];
      const hoy = hoyUY();
      const semanaActual = lunesDe(hoy);
      const semanas = {}; // lunes -> { est, sin, items[] }
      const sinFecha = { muebles: 0, horas: 0 };
      let totalSinEstimarH = 0, totalSinEstimarN = 0;

      for (const p of pendientes) {
        const key = p.proyecto_id + '|' + p.item_id;
        const m = mMap[key];
        // cant está sobrecargado: no entero o >10 suele ser una medida (m², ml),
        // no una cantidad de unidades — en ese caso NO multiplica (regla del modelo de datos).
        const cantRaw = Number(m?.cant) || 1;
        const cant = (Number.isInteger(cantRaw) && cantRaw >= 1 && cantRaw <= 10) ? cantRaw : 1;
        const fich = fMap[key] || 0;
        const esEst = estimadoValido(m);
        const hTotal = esEst
          ? Number(m.placas) * hxPlaca * (Number(dif[m.dif]) || 1) * cant
          : (Number(capCfg.aprox_sin_estimar) || 35) * cant;
        const restante = Math.max(0, Math.round((hTotal - fich) * 10) / 10);
        if (restante <= 0) continue; // ya se fabricó lo estimado

        if (!esEst) { totalSinEstimarH += restante; totalSinEstimarN++; }

        if (!p.fecha_comprometida) {
          sinFecha.muebles++; sinFecha.horas += restante;
          continue;
        }
        // Vencidas caen en la semana actual (hay que fabricarlas YA)
        const atrasado = p.fecha_comprometida < hoy;
        const wk = atrasado ? semanaActual : lunesDe(p.fecha_comprometida);
        if (!semanas[wk]) semanas[wk] = { est: 0, sin: 0, items: [] };
        semanas[wk][esEst ? 'est' : 'sin'] += restante;
        semanas[wk].items.push({
          numero: p.numero, proyecto: p.proyecto_nombre,
          codigo: p.codigo, nombre: p.item_nombre,
          h: restante, estado: esEst ? 'est' : 'sin',
          atrasado, fecha: p.fecha_comprometida,
        });
      }

      const lista = Object.keys(semanas).sort().map(wk => ({
        semana: wk,
        cap: Number(capCfg.semanas?.[wk]) || Number(capCfg.cap_default) || 320,
        est: Math.round(semanas[wk].est * 10) / 10,
        sin: Math.round(semanas[wk].sin * 10) / 10,
        items: semanas[wk].items.sort((a, b) => b.h - a.h),
      }));

      return ok({
        ok: true,
        hoy, semana_actual: semanaActual,
        semanas: lista,
        sin_fecha: { muebles: sinFecha.muebles, horas: Math.round(sinFecha.horas) },
        sin_estimar: { muebles: totalSinEstimarN, horas: Math.round(totalSinEstimarH) },
        config: capCfg,
        formula_usada: { h_por_placa_taller: Math.round(hxPlaca * 100) / 100, dif },
      });
    }

    return err('action inválida', 400);
  } catch (e) {
    console.error('[capacidad]', action, e);
    return err(e.message || 'Error interno', 500);
  }
}
