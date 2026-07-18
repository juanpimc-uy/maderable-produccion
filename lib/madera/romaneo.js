import { piesMaderero, espesorACm, numeroPieza } from './calc.js';

export async function completar(sb, body) {
  const { operario_id, partida_id, romaneo } = body;
  if (!operario_id || !partida_id) throw new Error('operario_id y partida_id requeridos');
  if (!Array.isArray(romaneo) || romaneo.length === 0) throw new Error('romaneo debe ser un array con al menos una línea');

  // 1. Validar operario
  const { data: operario } = await sb.from('empleados').select('id').eq('id', operario_id).maybeSingle();
  if (!operario) throw new Error('Operario no encontrado');

  // 2. Cargar partida + espesor
  const { data: partida, error: pErr } = await sb.from('madera_partidas')
    .select('*, espesor:madera_espesores(valor, unidad)')
    .eq('id', partida_id).maybeSingle();
  if (pErr) throw pErr;
  if (!partida) throw new Error('Partida no encontrada');

  // 3. Validar estado
  if (partida.estado !== 'esperada') throw new Error('La partida debe estar en estado "esperada" para romanear');

  const espesor = partida.espesor;
  if (!espesor) throw new Error('Espesor no encontrado para la partida');

  // 4. Generar piezas
  const piezas = [];
  let indice = 1;
  let totalPies = 0;

  for (const linea of romaneo) {
    const { ancho_cm, largo_cm, cantidad } = linea;
    if (!ancho_cm || !largo_cm) throw new Error('Cada línea necesita ancho_cm y largo_cm');
    const cant = Number(cantidad) || 1;
    for (let c = 0; c < cant; c++) {
      const pies = piesMaderero({ espesor_valor: espesor.valor, espesor_unidad: espesor.unidad, ancho_cm: Number(ancho_cm), largo_cm: Number(largo_cm) });
      const np = numeroPieza(partida.numero, indice);
      piezas.push({
        partida_id,
        numero_pieza: np,
        ancho_cm: Number(ancho_cm),
        largo_cm: Number(largo_cm),
        espesor_cm: espesorACm({ valor: espesor.valor, unidad: espesor.unidad }),
        pies_maderero: Math.round(pies * 1000) / 1000,
        costo_pieza_usd: null,
        estado: 'en_stock',
        qr_codigo: np,
        etiqueta_impresa: false,
      });
      totalPies += pies;
      indice++;
    }
  }

  // 5. Bulk INSERT piezas
  const { data: insertedPiezas, error: iPErr } = await sb.from('madera_piezas').insert(piezas).select('id, numero_pieza, pies_maderero');
  if (iPErr) throw iPErr;

  // 6-7. UPDATE partida
  const piesRomaneados = Math.round(totalPies * 1000) / 1000;
  const { error: uErr } = await sb.from('madera_partidas').update({
    estado: 'pendiente_factura',
    romaneada_por: operario_id,
    romaneada_en: new Date().toISOString(),
    pies_romaneados: piesRomaneados,
  }).eq('id', partida_id);
  if (uErr) throw uErr;

  // 8. Bulk INSERT movimientos
  const movimientos = insertedPiezas.map(p => ({
    pieza_id: p.id,
    tipo: 'ingreso',
    pies: p.pies_maderero,
    monto_usd: null,
    realizado_por: operario_id,
    realizado_en: new Date().toISOString(),
  }));
  const { error: mErr } = await sb.from('madera_movimientos').insert(movimientos);
  if (mErr) throw mErr;

  return {
    ok: true,
    partida_id,
    piezas_ids: insertedPiezas.map(p => p.id),
    pies_totales: piesRomaneados,
    cant_piezas: insertedPiezas.length,
  };
}
