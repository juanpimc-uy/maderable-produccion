import { piesMaderero, espesorACm, numeroPieza } from './calc.js';

export async function crear(sb, body) {
  const { admin_id, especie_id, espesor_id, proveedor_nombre, motivo, costo_por_pie_usd, ubicacion, romaneo } = body;
  if (!especie_id || !espesor_id || !proveedor_nombre) throw new Error('especie_id, espesor_id y proveedor_nombre requeridos');
  if (!motivo || !['recorte', 'migracion', 'sin_factura', 'otro'].includes(motivo)) throw new Error('motivo debe ser recorte, migracion, sin_factura u otro');
  if (costo_por_pie_usd == null || Number(costo_por_pie_usd) < 0) throw new Error('costo_por_pie_usd requerido y >= 0');
  if (!Array.isArray(romaneo) || romaneo.length === 0) throw new Error('romaneo debe ser un array con al menos una línea');

  // Cargar espesor
  const { data: espesor, error: eErr } = await sb.from('madera_espesores')
    .select('valor, unidad').eq('id', espesor_id).maybeSingle();
  if (eErr) throw eErr;
  if (!espesor) throw new Error('Espesor no encontrado');

  const costoPie = Number(costo_por_pie_usd);

  // Crear partida directo como activa
  const { data: partida, error: pErr } = await sb.from('madera_partidas').insert({
    estado: 'activa',
    especie_id, espesor_id,
    proveedor_nombre: proveedor_nombre.trim(),
    motivo_carga_inicial: motivo,
    costo_por_pie_usd: costoPie,
    factura_cargada_en: new Date().toISOString(),
    creada_por: admin_id,
  }).select().single();
  if (pErr) throw pErr;

  // Generar piezas
  const piezasRows = [];
  let indice = 1;
  let totalPies = 0;

  for (const linea of romaneo) {
    const { ancho_cm, largo_cm, cantidad } = linea;
    if (!ancho_cm || !largo_cm) throw new Error('Cada línea necesita ancho_cm y largo_cm');
    const cant = Number(cantidad) || 1;
    for (let c = 0; c < cant; c++) {
      const pies = piesMaderero({ espesor_valor: espesor.valor, espesor_unidad: espesor.unidad, ancho_cm: Number(ancho_cm), largo_cm: Number(largo_cm) });
      const np = numeroPieza(partida.numero, indice);
      const costoPieza = Math.round(pies * costoPie * 100) / 100;
      piezasRows.push({
        partida_id: partida.id,
        numero_pieza: np,
        ancho_cm: Number(ancho_cm),
        largo_cm: Number(largo_cm),
        espesor_cm: espesorACm({ valor: espesor.valor, unidad: espesor.unidad }),
        pies_maderero: Math.round(pies * 1000) / 1000,
        costo_pieza_usd: costoPieza,
        estado: 'en_stock',
        qr_codigo: np,
        etiqueta_impresa: false,
        ubicacion: ubicacion || null,
      });
      totalPies += pies;
      indice++;
    }
  }

  // INSERT piezas
  const { data: insertedPiezas, error: iPErr } = await sb.from('madera_piezas').insert(piezasRows).select('id, pies_maderero, costo_pieza_usd');
  if (iPErr) throw iPErr;

  // UPDATE partida con totales
  const piesRomaneados = Math.round(totalPies * 1000) / 1000;
  const costoTotal = Math.round(totalPies * costoPie * 100) / 100;
  const { error: uErr } = await sb.from('madera_partidas').update({
    pies_romaneados: piesRomaneados,
    costo_total_usd: costoTotal,
  }).eq('id', partida.id);
  if (uErr) throw uErr;

  // INSERT movimientos (ingreso + alta_factura por pieza)
  const ahora = new Date().toISOString();
  const movimientos = [];
  for (const p of insertedPiezas) {
    movimientos.push({
      pieza_id: p.id, tipo: 'ingreso', pies: p.pies_maderero, monto_usd: null,
      realizado_por: admin_id, realizado_en: ahora,
    });
    movimientos.push({
      pieza_id: p.id, tipo: 'alta_factura', pies: p.pies_maderero, monto_usd: p.costo_pieza_usd,
      realizado_por: admin_id, realizado_en: ahora,
    });
  }
  if (movimientos.length) {
    const { error: mErr } = await sb.from('madera_movimientos').insert(movimientos);
    if (mErr) throw mErr;
  }

  return { ok: true, partida_id: partida.id, numero: partida.numero, cant_piezas: insertedPiezas.length };
}

export async function ultimoCosto(sb, query) {
  const { especie_id, espesor_id } = query;
  if (!especie_id || !espesor_id) return { ok: true, costo_por_pie_usd: null, partida_referencia: null };
  const { data } = await sb.from('madera_partidas')
    .select('costo_por_pie_usd, numero')
    .eq('especie_id', especie_id).eq('espesor_id', espesor_id)
    .not('costo_por_pie_usd', 'is', null)
    .order('creada_en', { ascending: false })
    .limit(1).maybeSingle();
  return {
    ok: true,
    costo_por_pie_usd: data?.costo_por_pie_usd || null,
    partida_referencia: data?.numero || null,
  };
}
