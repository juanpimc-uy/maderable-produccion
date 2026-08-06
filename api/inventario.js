// api/inventario.js — Endpoints de inventario (Node.js runtime, NO edge)
import { createClient } from '@supabase/supabase-js';
import { getZohoToken } from './_zoho-token-cache.js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

function ok(res, data)  { return res.status(200).json({ ok: true, ...data }); }
function err(res, msg, status = 400) { return res.status(status).json({ ok: false, msg }); }

async function verificarSesionAdminOficina(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (!token) return null;
  const { data } = await supabase
    .from('empleados')
    .select('id, rol_app, nombre')
    .eq('session_token', token)
    .gt('session_expires_at', new Date().toISOString())
    .maybeSingle();
  if (!data || (data.rol_app !== 'admin' && data.rol_app !== 'oficina')) return null;
  return data;
}

const FAMILIAS_VALIDAS = ['placa', 'madera', 'herraje', 'consumible', 'otro'];

// Convierte un monto de una moneda a USD usando tipo_cambio. Devuelve number o null.
// tipo_cambio: {moneda_origen, moneda_destino, valor}. Ej: UYU→USD valor 39 => 1 USD = 39 UYU.
async function _fetchTcUsd(moneda) {
  const m = (moneda || 'USD').toUpperCase();
  if (m === 'USD') return 1;
  const { data } = await supabase.from('tipo_cambio')
    .select('valor').eq('moneda_origen', m).eq('moneda_destino', 'USD')
    .order('actualizado_en', { ascending: false }).limit(1).maybeSingle();
  return (data && data.valor) ? Number(data.valor) : null;
}

// ── GET listar-items ──────────────────────────────────────────────────────
async function accionListarItems(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  const sesion = await verificarSesionAdminOficina(req);
  if (!sesion) return err(res, 'No autorizado', 401);

  const familia = (req.query.familia || '').trim();
  const q = (req.query.q || '').trim().toLowerCase();
  const activo = req.query.activo !== 'false';
  const sinZoho = req.query.sin_zoho === '1';

  let todos = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    let query = supabase.from('inv_items').select('*');
    if (activo) query = query.eq('activo', true);
    if (familia) query = query.eq('familia', familia);
    if (sinZoho) query = query.is('zoho_item_id', null);
    if (q) query = query.or(`codigo.ilike.%${q}%,descripcion.ilike.%${q}%`);
    query = query.order('codigo').range(offset, offset + PAGE - 1);
    const { data, error } = await query;
    if (error) return err(res, error.message, 500);
    if (!data || data.length === 0) break;
    todos = todos.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  return ok(res, { items: todos });
}

// ── POST crear-item ───────────────────────────────────────────────────────
async function accionCrearItem(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const sesion = await verificarSesionAdminOficina(req);
  if (!sesion) return err(res, 'No autorizado', 401);

  const b = req.body || {};
  const codigo = (b.codigo || '').trim().toUpperCase();
  const descripcion = (b.descripcion || '').trim();
  const familia = (b.familia || '').trim();

  if (!codigo) return err(res, 'codigo requerido');
  if (!descripcion) return err(res, 'descripcion requerida');
  if (!familia || !FAMILIAS_VALIDAS.includes(familia)) return err(res, `familia debe ser una de: ${FAMILIAS_VALIDAS.join(', ')}`);

  const fila = {
    codigo,
    descripcion,
    familia,
    creado_por: sesion.id,
  };
  if (b.unidad !== undefined) fila.unidad = b.unidad;
  if (b.stock_min !== undefined) fila.stock_min = b.stock_min;
  if (b.stock_max !== undefined) fila.stock_max = b.stock_max;
  if (b.inventariable !== undefined) fila.inventariable = b.inventariable;
  if (b.ubicacion_picking_id !== undefined) fila.ubicacion_picking_id = b.ubicacion_picking_id;

  const { data, error } = await supabase.from('inv_items').insert(fila).select().single();
  if (error) {
    if (error.code === '23505') return err(res, `El código "${codigo}" ya existe`, 409);
    return err(res, error.message, 500);
  }
  return ok(res, { item: data });
}

// ── POST editar-item ──────────────────────────────────────────────────────
async function accionEditarItem(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const sesion = await verificarSesionAdminOficina(req);
  if (!sesion) return err(res, 'No autorizado', 401);

  const b = req.body || {};
  const id = b.id;
  if (!id) return err(res, 'id requerido');

  const campos = {};
  if (b.codigo !== undefined) campos.codigo = String(b.codigo).trim().toUpperCase();
  if (b.descripcion !== undefined) campos.descripcion = b.descripcion;
  if (b.familia !== undefined) {
    if (!FAMILIAS_VALIDAS.includes(b.familia)) return err(res, `familia debe ser una de: ${FAMILIAS_VALIDAS.join(', ')}`);
    campos.familia = b.familia;
  }
  if (b.unidad !== undefined) campos.unidad = b.unidad;
  if (b.stock_min !== undefined) campos.stock_min = b.stock_min;
  if (b.stock_max !== undefined) campos.stock_max = b.stock_max;
  if (b.inventariable !== undefined) campos.inventariable = b.inventariable;
  if (b.activo !== undefined) campos.activo = b.activo;
  if (b.foto_url !== undefined) campos.foto_url = b.foto_url;
  if (b.ubicacion_picking_id !== undefined) campos.ubicacion_picking_id = b.ubicacion_picking_id;

  if (Object.keys(campos).length === 0) return err(res, 'Nada que actualizar');
  campos.actualizado_en = new Date().toISOString();

  const { data, error } = await supabase.from('inv_items').update(campos).eq('id', id).select().single();
  if (error) {
    if (error.code === '23505') return err(res, `Código duplicado`, 409);
    return err(res, error.message, 500);
  }
  if (!data) return err(res, 'Item no encontrado', 404);
  return ok(res, { item: data });
}

// ── POST sync-items-zoho ──────────────────────────────────────────────────
async function accionSyncItemsZoho(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const sesion = await verificarSesionAdminOficina(req);
  if (!sesion) return err(res, 'No autorizado', 401);

  const orgId = process.env.ZOHO_ORG_ID;
  const token = await getZohoToken();

  // 1) Fetch todos los items de Zoho con paginación
  let zohoItems = [];
  let page = 1;
  while (true) {
    const url = `https://www.zohoapis.com/books/v3/items?organization_id=${orgId}&page=${page}&per_page=200`;
    const r = await fetch(url, { headers: { 'Authorization': `Zoho-oauthtoken ${token}` } });
    if (!r.ok) return err(res, `Zoho API error ${r.status}`, 502);
    const json = await r.json();
    zohoItems = zohoItems.concat(json.items || []);
    if (!json.page_context || !json.page_context.has_more_page) break;
    page++;
  }

  // 2) Traer todos los inv_items con zoho_item_id (para saber cuáles ya existen)
  let existentes = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.from('inv_items')
      .select('id, codigo, zoho_item_id')
      .not('zoho_item_id', 'is', null)
      .range(offset, offset + 999);
    if (error) return err(res, error.message, 500);
    if (!data || data.length === 0) break;
    existentes = existentes.concat(data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  const mapZoho = new Map(existentes.map(e => [e.zoho_item_id, e]));

  // 3) Traer todos los codigos existentes para detectar colisiones
  let todosItems = [];
  offset = 0;
  while (true) {
    const { data, error } = await supabase.from('inv_items')
      .select('id, codigo, zoho_item_id')
      .range(offset, offset + 999);
    if (error) return err(res, error.message, 500);
    if (!data || data.length === 0) break;
    todosItems = todosItems.concat(data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  const codigosUsados = new Set(todosItems.map(i => i.codigo));

  let nuevos = 0, actualizados = 0;
  const colisiones = [];
  const paraInsertar = [];

  for (const zi of zohoItems) {
    const zohoItemId = String(zi.item_id);
    const sku = (zi.sku || '').trim().toUpperCase();
    const codigo = sku || ('Z-' + zohoItemId);
    const descripcion = zi.name || '';
    const activo = zi.status === 'active';
    const costoUsd = (zi.purchase_rate && Number(zi.purchase_rate)) ? Number(zi.purchase_rate) : null;

    const existente = mapZoho.get(zohoItemId);

    if (existente) {
      // UPDATE descripcion, activo y costo último (NO tocar costo_promedio_usd)
      const upd = { descripcion, activo, actualizado_en: new Date().toISOString() };
      if (costoUsd != null) upd.costo_ultimo_usd = costoUsd;
      const { error } = await supabase.from('inv_items').update(upd).eq('id', existente.id);
      if (!error) actualizados++;
    } else {
      // INSERT — pero verificar colisión de codigo
      if (codigosUsados.has(codigo)) {
        colisiones.push({ codigo, zoho_item_id: zohoItemId });
      } else {
        const esVentaPura = zi.item_type === 'sales' || zi.can_be_purchased === false;
        const cta = (zi.purchase_account_name || '').toUpperCase();
        let familia = 'otro';
        if (cta.includes('HERRAJE')) familia = 'herraje';
        else if (cta.includes('MADERA Y PLACA')) familia = 'placa';
        else if (cta.includes('INDIRECTO')) familia = 'consumible';
        const item = {
          codigo,
          descripcion,
          familia,
          zoho_item_id: zohoItemId,
          inventariable: !esVentaPura,
          activo,
        };
        if (costoUsd != null) item.costo_ultimo_usd = costoUsd;
        paraInsertar.push(item);
        codigosUsados.add(codigo); // evitar colisiones entre items del mismo batch
      }
    }
  }

  // Batch insert en lotes de 200
  for (let i = 0; i < paraInsertar.length; i += 200) {
    const lote = paraInsertar.slice(i, i + 200);
    const { error } = await supabase.from('inv_items').insert(lote);
    if (error) {
      console.error('[inventario] sync batch insert error:', error.message);
    } else {
      nuevos += lote.length;
    }
  }

  return ok(res, {
    total_zoho: zohoItems.length,
    nuevos,
    actualizados,
    colisiones,
  });
}

// ── GET listar-ubicaciones ────────────────────────────────────────────────
async function accionListarUbicaciones(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  const sesion = await verificarSesionAdminOficina(req);
  if (!sesion) return err(res, 'No autorizado', 401);

  const todas = req.query.todas === '1';
  let query = supabase.from('inv_ubicaciones').select('*').order('codigo');
  if (!todas) query = query.eq('activo', true);
  const { data, error } = await query;
  if (error) return err(res, error.message, 500);
  return ok(res, { ubicaciones: data || [] });
}

// ── POST crear-ubicacion ──────────────────────────────────────────────────
async function accionCrearUbicacion(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const sesion = await verificarSesionAdminOficina(req);
  if (!sesion) return err(res, 'No autorizado', 401);

  const b = req.body || {};
  const codigo = (b.codigo || '').trim().toUpperCase();
  const nombre = (b.nombre || '').trim();
  if (!codigo) return err(res, 'codigo requerido');
  if (!nombre) return err(res, 'nombre requerido');

  const fila = { codigo, nombre };
  if (b.parent_id !== undefined) fila.parent_id = b.parent_id;
  if (b.tipo !== undefined) fila.tipo = b.tipo;

  const { data, error } = await supabase.from('inv_ubicaciones').insert(fila).select().single();
  if (error) {
    if (error.code === '23505') return err(res, `El código "${codigo}" ya existe`, 409);
    return err(res, error.message, 500);
  }
  return ok(res, { ubicacion: data });
}

// ── POST editar-ubicacion ─────────────────────────────────────────────────
async function accionEditarUbicacion(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const sesion = await verificarSesionAdminOficina(req);
  if (!sesion) return err(res, 'No autorizado', 401);

  const b = req.body || {};
  const id = b.id;
  if (!id) return err(res, 'id requerido');

  const campos = {};
  if (b.nombre !== undefined) campos.nombre = b.nombre;
  if (b.parent_id !== undefined) campos.parent_id = b.parent_id;
  if (b.activo !== undefined) campos.activo = b.activo;
  if (b.tipo !== undefined) campos.tipo = b.tipo;

  if (Object.keys(campos).length === 0) return err(res, 'Nada que actualizar');

  const { data, error } = await supabase.from('inv_ubicaciones').update(campos).eq('id', id).select().single();
  if (error) return err(res, error.message, 500);
  if (!data) return err(res, 'Ubicación no encontrada', 404);
  return ok(res, { ubicacion: data });
}

// ── GET stock-item ────────────────────────────────────────────────────────
async function accionStockItem(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  const sesion = await verificarSesionAdminOficina(req);
  if (!sesion) return err(res, 'No autorizado', 401);

  const itemId = req.query.item_id;
  if (!itemId) return err(res, 'item_id requerido');

  const { data: stock, error } = await supabase
    .from('inv_stock')
    .select('item_id, ubicacion_id, cantidad, actualizado_en, inv_ubicaciones(id, codigo, nombre)')
    .eq('item_id', itemId)
    .neq('cantidad', 0);
  if (error) return err(res, error.message, 500);

  // Conteo de unidades serializadas activas por ubicación
  const { data: unidades } = await supabase
    .from('inv_unidades')
    .select('ubicacion_id')
    .eq('item_id', itemId)
    .eq('estado', 'activa');

  const unidadesPorUbi = {};
  for (const u of (unidades || [])) {
    unidadesPorUbi[u.ubicacion_id] = (unidadesPorUbi[u.ubicacion_id] || 0) + 1;
  }

  const filas = (stock || []).map(s => ({
    ...s,
    unidades_serializadas: unidadesPorUbi[s.ubicacion_id] || 0,
  }));

  const total = filas.reduce((sum, s) => sum + (s.cantidad || 0), 0);

  return ok(res, { item_id: itemId, total, stock: filas });
}

// ── GET stock-ubicacion ───────────────────────────────────────────────────
async function accionStockUbicacion(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  const sesion = await verificarSesionAdminOficina(req);
  if (!sesion) return err(res, 'No autorizado', 401);

  let ubicacionId = req.query.ubicacion_id;
  const codigo = (req.query.codigo || '').trim().toUpperCase();

  if (!ubicacionId && !codigo) return err(res, 'ubicacion_id o codigo requerido');

  if (!ubicacionId && codigo) {
    const { data: ubi } = await supabase.from('inv_ubicaciones')
      .select('id').eq('codigo', codigo).maybeSingle();
    if (!ubi) return err(res, 'Ubicación no encontrada', 404);
    ubicacionId = ubi.id;
  }

  const { data: stock, error } = await supabase
    .from('inv_stock')
    .select('item_id, cantidad, actualizado_en, inv_items(id, codigo, descripcion, familia, unidad)')
    .eq('ubicacion_id', ubicacionId)
    .neq('cantidad', 0);
  if (error) return err(res, error.message, 500);

  // Unidades serializadas activas en esta ubicación
  const { data: unidades } = await supabase
    .from('inv_unidades')
    .select('id, item_id, codigo, atributos, estado')
    .eq('ubicacion_id', ubicacionId)
    .eq('estado', 'activa');

  return ok(res, {
    ubicacion_id: ubicacionId,
    codigo: codigo || null,
    items: stock || [],
    unidades: unidades || [],
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// KIOSCO — Auth + actions de planta
// ═══════════════════════════════════════════════════════════════════════════

async function verificarOperario(empleadoId) {
  if (!empleadoId) return null;
  const { data } = await supabase.from('empleados')
    .select('id, nombre').eq('id', empleadoId).eq('activo', true).eq('archivado', false).maybeSingle();
  return data || null;
}

async function resolverUbiPorCodigo(codigo) {
  if (!codigo) return null;
  const { data } = await supabase.from('inv_ubicaciones')
    .select('id, codigo, nombre').eq('codigo', codigo.trim().toUpperCase()).eq('activo', true).maybeSingle();
  return data || null;
}

// ── GET resolver-codigo ───────────────────────────────────────────────────
async function accionResolverCodigo(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  const emp = await verificarOperario(req.query.empleado_id);
  if (!emp) return err(res, 'No autorizado', 401);

  const codigo = (req.query.codigo || '').trim().toUpperCase();
  if (!codigo) return err(res, 'codigo requerido');

  // 1) Ubicación
  const { data: ubi } = await supabase.from('inv_ubicaciones')
    .select('*').eq('codigo', codigo).eq('activo', true).maybeSingle();
  if (ubi) {
    const { data: stock } = await supabase.from('inv_stock')
      .select('item_id, cantidad, inv_items(id, codigo, descripcion, familia, unidad)')
      .eq('ubicacion_id', ubi.id).neq('cantidad', 0);
    return ok(res, { tipo: 'ubicacion', ubicacion: ubi, contenido: stock || [] });
  }

  // 2) Unidad serializada
  const { data: unidad } = await supabase.from('inv_unidades')
    .select('id, item_id, codigo, estado, inv_items(id, codigo, descripcion, familia)')
    .eq('codigo', codigo).eq('estado', 'activa').maybeSingle();
  if (unidad) return ok(res, { tipo: 'unidad', unidad, item: unidad.inv_items });

  // 3) Pieza de madera
  const { data: pieza } = await supabase.from('madera_piezas')
    .select('id').eq('qr_codigo', codigo).maybeSingle();
  if (pieza) return ok(res, { tipo: 'madera' });

  // 4) Ítem por código
  const { data: item } = await supabase.from('inv_items')
    .select('*').eq('codigo', codigo).eq('activo', true).maybeSingle();
  if (item) {
    const { data: stock } = await supabase.from('inv_stock')
      .select('ubicacion_id, cantidad, inv_ubicaciones(id, codigo, nombre)')
      .eq('item_id', item.id).neq('cantidad', 0);
    const total = (stock || []).reduce((s, r) => s + (r.cantidad || 0), 0);
    return ok(res, { tipo: 'item', item, stock: stock || [], total });
  }

  return err(res, 'no encontrado', 404);
}

// ── GET buscar-items-kiosco ───────────────────────────────────────────────
async function accionBuscarItemsKiosco(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  const emp = await verificarOperario(req.query.empleado_id);
  if (!emp) return err(res, 'No autorizado', 401);

  const q = (req.query.q || '').trim().toLowerCase();
  if (!q) return ok(res, { items: [] });

  const { data, error } = await supabase.from('inv_items')
    .select('id, codigo, descripcion, familia, foto_url, ubicacion_picking_id')
    .eq('activo', true).eq('inventariable', true)
    .or(`codigo.ilike.%${q}%,descripcion.ilike.%${q}%`)
    .order('codigo').limit(20);
  if (error) return err(res, error.message, 500);
  return ok(res, { items: data || [] });
}

// ── POST movimiento ──────────────────────────────────────────────────────
async function accionMovimiento(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const b = req.body || {};
  const emp = await verificarOperario(b.empleado_id);
  if (!emp) return err(res, 'No autorizado', 401);

  const tipo = (b.tipo || '').trim();
  const itemId = b.item_id;
  const cantidad = Number(b.cantidad);
  if (!tipo || !itemId) return err(res, 'tipo e item_id requeridos');

  // Resolve ubicaciones by codigo if needed
  let ubiId = b.ubicacion_id || null;
  let ubiDestinoId = b.ubicacion_destino_id || null;
  if (!ubiId && b.ubicacion_codigo) {
    const u = await resolverUbiPorCodigo(b.ubicacion_codigo);
    if (!u) return err(res, 'Ubicación origen no encontrada: ' + b.ubicacion_codigo, 404);
    ubiId = u.id;
  }
  if (!ubiDestinoId && b.ubicacion_destino_codigo) {
    const u = await resolverUbiPorCodigo(b.ubicacion_destino_codigo);
    if (!u) return err(res, 'Ubicación destino no encontrada: ' + b.ubicacion_destino_codigo, 404);
    ubiDestinoId = u.id;
  }

  // ── A PICKING ──
  if (b.a_picking) {
    const { data: item } = await supabase.from('inv_items').select('ubicacion_picking_id').eq('id', itemId).maybeSingle();
    if (!item || !item.ubicacion_picking_id) return err(res, 'El ítem no tiene ubicación de picking asignada');
    ubiDestinoId = item.ubicacion_picking_id;
    // Origen = bin con más stock distinto del picking
    const { data: stocks } = await supabase.from('inv_stock')
      .select('ubicacion_id, cantidad').eq('item_id', itemId).neq('cantidad', 0)
      .neq('ubicacion_id', ubiDestinoId).order('cantidad', { ascending: false }).limit(1);
    if (!stocks || !stocks.length) return err(res, 'Sin stock fuera del picking');
    ubiId = stocks[0].ubicacion_id;
    if (cantidad > stocks[0].cantidad) return err(res, 'Stock insuficiente (disponible: ' + stocks[0].cantidad + ')');
    const { data: rpcId, error: rpcErr } = await supabase.rpc('inv_registrar_movimiento', {
      p_tipo: 'traslado', p_item_id: itemId, p_ubicacion_id: ubiId,
      p_ubicacion_destino_id: ubiDestinoId, p_cantidad: cantidad,
      p_proyecto_id: null, p_mueble_id: null, p_motivo: null,
      p_origen: 'kiosco', p_empleado_id: b.empleado_id, p_nota: 'a picking'
    });
    if (rpcErr) return err(res, rpcErr.message, 500);
    return ok(res, { movimiento_id: rpcId });
  }

  // ── SALIDA (cascada) ──
  if (tipo === 'salida') {
    if (!cantidad || cantidad <= 0) return err(res, 'cantidad debe ser > 0');
    const motivo = (b.motivo || '').trim();
    if (!['consumo_proyecto', 'venta', 'descarte'].includes(motivo)) return err(res, 'motivo requerido: consumo_proyecto|venta|descarte');
    if (motivo === 'consumo_proyecto' && !b.proyecto_id) return err(res, 'proyecto_id requerido para consumo_proyecto');

    if (ubiId) {
      // Salida de un bin específico
      const { data: rpcId, error: rpcErr } = await supabase.rpc('inv_registrar_movimiento', {
        p_tipo: 'salida', p_item_id: itemId, p_ubicacion_id: ubiId,
        p_ubicacion_destino_id: null, p_cantidad: cantidad,
        p_proyecto_id: b.proyecto_id || null, p_mueble_id: b.mueble_id || null,
        p_motivo: motivo, p_origen: 'kiosco', p_empleado_id: b.empleado_id, p_nota: b.nota || null
      });
      if (rpcErr) return err(res, rpcErr.message, 500);
      return ok(res, { movimiento_id: rpcId, desglose: [{ ubicacion_id: ubiId, cantidad }] });
    }

    // Cascada: picking primero, luego el bin con más stock
    const { data: item } = await supabase.from('inv_items').select('ubicacion_picking_id').eq('id', itemId).maybeSingle();
    const pickingId = item ? item.ubicacion_picking_id : null;
    const { data: stocks } = await supabase.from('inv_stock')
      .select('ubicacion_id, cantidad').eq('item_id', itemId).neq('cantidad', 0).order('cantidad', { ascending: false });
    if (!stocks || !stocks.length) return err(res, 'Sin stock');

    // Reorder: picking first
    const ordered = [];
    if (pickingId) {
      const pi = stocks.find(s => s.ubicacion_id === pickingId);
      if (pi) ordered.push(pi);
      stocks.forEach(s => { if (s.ubicacion_id !== pickingId) ordered.push(s); });
    } else {
      ordered.push(...stocks);
    }

    const totalDisp = ordered.reduce((s, r) => s + r.cantidad, 0);
    if (cantidad > totalDisp) return err(res, 'Stock insuficiente (disponible: ' + totalDisp + ')');

    let restante = cantidad;
    const desglose = [];
    for (const bin of ordered) {
      if (restante <= 0) break;
      const desc = Math.min(restante, bin.cantidad);
      const { data: rpcId, error: rpcErr } = await supabase.rpc('inv_registrar_movimiento', {
        p_tipo: 'salida', p_item_id: itemId, p_ubicacion_id: bin.ubicacion_id,
        p_ubicacion_destino_id: null, p_cantidad: desc,
        p_proyecto_id: b.proyecto_id || null, p_mueble_id: b.mueble_id || null,
        p_motivo: motivo, p_origen: 'kiosco', p_empleado_id: b.empleado_id, p_nota: b.nota || null
      });
      if (rpcErr) return err(res, rpcErr.message, 500);
      desglose.push({ ubicacion_id: bin.ubicacion_id, cantidad: desc, movimiento_id: rpcId });
      restante -= desc;
    }
    return ok(res, { desglose });
  }

  // ── ENTRADA ──
  if (tipo === 'entrada') {
    if (!cantidad || cantidad <= 0) return err(res, 'cantidad debe ser > 0');
    if (!ubiId) return err(res, 'ubicacion requerida para entrada');
    const { data: rpcId, error: rpcErr } = await supabase.rpc('inv_registrar_movimiento', {
      p_tipo: 'entrada', p_item_id: itemId, p_ubicacion_id: ubiId,
      p_ubicacion_destino_id: null, p_cantidad: cantidad,
      p_proyecto_id: null, p_mueble_id: null, p_motivo: null,
      p_origen: 'kiosco', p_empleado_id: b.empleado_id, p_nota: b.nota || null
    });
    if (rpcErr) return err(res, rpcErr.message, 500);
    return ok(res, { movimiento_id: rpcId });
  }

  // ── TRASLADO ──
  if (tipo === 'traslado') {
    if (!cantidad || cantidad <= 0) return err(res, 'cantidad debe ser > 0');
    if (!ubiId) return err(res, 'ubicacion origen requerida');
    if (!ubiDestinoId) return err(res, 'ubicacion destino requerida');
    const { data: rpcId, error: rpcErr } = await supabase.rpc('inv_registrar_movimiento', {
      p_tipo: 'traslado', p_item_id: itemId, p_ubicacion_id: ubiId,
      p_ubicacion_destino_id: ubiDestinoId, p_cantidad: cantidad,
      p_proyecto_id: null, p_mueble_id: null, p_motivo: null,
      p_origen: 'kiosco', p_empleado_id: b.empleado_id, p_nota: b.nota || null
    });
    if (rpcErr) return err(res, rpcErr.message, 500);
    return ok(res, { movimiento_id: rpcId });
  }

  // ── AJUSTE ──
  if (tipo === 'ajuste') {
    if (!ubiId) return err(res, 'ubicacion requerida para ajuste');
    const nuevoVal = Number(b.ajuste_valor_nuevo);
    if (isNaN(nuevoVal) || nuevoVal < 0) return err(res, 'ajuste_valor_nuevo debe ser >= 0');
    // Leer valor actual
    const { data: stockRow } = await supabase.from('inv_stock')
      .select('cantidad').eq('item_id', itemId).eq('ubicacion_id', ubiId).maybeSingle();
    const anterior = stockRow ? stockRow.cantidad : 0;
    const { data: rpcId, error: rpcErr } = await supabase.rpc('inv_registrar_movimiento', {
      p_tipo: 'ajuste', p_item_id: itemId, p_ubicacion_id: ubiId,
      p_ubicacion_destino_id: null, p_cantidad: nuevoVal,
      p_proyecto_id: null, p_mueble_id: null, p_motivo: null,
      p_origen: 'kiosco', p_empleado_id: b.empleado_id, p_nota: 'conteo: ' + anterior + '→' + nuevoVal
    });
    if (rpcErr) return err(res, rpcErr.message, 500);
    return ok(res, { movimiento_id: rpcId, anterior, nuevo: nuevoVal });
  }

  return err(res, 'tipo inválido: ' + tipo);
}

// ── POST alta-rapida ─────────────────────────────────────────────────────
async function accionAltaRapida(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const b = req.body || {};
  const emp = await verificarOperario(b.empleado_id);
  if (!emp) return err(res, 'No autorizado', 401);

  const codigo = (b.codigo || '').trim().toUpperCase();
  const descripcion = (b.descripcion || '').trim();
  const familia = (b.familia || '').trim();
  if (!codigo) return err(res, 'codigo requerido');
  if (!descripcion) return err(res, 'descripcion requerida');
  if (!familia || !FAMILIAS_VALIDAS.includes(familia)) return err(res, 'familia inválida');

  const ubiCodigo = (b.ubicacion_codigo || '').trim().toUpperCase();
  if (!ubiCodigo) return err(res, 'ubicacion_codigo requerido');
  const ubi = await resolverUbiPorCodigo(ubiCodigo);
  if (!ubi) return err(res, 'Ubicación no encontrada: ' + ubiCodigo, 404);

  const cantidad = Number(b.cantidad);
  if (!cantidad || cantidad <= 0) return err(res, 'cantidad debe ser > 0');

  // Crear ítem
  const fila = { codigo, descripcion, familia, inventariable: true, creado_por: emp.id };
  if (b.unidad !== undefined) fila.unidad = b.unidad;

  const { data: item, error: itemErr } = await supabase.from('inv_items').insert(fila).select().single();
  if (itemErr) {
    if (itemErr.code === '23505') return err(res, 'El código "' + codigo + '" ya existe', 409);
    return err(res, itemErr.message, 500);
  }

  // Foto (best-effort)
  let fotoUrl = null;
  let fotoError = null;
  if (b.foto_base64) {
    try {
      const base64 = b.foto_base64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      const path = codigo + '.jpg';
      const { error: upErr } = await supabase.storage.from('inv-fotos').upload(path, buffer, {
        contentType: 'image/jpeg', upsert: true
      });
      if (upErr) {
        fotoError = upErr.message;
      } else {
        const { data: urlData } = supabase.storage.from('inv-fotos').getPublicUrl(path);
        fotoUrl = urlData ? urlData.publicUrl : null;
        if (fotoUrl) {
          await supabase.from('inv_items').update({ foto_url: fotoUrl }).eq('id', item.id);
          item.foto_url = fotoUrl;
        }
      }
    } catch (e) {
      fotoError = e.message;
    }
  }

  // Entrada de stock
  const { error: rpcErr } = await supabase.rpc('inv_registrar_movimiento', {
    p_tipo: 'entrada', p_item_id: item.id, p_ubicacion_id: ubi.id,
    p_ubicacion_destino_id: null, p_cantidad: cantidad,
    p_proyecto_id: null, p_mueble_id: null, p_motivo: null,
    p_origen: 'kiosco', p_empleado_id: b.empleado_id, p_nota: 'alta rápida'
  });
  if (rpcErr) return err(res, rpcErr.message, 500);

  const result = { item, ubicacion: ubi, cantidad };
  if (fotoError) result.foto_error = fotoError;
  return ok(res, result);
}

// ── Handler ───────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const action = req.query.action;
  try {
    // Oficina
    if (action === 'listar-items')        return await accionListarItems(req, res);
    if (action === 'crear-item')          return await accionCrearItem(req, res);
    if (action === 'editar-item')         return await accionEditarItem(req, res);
    if (action === 'sync-items-zoho')     return await accionSyncItemsZoho(req, res);
    if (action === 'listar-ubicaciones')  return await accionListarUbicaciones(req, res);
    if (action === 'crear-ubicacion')     return await accionCrearUbicacion(req, res);
    if (action === 'editar-ubicacion')    return await accionEditarUbicacion(req, res);
    if (action === 'stock-item')          return await accionStockItem(req, res);
    if (action === 'stock-ubicacion')     return await accionStockUbicacion(req, res);
    // Kiosco
    if (action === 'resolver-codigo')     return await accionResolverCodigo(req, res);
    if (action === 'buscar-items-kiosco') return await accionBuscarItemsKiosco(req, res);
    if (action === 'movimiento')          return await accionMovimiento(req, res);
    if (action === 'alta-rapida')         return await accionAltaRapida(req, res);
    return err(res, 'Acción no reconocida');
  } catch (e) {
    console.error('[inventario]', action, e);
    return err(res, 'Error interno', 500);
  }
}
