// lib/jornadas/nocturna.js — Detección de jornada nocturna que cruza medianoche.
// La jornada pertenece al día en que ARRANCÓ. Una fichada de madrugada cierra
// la jornada del día anterior; no crea una nueva.

export const CORTE_NOCTURNO_HORA = 6.5; // 06:30 UY

/**
 * Busca una jornada del día anterior que siga abierta por la noche.
 * @param {SupabaseClient} sb
 * @param {string} empleado_id
 * @param {string} ahoraISO — timestamp ISO del momento actual
 * @returns {{ jornada, aperturaISO: string } | null}
 */
export async function buscarJornadaNocturna(sb, empleado_id, ahoraISO) {
  // a) Hora local UY de ahoraISO (UTC-3 fijo, sin DST)
  const ahora = new Date(ahoraISO);
  const uyMs = ahora.getTime() - 3 * 3600000;
  const uyDate = new Date(uyMs);
  const horaUY = uyDate.getUTCHours() + uyDate.getUTCMinutes() / 60;
  if (horaUY >= CORTE_NOCTURNO_HORA) return null; // no es madrugada

  // b) ayerUY = fecha local UY de ahora, menos 1 día
  const y = uyDate.getUTCFullYear();
  const m = uyDate.getUTCMonth();
  const d = uyDate.getUTCDate();
  const ayerDate = new Date(Date.UTC(y, m, d - 1));
  const ayerUY = ayerDate.toISOString().slice(0, 10); // YYYY-MM-DD

  // c) Buscar jornada del empleado con fecha = ayerUY
  const { data: jornadas } = await sb.from('jornadas')
    .select('*')
    .eq('empleado_id', empleado_id)
    .eq('fecha', ayerUY);
  if (!jornadas || !jornadas.length) return null;
  const jornada = jornadas[0];

  // d) Buscar marcador de noche en curso
  let aperturaISO = null;

  // d.1) Segmento abierto de esa jornada
  const { data: segAbierto } = await sb.from('jornada_segmentos')
    .select('entrada')
    .eq('jornada_id', jornada.id)
    .is('salida', null)
    .limit(1)
    .maybeSingle();
  if (segAbierto) {
    aperturaISO = segAbierto.entrada;
  } else {
    // d.2) Registro de trabajo abierto desde ayer 18:00 UY
    const desde18 = ayerUY + 'T18:00:00-03:00';
    const { data: regs } = await sb.from('registros_trabajo')
      .select('inicio')
      .eq('empleado_id', empleado_id)
      .is('fin', null)
      .or('eliminada.is.null,eliminada.eq.false')
      .gte('inicio', desde18)
      .lte('inicio', ahoraISO)
      .order('inicio', { ascending: true })
      .limit(1);
    if (regs && regs.length) {
      aperturaISO = regs[0].inicio;
    }
  }

  if (!aperturaISO) return null;

  // e) Sanity: si (ahora - apertura) > 16h → no es una sesión nocturna real
  const diffH = (ahora.getTime() - new Date(aperturaISO).getTime()) / 3600000;
  if (diffH > 16) return null;

  return { jornada, aperturaISO };
}
