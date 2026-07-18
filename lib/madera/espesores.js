// Catálogo de espesores
export async function listar(sb) {
  const { data, error } = await sb.from('madera_espesores')
    .select('*').eq('archivado', false).order('unidad').order('valor');
  if (error) throw error;
  return { ok: true, espesores: data || [] };
}

export async function crear(sb, body) {
  const { valor, unidad, descripcion } = body;
  if (valor == null || !unidad) throw new Error('valor y unidad requeridos');
  if (!['pulgadas', 'cm'].includes(unidad)) throw new Error('unidad debe ser pulgadas o cm');
  const { data, error } = await sb.from('madera_espesores')
    .insert({ valor: Number(valor), unidad, descripcion: descripcion || null })
    .select().single();
  if (error) throw error;
  return { ok: true, espesor: data };
}
