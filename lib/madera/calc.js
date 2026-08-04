export function piesMaderero({ espesor_valor, espesor_unidad, ancho_cm, largo_cm }) {
  const denominador = espesor_unidad === 'pulgadas' ? 929.03
                    : espesor_unidad === 'mm'       ? 23597.362
                    : 2359.74; // cm (legacy)
  return (espesor_valor * ancho_cm * largo_cm) / denominador;
}

export function espesorACm({ valor, unidad }) {
  if (unidad === 'pulgadas') return valor * 2.54;
  if (unidad === 'mm') return valor / 10;
  return valor; // cm (legacy)
}

export function numeroPieza(numero_partida, indice) {
  const p = String(numero_partida).padStart(5, '0');
  const i = String(indice).padStart(2, '0');
  return `P${p}-${i}`;
}
