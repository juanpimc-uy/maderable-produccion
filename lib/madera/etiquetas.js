export async function piezasPendientesImpresion(sb, query) {
  let q = sb.from('madera_piezas')
    .select('id, partida_id, numero_pieza, partida:madera_partidas!inner(id, numero, estado, motivo_carga_inicial)')
    .eq('etiqueta_impresa', false)
    .in('partida.estado', ['pendiente_factura', 'activa']);
  if (query.partida_id) q = q.eq('partida_id', query.partida_id);
  const { data, error } = await q;
  if (error) throw error;

  // Agrupar por partida
  const map = {};
  for (const p of (data || [])) {
    if (!p.partida) continue;
    const pid = p.partida_id;
    if (!map[pid]) {
      const origen = p.partida.motivo_carga_inicial ? 'carga_inicial' : 'factura';
      map[pid] = {
        id: pid, numero: p.partida.numero, estado: p.partida.estado,
        origen, cant_pendientes: 0,
      };
    }
    map[pid].cant_pendientes++;
  }

  // Obtener cant_totales por partida en una sola query
  const partidaIds = Object.keys(map);
  if (partidaIds.length > 0) {
    const { data: todasPiezas, error: cErr } = await sb.from('madera_piezas')
      .select('partida_id').in('partida_id', partidaIds);
    if (cErr) throw cErr;
    for (const row of (todasPiezas || [])) {
      if (map[row.partida_id]) map[row.partida_id].cant_totales = (map[row.partida_id].cant_totales || 0) + 1;
    }
  }

  return { ok: true, partidas: Object.values(map) };
}

export async function marcarEtiquetasImpresas(sb, body) {
  const { user_id, pieza_ids, partida_id } = body;
  if (!user_id) throw new Error('user_id requerido');

  let ids = [];
  if (Array.isArray(pieza_ids) && pieza_ids.length > 0) {
    ids = pieza_ids;
  } else if (partida_id) {
    const { data } = await sb.from('madera_piezas')
      .select('id').eq('partida_id', partida_id).eq('etiqueta_impresa', false);
    ids = (data || []).map(p => p.id);
  } else {
    throw new Error('pieza_ids o partida_id requerido');
  }

  if (ids.length === 0) return { ok: true, cant_marcadas: 0 };

  const { error: uErr } = await sb.from('madera_piezas')
    .update({ etiqueta_impresa: true }).in('id', ids);
  if (uErr) throw uErr;

  // Movimientos
  const ahora = new Date().toISOString();
  const movs = ids.map(id => ({
    pieza_id: id, tipo: 'impresion_etiqueta',
    realizado_por: user_id, realizado_en: ahora,
  }));
  const { error: mErr } = await sb.from('madera_movimientos').insert(movs);
  if (mErr) throw mErr;

  return { ok: true, cant_marcadas: ids.length };
}

export async function marcarPiezaParaReimpresion(sb, body) {
  const { pieza_id } = body;
  if (!pieza_id) throw new Error('pieza_id requerido');
  const { error } = await sb.from('madera_piezas')
    .update({ etiqueta_impresa: false }).eq('id', pieza_id);
  if (error) throw error;
  return { ok: true };
}
