// api/cnc.js — Registro CNC: placas escaneadas, consumo, métricas (Node.js runtime)
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

function ok(res, data)  { return res.status(200).json({ ok: true, ...data }); }
function err(res, msg, status = 400) { return res.status(status).json({ ok: false, msg }); }

async function verificarOperario(empleadoId) {
  if (!empleadoId) return null;
  const { data } = await supabase.from('empleados')
    .select('id, nombre').eq('id', empleadoId).eq('activo', true).eq('archivado', false).maybeSingle();
  return data || null;
}

function normCod(v) {
  return String(v == null ? '' : v).trim().replace(/[´`'']/g, '-').toUpperCase();
}

// ── Helpers ──────────────────────────────────────────────────────────────

function _materialFromItem(it) {
  return it.nombre_corto || it.descripcion || '';
}

function _medidaFromItem(it) {
  const parts = [];
  if (it.espesor_mm != null) parts.push(it.espesor_mm + 'mm');
  if (it.largo_cm != null && it.ancho_cm != null) parts.push(it.largo_cm + '×' + it.ancho_cm);
  return parts.join(' ');
}

async function _resolverPlaca(codigo) {
  // 1. Unidad serializada
  const { data: unidad } = await supabase.from('inv_unidades')
    .select('id, item_id, codigo, estado, costo_usd, ubicacion_id, reserva_proyecto_id, atributos, inv_items:item_id(id, codigo, descripcion, nombre_corto, espesor_mm, largo_cm, ancho_cm)')
    .eq('codigo', codigo).maybeSingle();
  if (unidad) {
    if (unidad.estado !== 'activa') return { err: 'Esa placa ya se usó (' + unidad.estado + ')', status: 409 };
    const it = unidad.inv_items || {};
    return {
      ok: true, tipo: 'unidad',
      unidad_id: unidad.id, item_id: it.id || unidad.item_id,
      codigo: unidad.codigo,
      material: _materialFromItem(it),
      medida: _medidaFromItem(it),
      costo_usd: unidad.costo_usd,
      reserva_proyecto_id: unidad.reserva_proyecto_id,
      ubicacion_id: unidad.ubicacion_id,
    };
  }
  // 2. Ítem por código
  const { data: item } = await supabase.from('inv_items')
    .select('id, codigo, descripcion, nombre_corto, espesor_mm, largo_cm, ancho_cm')
    .eq('codigo', codigo).eq('activo', true).maybeSingle();
  if (item) {
    return {
      ok: true, tipo: 'item',
      unidad_id: null, item_id: item.id,
      codigo: item.codigo,
      material: _materialFromItem(item),
      medida: _medidaFromItem(item),
      costo_usd: null,
      reserva_proyecto_id: null,
      ubicacion_id: null,
    };
  }
  return { err: 'Código no reconocido', status: 404 };
}

async function _consumirUnidad(unidadId, proyectoId, muebleId, empleadoId) {
  // Traer unidad solo si sigue activa (evita consumir dos veces)
  const { data: u } = await supabase.from('inv_unidades')
    .select('id, codigo, item_id, ubicacion_id, costo_usd, reserva_proyecto_id')
    .eq('id', unidadId).eq('estado', 'activa').maybeSingle();
  if (!u) return { consumida: false, costo_usd: null, aviso: null };

  let aviso = null;
  if (u.reserva_proyecto_id && u.reserva_proyecto_id !== proyectoId) {
    const { data: proy } = await supabase.from('proyectos_cache')
      .select('numero, nombre').eq('id', u.reserva_proyecto_id).maybeSingle();
    const rn = proy ? ((proy.numero || '') + ' · ' + (proy.nombre || '')).trim() : u.reserva_proyecto_id;
    aviso = 'Esta placa estaba reservada para ' + rn;
  }

  // Pasar a consumida
  await supabase.from('inv_unidades')
    .update({ estado: 'consumida', proyecto_consumo_id: proyectoId, mueble_consumo_id: muebleId || null, consumido_en: new Date().toISOString() })
    .eq('id', unidadId);

  // Movimiento de salida
  const { data: movId, error: movErr } = await supabase.rpc('inv_registrar_movimiento', {
    p_tipo: 'salida', p_item_id: u.item_id, p_ubicacion_id: u.ubicacion_id,
    p_ubicacion_destino_id: null, p_cantidad: 1,
    p_proyecto_id: proyectoId, p_mueble_id: muebleId || null,
    p_motivo: 'consumo_proyecto', p_origen: 'cnc', p_empleado_id: empleadoId,
    p_nota: 'Placa ' + (u.codigo || ''),
  });
  if (movErr) {
    console.error('[cnc] movimiento falló', movErr);
    return { consumida: true, costo_usd: u.costo_usd, aviso, movimiento_error: true };
  }

  // Costo en el movimiento
  if (movId && u.costo_usd != null) {
    await supabase.from('inv_movimientos')
      .update({ costo_unitario_usd: u.costo_usd, costo_verificado: true })
      .eq('id', movId);
  }

  return { consumida: true, costo_usd: u.costo_usd, aviso };
}

// ── Acciones ─────────────────────────────────────────────────────────────

async function accionResolverMueble(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  const emp = await verificarOperario(req.query.empleado_id);
  if (!emp) return err(res, 'No autorizado', 401);

  const codigo = normCod(req.query.codigo);
  if (!codigo) return err(res, 'codigo requerido');

  const { data: mc } = await supabase.from('mueble_codigos')
    .select('codigo, proyecto_id, mf_id')
    .eq('codigo', codigo).maybeSingle();
  if (!mc) return err(res, 'Etiqueta desconocida', 404);

  let proyecto_numero = null, proyecto_nombre = null, mueble_codigo = null, mueble_nombre = null;
  const { data: proy } = await supabase.from('proyectos_cache')
    .select('numero, nombre, muebles').eq('id', mc.proyecto_id).maybeSingle();
  if (proy) {
    proyecto_numero = proy.numero;
    proyecto_nombre = proy.nombre;
    const mubs = Array.isArray(proy.muebles) ? proy.muebles : [];
    const m = mubs.find(x => x.id === mc.mf_id);
    if (m) { mueble_codigo = m.codigo; mueble_nombre = m.nombre; }
  }

  return ok(res, {
    token: mc.codigo, proyecto_id: mc.proyecto_id, proyecto_numero, proyecto_nombre,
    mf_id: mc.mf_id, mueble_codigo, mueble_nombre
  });
}

async function accionResolverPlaca(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  const emp = await verificarOperario(req.query.empleado_id);
  if (!emp) return err(res, 'No autorizado', 401);

  const codigo = normCod(req.query.codigo);
  if (!codigo) return err(res, 'codigo requerido');

  const r = await _resolverPlaca(codigo);
  if (r.err) return err(res, r.err, r.status);
  return ok(res, r);
}

async function accionAbrirPlaca(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const b = req.body || {};
  const emp = await verificarOperario(b.empleado_id);
  if (!emp) return err(res, 'No autorizado', 401);

  const codigo = normCod(b.codigo);
  if (!codigo) return err(res, 'codigo requerido');
  if (!b.registro_trabajo_id) return err(res, 'registro_trabajo_id requerido');

  const r = await _resolverPlaca(codigo);
  if (r.err) return err(res, r.err, r.status);

  // Cerrar placa abierta de este registro (si hay)
  const { data: abiertas } = await supabase.from('registros_cnc')
    .select('id, unidad_id, registro_trabajo_id')
    .eq('registro_trabajo_id', b.registro_trabajo_id)
    .is('fin', null);
  for (const ab of (abiertas || [])) {
    await supabase.from('registros_cnc')
      .update({ fin: new Date().toISOString(), resultado: 'ok' })
      .eq('id', ab.id);
    if (ab.unidad_id) {
      // Resolver proyecto/mueble del registro de trabajo para el consumo
      const { data: reg } = await supabase.from('registros_trabajo')
        .select('proyecto_id, item_id').eq('id', ab.registro_trabajo_id).maybeSingle();
      if (reg) await _consumirUnidad(ab.unidad_id, reg.proyecto_id, reg.item_id, b.empleado_id);
    }
  }

  // Correlativo de placa dentro del registro
  const { count: prevCount } = await supabase.from('registros_cnc')
    .select('id', { count: 'exact', head: true })
    .eq('registro_trabajo_id', b.registro_trabajo_id);
  const placa_numero = (prevCount || 0) + 1;

  // Insertar
  const { data: nuevo, error: insErr } = await supabase.from('registros_cnc')
    .insert({
      registro_trabajo_id: b.registro_trabajo_id,
      empleado_id: b.empleado_id,
      inicio: new Date().toISOString(),
      maquina_codigo: b.maquina_codigo || null,
      mueble_token: b.mueble_token || null,
      unidad_id: r.unidad_id || null,
      item_id: r.item_id || null,
      placa_numero,
    })
    .select('id').single();
  if (insErr) return err(res, insErr.message, 500);

  return ok(res, {
    registro_cnc_id: nuevo.id,
    tipo: r.tipo,
    material: r.material,
    medida: r.medida,
    costo_usd: r.costo_usd,
    codigo: r.codigo,
  });
}

async function accionCerrarPlaca(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const b = req.body || {};
  const emp = await verificarOperario(b.empleado_id);
  if (!emp) return err(res, 'No autorizado', 401);

  if (!b.registro_cnc_id) return err(res, 'registro_cnc_id requerido');
  const resultado = b.resultado === 'error' ? 'error' : 'ok';

  const { data: fila } = await supabase.from('registros_cnc')
    .select('id, unidad_id, registro_trabajo_id, fin')
    .eq('id', b.registro_cnc_id).maybeSingle();
  if (!fila) return err(res, 'Registro no encontrado', 404);
  if (fila.fin) return err(res, 'La placa ya estaba cerrada', 409);

  await supabase.from('registros_cnc')
    .update({ fin: new Date().toISOString(), resultado })
    .eq('id', fila.id);

  let consumida = false, costo_usd = null, aviso = null;
  if (resultado === 'ok' && fila.unidad_id) {
    const { data: reg } = await supabase.from('registros_trabajo')
      .select('proyecto_id, item_id').eq('id', fila.registro_trabajo_id).maybeSingle();
    if (reg) {
      const cr = await _consumirUnidad(fila.unidad_id, reg.proyecto_id, reg.item_id, b.empleado_id);
      consumida = cr.consumida;
      costo_usd = cr.costo_usd;
      aviso = cr.aviso;
      if (cr.movimiento_error) {
        return ok(res, { consumida: true, costo_usd, aviso, msg: 'Placa descontada · avisar a oficina' });
      }
    }
  }

  const costoTxt = costo_usd != null ? 'US$ ' + Number(costo_usd).toFixed(2) : '';
  const msg = consumida
    ? (fila.unidad_id ? 'Placa descontada' + (costoTxt ? ' · ' + costoTxt : '') : 'Corte registrado')
    : 'Corte registrado · no descuenta stock';

  return ok(res, { consumida, costo_usd, aviso, msg });
}

async function accionPlacaAbierta(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  const emp = await verificarOperario(req.query.empleado_id);
  if (!emp) return err(res, 'No autorizado', 401);

  const rtId = req.query.registro_trabajo_id;
  if (!rtId) return err(res, 'registro_trabajo_id requerido');

  const { data: fila } = await supabase.from('registros_cnc')
    .select('id, unidad_id, item_id, inicio, maquina_codigo, mueble_token, placa_numero')
    .eq('registro_trabajo_id', rtId)
    .is('fin', null)
    .order('inicio', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!fila) return ok(res, { placa: null });

  // Resolver material/medida
  let material = '', medida = '';
  const itemId = fila.item_id;
  if (itemId) {
    const { data: it } = await supabase.from('inv_items')
      .select('descripcion, nombre_corto, espesor_mm, largo_cm, ancho_cm')
      .eq('id', itemId).maybeSingle();
    if (it) { material = _materialFromItem(it); medida = _medidaFromItem(it); }
  }

  return ok(res, { placa: { ...fila, material, medida } });
}

async function accionMetricasTv(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  // Sin auth: la TV no tiene sesión

  // Rango del día en UTC-3 (Uruguay, sin DST)
  const ahora = new Date();
  const uy = new Date(ahora.getTime() - 3 * 3600000);
  const hoyStr = uy.toISOString().slice(0, 10);
  const inicioHoy = new Date(hoyStr + 'T00:00:00-03:00').toISOString();
  const finHoy = new Date(hoyStr + 'T23:59:59.999-03:00').toISOString();

  // 7 días atrás
  const hace7 = new Date(uy.getTime() - 7 * 86400000);
  const hace7Str = hace7.toISOString().slice(0, 10);
  const inicio7d = new Date(hace7Str + 'T00:00:00-03:00').toISOString();

  const [{ count: placasHoy }, { count: total7d }, { count: conEtiqueta7d }] = await Promise.all([
    supabase.from('registros_cnc').select('id', { count: 'exact', head: true })
      .gte('inicio', inicioHoy).lte('inicio', finHoy),
    supabase.from('registros_cnc').select('id', { count: 'exact', head: true })
      .gte('inicio', inicio7d).lte('inicio', finHoy),
    supabase.from('registros_cnc').select('id', { count: 'exact', head: true })
      .gte('inicio', inicio7d).lte('inicio', finHoy)
      .not('unidad_id', 'is', null),
  ]);

  const pct = total7d > 0 ? Math.round(conEtiqueta7d / total7d * 100) : null;

  return ok(res, { placas_hoy: placasHoy || 0, total_7d: total7d || 0, con_etiqueta_7d: conEtiqueta7d || 0, pct });
}

// ── Handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;
  try {
    if (action === 'resolver-mueble')    return await accionResolverMueble(req, res);
    if (action === 'resolver-placa')     return await accionResolverPlaca(req, res);
    if (action === 'abrir-placa')        return await accionAbrirPlaca(req, res);
    if (action === 'cerrar-placa')       return await accionCerrarPlaca(req, res);
    if (action === 'placa-abierta')      return await accionPlacaAbierta(req, res);
    if (action === 'metricas-tv')        return await accionMetricasTv(req, res);
    return err(res, 'Acción no reconocida');
  } catch (e) {
    console.error('[cnc]', action, e);
    return err(res, e.message || 'Error interno', 500);
  }
}
