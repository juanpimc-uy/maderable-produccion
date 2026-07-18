export async function stockAgregado(sb) {
  // Piezas en stock agrupadas por especie+espesor
  const { data, error } = await sb.from('madera_piezas')
    .select('id, partida_id, pies_maderero, costo_pieza_usd, estado, partida:madera_partidas(especie_id, espesor_id, numero, especie:madera_especies(nombre, nombre_corto), espesor:madera_espesores(valor, unidad))')
    .eq('estado', 'en_stock');
  if (error) throw error;

  // Agrupar por especie+espesor
  const grupos = {};
  for (const p of (data || [])) {
    const esp = p.partida?.especie;
    const esps = p.partida?.espesor;
    if (!esp || !esps) continue;
    const key = `${esp.nombre_corto}_${esps.valor}_${esps.unidad}`;
    if (!grupos[key]) {
      grupos[key] = {
        especie: esp.nombre, especie_corto: esp.nombre_corto,
        espesor_valor: esps.valor, espesor_unidad: esps.unidad,
        cant_piezas: 0, pies_total: 0, costo_total_usd: 0,
        partidas: new Set(),
      };
    }
    grupos[key].cant_piezas++;
    grupos[key].pies_total += Number(p.pies_maderero) || 0;
    grupos[key].costo_total_usd += Number(p.costo_pieza_usd) || 0;
    grupos[key].partidas.add(p.partida?.numero);
  }

  const resultado = Object.values(grupos).map(g => ({
    ...g,
    pies_total: Math.round(g.pies_total * 100) / 100,
    costo_total_usd: Math.round(g.costo_total_usd * 100) / 100,
    partidas: [...g.partidas],
  }));

  return { ok: true, stock: resultado };
}

export async function detallePorId(sb, query) {
  const { pieza_id, qr } = query;
  let q = sb.from('madera_piezas')
    .select('*, partida:madera_partidas(numero, especie:madera_especies(nombre, nombre_corto), espesor:madera_espesores(valor, unidad))');
  if (pieza_id) q = q.eq('id', pieza_id);
  else if (qr) q = q.eq('qr_codigo', qr);
  else throw new Error('pieza_id o qr requerido');
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Pieza no encontrada');
  return { ok: true, pieza: data };
}
