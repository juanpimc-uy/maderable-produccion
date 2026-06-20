// api/cron-cierre.js
// Cron nocturno: marca sesiones huérfanas (registros_trabajo con fin IS NULL)
// de días anteriores como pendientes (anomalia=true, estado='pausado'),
// dejándolas abiertas (fin null) para resolución manual.
//
// Protegido con CRON_SECRET en env vars de Vercel.
// Schedule: 30 2 * * * (02:30 UTC = 23:30 UY)

import { createClient } from '@supabase/supabase-js';
export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xhfeurinovvsbgobkidy.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS });

  // Verificar secret (Vercel crons envían Authorization automáticamente)
  const authHeader = req.headers.get('Authorization') || '';
  const secret = process.env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: CORS });
  }

  try {
    // "Ayer UY": hoy UTC-3 menos 1 día
    const ahoraUY = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const ayerUY = new Date(ahoraUY);
    ayerUY.setUTCDate(ayerUY.getUTCDate() - 1);
    const ayerStr = ayerUY.toISOString().split('T')[0]; // YYYY-MM-DD

    // Buscar registros_trabajo con fin IS NULL e inicio <= ayer UY
    const corteTS = ayerStr + 'T23:59:59-03:00'; // fin del día ayer UY en UTC
    const { data: huerfanas, error: qErr } = await supabase
      .from('registros_trabajo')
      .select('id, inicio')
      .is('fin', null)
      .lte('inicio', corteTS);

    if (qErr) throw qErr;
    if (!huerfanas || huerfanas.length === 0) {
      return new Response(JSON.stringify({ ok: true, marcadas: 0 }), { status: 200, headers: CORS });
    }

    let marcadas = 0;
    for (const reg of huerfanas) {
      const { error: uErr } = await supabase
        .from('registros_trabajo')
        .update({
          estado: 'pausado',
          anomalia: true,
          anomalia_aprobada: null,
        })
        .eq('id', reg.id);

      if (!uErr) marcadas++;
    }

    return new Response(JSON.stringify({ ok: true, marcadas }), { status: 200, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
