export async function cargar(sb, body) {
  const { admin_id, partida_id, factura_numero, factura_fecha, monto_usd, pies_facturados } = body;
  if (!partida_id || !factura_numero || monto_usd == null) throw new Error('partida_id, factura_numero y monto_usd requeridos');

  // 1-2. Cargar partida
  const { data: partida, error: pErr } = await sb.from('madera_partidas')
    .select('*').eq('id', partida_id).maybeSingle();
  if (pErr) throw pErr;
  if (!partida) throw new Error('Partida no encontrada');

  // 3. Validar estado
  if (partida.estado !== 'pendiente_factura') throw new Error('La partida debe estar en estado "pendiente_factura"');
  if (!partida.pies_romaneados || partida.pies_romaneados <= 0) throw new Error('La partida no tiene pies romaneados');

  // 4. Calcular
  const montoNum = Number(monto_usd);
  const piesFact = Number(pies_facturados) || 0;
  const costoPorPie = montoNum / partida.pies_romaneados;
  const discrepancia = piesFact - partida.pies_romaneados;

  // 5. UPDATE partida
  const { error: uErr } = await sb.from('madera_partidas').update({
    estado: 'activa',
    factura_numero: factura_numero.trim(),
    factura_fecha: factura_fecha || null,
    pies_facturados: piesFact,
    costo_total_usd: montoNum,
    costo_por_pie_usd: Math.round(costoPorPie * 10000) / 10000,
    discrepancia_pies: Math.round(discrepancia * 1000) / 1000,
    factura_cargada_por: admin_id,
    factura_cargada_en: new Date().toISOString(),
  }).eq('id', partida_id);
  if (uErr) throw uErr;

  // 6. Cargar piezas
  const { data: piezas, error: pzErr } = await sb.from('madera_piezas')
    .select('id, pies_maderero').eq('partida_id', partida_id);
  if (pzErr) throw pzErr;

  // 7. Calcular costo por pieza y armar batch de upserts + movimientos
  const piezasUpsert = [];
  const movimientos = [];
  for (const p of (piezas || [])) {
    const costoPieza = Math.round(p.pies_maderero * costoPorPie * 100) / 100;
    piezasUpsert.push({ id: p.id, costo_pieza_usd: costoPieza });
    movimientos.push({
      pieza_id: p.id,
      tipo: 'alta_factura',
      pies: p.pies_maderero,
      monto_usd: costoPieza,
      realizado_por: admin_id,
      realizado_en: new Date().toISOString(),
    });
  }
  const piezasActualizadas = piezasUpsert.length;

  if (piezasUpsert.length) {
    const { error: upErr } = await sb.from('madera_piezas')
      .upsert(piezasUpsert, { onConflict: 'id' });
    if (upErr) throw upErr;
  }

  // 8. Bulk INSERT movimientos
  if (movimientos.length) {
    const { error: mErr } = await sb.from('madera_movimientos').insert(movimientos);
    if (mErr) throw mErr;
  }

  return {
    ok: true,
    discrepancia_pies: Math.round(discrepancia * 1000) / 1000,
    costo_por_pie_usd: Math.round(costoPorPie * 10000) / 10000,
    piezas_actualizadas: piezasActualizadas,
  };
}
