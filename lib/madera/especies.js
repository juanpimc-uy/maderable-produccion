// Catálogo de especies de madera
export async function listar(sb) {
  const { data, error } = await sb.from('madera_especies')
    .select('*').order('nombre');
  if (error) throw error;
  return { ok: true, especies: data || [] };
}

export async function crear(sb, body) {
  const { nombre, nombre_corto, observaciones } = body;
  if (!nombre || !nombre_corto) throw new Error('nombre y nombre_corto requeridos');
  const { data, error } = await sb.from('madera_especies')
    .insert({ nombre: nombre.trim(), nombre_corto: nombre_corto.trim().toUpperCase(), observaciones: observaciones || null })
    .select().single();
  if (error) throw error;
  return { ok: true, especie: data };
}

export async function editar(sb, body) {
  const { id, nombre, nombre_corto, observaciones } = body;
  if (!id) throw new Error('id requerido');
  const update = {};
  if (nombre !== undefined) update.nombre = nombre.trim();
  if (nombre_corto !== undefined) update.nombre_corto = nombre_corto.trim();
  if (observaciones !== undefined) update.observaciones = observaciones;
  if (Object.keys(update).length === 0) throw new Error('nada para actualizar');
  const { error } = await sb.from('madera_especies').update(update).eq('id', id);
  if (error) throw error;
  return { ok: true };
}

export async function archivar(sb, body) {
  const { id } = body;
  if (!id) throw new Error('id requerido');
  const { count } = await sb.from('madera_partidas')
    .select('id', { count: 'exact', head: true })
    .eq('especie_id', id)
    .neq('estado', 'archivada');
  const { error } = await sb.from('madera_especies').update({ archivado: true }).eq('id', id);
  if (error) throw error;
  return { ok: true, partidas_activas_asociadas: count || 0 };
}

export async function desarchivar(sb, body) {
  const { id } = body;
  if (!id) throw new Error('id requerido');
  const { error } = await sb.from('madera_especies').update({ archivado: false }).eq('id', id);
  if (error) throw error;
  return { ok: true };
}
