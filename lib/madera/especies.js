// Catálogo de especies de madera
export async function listar(sb) {
  const { data, error } = await sb.from('madera_especies')
    .select('*').eq('archivado', false).order('nombre');
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
