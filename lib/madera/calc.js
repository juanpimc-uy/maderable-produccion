export function piesMaderero({ espesor_valor, espesor_unidad, ancho_cm, largo_cm }) {
  const denominador = espesor_unidad === 'pulgadas' ? 929.03 : 2359.74;
  return (espesor_valor * ancho_cm * largo_cm) / denominador;
}

export function espesorACm({ valor, unidad }) {
  return unidad === 'pulgadas' ? valor * 2.54 : valor;
}

export function numeroPieza(numero_partida, indice) {
  const p = String(numero_partida).padStart(5, '0');
  const i = String(indice).padStart(2, '0');
  return `P${p}-${i}`;
}
