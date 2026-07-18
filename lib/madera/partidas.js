// CRUD y ciclo de vida de partidas

export async function crearEsperada(sb, body) {
  const { admin_id, especie_id, espesor_id, proveedor_nombre, cantidad_aproximada_pies, fecha_esperada, notas_recepcion } = body;
  if (!especie_id || !espesor_id || !proveedor_nombre) throw new Error('especie_id, espesor_id y proveedor_nombre requeridos');
  const row = {
    estado: 'esperada',
    especie_id, espesor_id,
    proveedor_nombre: proveedor_nombre.trim(),
    creada_por: admin_id,
  };
  if (cantidad_aproximada_pies !== undefined) row.cantidad_aproximada_pies = Number(cantidad_aproximada_pies);
  if (fecha_esperada !== undefined) row.fecha_esperada = fecha_esperada;
  if (notas_recepcion !== undefined) row.notas_recepcion = notas_recepcion;
  const { data, error } = await sb.from('madera_partidas').insert(row).select().single();
  if (error) throw error;
  return { ok: true, partida: data };
}

export async function editarEsperada(sb, body) {
  const { admin_id, partida_id, especie_id, espesor_id, proveedor_nombre, cantidad_aproximada_pies, fecha_esperada, notas_recepcion } = body;
  if (!partida_id) throw new Error('partida_id requerido');
  const { data: existing } = await sb.from('madera_partidas').select('estado').eq('id', partida_id).maybeSingle();
  if (!existing) throw new Error('Partida no encontrada');
  if (existing.estado !== 'esperada') throw new Error('Solo se pueden editar partidas en estado esperada');
  const upd = {};
  if (especie_id !== undefined) upd.especie_id = especie_id;
  if (espesor_id !== undefined) upd.espesor_id = espesor_id;
  if (proveedor_nombre !== undefined) upd.proveedor_nombre = proveedor_nombre.trim();
  if (cantidad_aproximada_pies !== undefined) upd.cantidad_aproximada_pies = Number(cantidad_aproximada_pies);
  if (fecha_esperada !== undefined) upd.fecha_esperada = fecha_esperada;
  if (notas_recepcion !== undefined) upd.notas_recepcion = notas_recepcion;
  const { data, error } = await sb.from('madera_partidas').update(upd).eq('id', partida_id).select().single();
  if (error) throw error;
  return { ok: true, partida: data };
}

export async function eliminarEsperada(sb, body) {
  const { partida_id } = body;
  if (!partida_id) throw new Error('partida_id requerido');
  const { data: existing } = await sb.from('madera_partidas').select('estado').eq('id', partida_id).maybeSingle();
  if (!existing) throw new Error('Partida no encontrada');
  if (existing.estado !== 'esperada') throw new Error('Solo se pueden eliminar partidas en estado esperada');
  const { error } = await sb.from('madera_partidas').delete().eq('id', partida_id);
  if (error) throw error;
  return { ok: true };
}

export async function listarEsperadas(sb) {
  const { data, error } = await sb.from('madera_partidas')
    .select('*, especie:madera_especies(nombre, nombre_corto), espesor:madera_espesores(valor, unidad, descripcion)')
    .eq('estado', 'esperada')
    .order('creada_en', { ascending: false });
  if (error) throw error;
  return { ok: true, partidas: data || [] };
}

export async function detalle(sb, query) {
  const partida_id = query.partida_id;
  if (!partida_id) throw new Error('partida_id requerido');
  const { data: partida, error } = await sb.from('madera_partidas')
    .select('*, especie:madera_especies(nombre, nombre_corto), espesor:madera_espesores(valor, unidad, descripcion)')
    .eq('id', partida_id).maybeSingle();
  if (error) throw error;
  if (!partida) throw new Error('Partida no encontrada');
  const { data: piezas } = await sb.from('madera_piezas')
    .select('*').eq('partida_id', partida_id).order('numero_pieza');
  return { ok: true, partida, piezas: piezas || [] };
}

export async function listar(sb, query) {
  let q = sb.from('madera_partidas')
    .select('*, especie:madera_especies(nombre, nombre_corto), espesor:madera_espesores(valor, unidad, descripcion)')
    .order('creada_en', { ascending: false });
  const estado = query.estado;
  if (estado) q = q.eq('estado', estado);
  const { data, error } = await q.limit(200);
  if (error) throw error;
  return { ok: true, partidas: data || [] };
}

export async function archivar(sb, body) {
  const { partida_id, motivo_archivo } = body;
  if (!partida_id) throw new Error('partida_id requerido');
  const { data: existing } = await sb.from('madera_partidas').select('estado').eq('id', partida_id).maybeSingle();
  if (!existing) throw new Error('Partida no encontrada');
  if (existing.estado === 'archivada') throw new Error('Ya está archivada');
  const { data, error } = await sb.from('madera_partidas')
    .update({ estado: 'archivada', motivo_archivo: motivo_archivo || null, archivada_en: new Date().toISOString() })
    .eq('id', partida_id).select().single();
  if (error) throw error;
  return { ok: true, partida: data };
}
