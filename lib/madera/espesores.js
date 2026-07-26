// Catálogo de espesores
export async function listar(sb) {
  const { data, error } = await sb.from('madera_espesores')
    .select('*').order('unidad').order('valor');
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

export async function editar(sb, body) {
  const { id, valor, unidad, descripcion } = body;
  if (!id) throw new Error('id requerido');
  const update = {};
  if (valor !== undefined) update.valor = Number(valor);
  if (unidad !== undefined) {
    if (!['pulgadas', 'cm'].includes(unidad)) throw new Error('unidad debe ser pulgadas o cm');
    update.unidad = unidad;
  }
  if (descripcion !== undefined) update.descripcion = descripcion;
  if (Object.keys(update).length === 0) throw new Error('nada para actualizar');
  const { error } = await sb.from('madera_espesores').update(update).eq('id', id);
  if (error) throw error;
  return { ok: true };
}

export async function archivar(sb, body) {
  const { id } = body;
  if (!id) throw new Error('id requerido');
  const { count } = await sb.from('madera_partidas')
    .select('id', { count: 'exact', head: true })
    .eq('espesor_id', id)
    .neq('estado', 'archivada');
  const { error } = await sb.from('madera_espesores').update({ archivado: true }).eq('id', id);
  if (error) throw error;
  return { ok: true, partidas_activas_asociadas: count || 0 };
}

export async function desarchivar(sb, body) {
  const { id } = body;
  if (!id) throw new Error('id requerido');
  const { error } = await sb.from('madera_espesores').update({ archivado: false }).eq('id', id);
  if (error) throw error;
  return { ok: true };
}
