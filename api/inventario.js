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
    .select('id, item_id, codigo, estado, atributos, ubicacion_id, costo_usd, reserva_proyecto_id, proyecto_consumo_id, mueble_consumo_id, inv_items(id, codigo, descripcion, familia), inv_ubicaciones:ubicacion_id(id, codigo, nombre)')
    .eq('codigo', codigo).maybeSingle();
  if (unidad) {
    const uData = {
      id: unidad.id, item_id: unidad.item_id, codigo: unidad.codigo,
      estado: unidad.estado, atributos: unidad.atributos,
      ubicacion_id: unidad.ubicacion_id, reserva_proyecto_id: unidad.reserva_proyecto_id,
      ubicacion: unidad.inv_ubicaciones || null,
    };
    // Resolver nombre de proyecto de reserva
    let reserva_nombre = null;
    if (unidad.reserva_proyecto_id) {
      const { data: proy } = await supabase.from('proyectos_cache')
        .select('numero, nombre').eq('id', unidad.reserva_proyecto_id).maybeSingle();
      reserva_nombre = proy ? ((proy.numero || '') + ' · ' + (proy.nombre || '')).trim() : unidad.reserva_proyecto_id;
    }
    return ok(res, { tipo: 'unidad', unidad: uData, item: unidad.inv_items, reserva_nombre });
  }

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

// ── GET valor-inventario (solo lectura) ──────────────────────────────────
async function accionValorInventario(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  const sesion = await verificarSesionAdminOficina(req);
  if (!sesion) return err(res, 'No autorizado', 401);

  // 1. Serializado: inv_unidades activas con costo_usd, paginado
  let unidades = [];
  let from = 0;
  const CHUNK = 1000;
  while (true) {
    const { data } = await supabase.from('inv_unidades')
      .select('costo_usd, item_id, ubicacion_id')
      .eq('estado', 'activa')
      .range(from, from + CHUNK - 1);
    if (!data || !data.length) break;
    unidades = unidades.concat(data);
    if (data.length < CHUNK) break;
    from += CHUNK;
  }

  // 2. Por cantidad: inv_stock con cantidad>0 + item (familia, costo_promedio_usd), paginado
  let stockRows = [];
  from = 0;
  while (true) {
    const { data } = await supabase.from('inv_stock')
      .select('item_id, ubicacion_id, cantidad, inv_items(familia, costo_promedio_usd)')
      .gt('cantidad', 0)
      .range(from, from + CHUNK - 1);
    if (!data || !data.length) break;
    stockRows = stockRows.concat(data);
    if (data.length < CHUNK) break;
    from += CHUNK;
  }

  // 3. Ubicaciones lookup (para nombres)
  const ubiIds = new Set();
  unidades.forEach(u => ubiIds.add(u.ubicacion_id));
  stockRows.forEach(s => ubiIds.add(s.ubicacion_id));
  let ubiMap = {};
  if (ubiIds.size) {
    const ids = [...ubiIds].filter(Boolean);
    // Paginar en chunks de 1000 ids
    for (let i = 0; i < ids.length; i += CHUNK) {
      const batch = ids.slice(i, i + CHUNK);
      const { data } = await supabase.from('inv_ubicaciones')
        .select('id, codigo, nombre').in('id', batch);
      (data || []).forEach(u => { ubiMap[u.id] = u; });
    }
  }

  // 4. Items lookup (para familia de unidades serializadas)
  const itemIds = new Set();
  unidades.forEach(u => itemIds.add(u.item_id));
  let itemMap = {};
  if (itemIds.size) {
    const ids = [...itemIds].filter(Boolean);
    for (let i = 0; i < ids.length; i += CHUNK) {
      const batch = ids.slice(i, i + CHUNK);
      const { data } = await supabase.from('inv_items')
        .select('id, familia').in('id', batch);
      (data || []).forEach(it => { itemMap[it.id] = it; });
    }
  }

  // 5. Calcular totales
  let serializadoUsd = 0;
  let serializadoVerificado = 0;
  const familiaAcc = {};
  const ubiAcc = {}; // { ubiId: { valor, verificado } }

  for (const u of unidades) {
    const costo = Number(u.costo_usd || 0);
    serializadoUsd += costo;
    // Simplificación: costo_usd > 0 = verificado (de recepción); retazos a 0 no suman
    const esVerif = costo > 0;
    if (esVerif) serializadoVerificado += costo;
    const fam = (itemMap[u.item_id] || {}).familia || 'otro';
    familiaAcc[fam] = (familiaAcc[fam] || 0) + costo;
    const uid = u.ubicacion_id || 0;
    if (!ubiAcc[uid]) ubiAcc[uid] = { valor: 0, verificado: 0 };
    ubiAcc[uid].valor += costo;
    if (esVerif) ubiAcc[uid].verificado += costo;
  }

  let cantidadUsd = 0;
  let cantidadVerificado = 0;
  for (const s of stockRows) {
    const it = s.inv_items || {};
    const prom = Number(it.costo_promedio_usd || 0);
    const cant = Number(s.cantidad || 0);
    const valor = cant * prom;
    cantidadUsd += valor;
    // Simplificación: costo_promedio_usd > 0 = verificado (solo se llena por recepción)
    const esVerif = prom > 0;
    if (esVerif) cantidadVerificado += valor;
    const fam = it.familia || 'otro';
    familiaAcc[fam] = (familiaAcc[fam] || 0) + valor;
    const uid = s.ubicacion_id || 0;
    if (!ubiAcc[uid]) ubiAcc[uid] = { valor: 0, verificado: 0 };
    ubiAcc[uid].valor += valor;
    if (esVerif) ubiAcc[uid].verificado += valor;
  }

  const totalUsd = serializadoUsd + cantidadUsd;
  const verificadoUsd = serializadoVerificado + cantidadVerificado;
  const estimadoUsd = totalUsd - verificadoUsd;

  // TC actual
  const tcActual = await _fetchTcUsd('UYU') || 1;
  const totalUyu = totalUsd * tcActual;

  // Por familia
  const porFamilia = Object.entries(familiaAcc).map(([familia, valor_usd]) => ({ familia, valor_usd }))
    .sort((a, b) => b.valor_usd - a.valor_usd);

  // Por ubicación top 10
  const porUbicacion = Object.entries(ubiAcc)
    .map(([uid, acc]) => {
      const u = ubiMap[uid] || {};
      return { codigo: u.codigo || '?', nombre: u.nombre || '', valor_usd: acc.valor, pct_verificado: acc.valor > 0 ? Math.round(acc.verificado / acc.valor * 100) : 0 };
    })
    .filter(x => x.valor_usd > 0)
    .sort((a, b) => b.valor_usd - a.valor_usd)
    .slice(0, 10);

  return ok(res, {
    total_usd: totalUsd,
    serializado_usd: serializadoUsd,
    cantidad_usd: cantidadUsd,
    verificado_usd: verificadoUsd,
    estimado_usd: estimadoUsd,
    tc_actual: tcActual,
    total_uyu: totalUyu,
    por_familia: porFamilia,
    por_ubicacion: porUbicacion,
  });
}

// ── POST consumir-unidad ─────────────────────────────────────────────────
async function accionConsumirUnidad(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const b = req.body || {};
  const emp = await verificarOperario(b.empleado_id);
  if (!emp) return err(res, 'No autorizado', 401);

  const codigo = (b.codigo || '').trim().toUpperCase();
  if (!codigo) return err(res, 'codigo requerido');
  if (!b.proyecto_id) return err(res, 'proyecto_id requerido');

  const { data: unidad } = await supabase.from('inv_unidades')
    .select('id, item_id, ubicacion_id, costo_usd, reserva_proyecto_id')
    .eq('codigo', codigo).eq('estado', 'activa').maybeSingle();
  if (!unidad) return err(res, 'Unidad no encontrada o no activa', 404);

  // Guard de reserva
  if (unidad.reserva_proyecto_id && unidad.reserva_proyecto_id !== b.proyecto_id && !b.forzar_reserva) {
    let reserva_nombre = unidad.reserva_proyecto_id;
    const { data: proy } = await supabase.from('proyectos_cache')
      .select('numero, nombre').eq('id', unidad.reserva_proyecto_id).maybeSingle();
    if (proy) reserva_nombre = ((proy.numero || '') + ' · ' + (proy.nombre || '')).trim();
    return res.status(200).json({ ok: false, requiere_confirmacion: true, reserva_nombre });
  }

  // Consumir: actualizar unidad
  const { error: updErr } = await supabase.from('inv_unidades')
    .update({ estado: 'consumida', proyecto_consumo_id: b.proyecto_id, mueble_consumo_id: b.mueble_id || null, consumido_en: new Date().toISOString() })
    .eq('id', unidad.id);
  if (updErr) return err(res, updErr.message, 500);

  // Movimiento de salida
  const { data: movId, error: movErr } = await supabase.rpc('inv_registrar_movimiento', {
    p_tipo: 'salida', p_item_id: unidad.item_id, p_ubicacion_id: unidad.ubicacion_id,
    p_ubicacion_destino_id: null, p_cantidad: 1,
    p_proyecto_id: b.proyecto_id, p_mueble_id: b.mueble_id || null,
    p_motivo: 'consumo_proyecto', p_origen: 'kiosco', p_empleado_id: b.empleado_id,
    p_nota: 'Placa ' + codigo,
  });
  if (movErr) return err(res, movErr.message, 500);

  // Setear costo en el movimiento
  if (movId && unidad.costo_usd != null) {
    await supabase.from('inv_movimientos')
      .update({ costo_unitario_usd: unidad.costo_usd, costo_verificado: true })
      .eq('id', movId);
  }

  return ok(res, { codigo, proyecto_id: b.proyecto_id });
}

// ── POST trasladar-unidad ───────────────────────────────────────────────
async function accionTrasladarUnidad(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const b = req.body || {};
  const emp = await verificarOperario(b.empleado_id);
  if (!emp) return err(res, 'No autorizado', 401);

  const codigo = (b.codigo || '').trim().toUpperCase();
  if (!codigo) return err(res, 'codigo requerido');
  const destCodigo = (b.ubicacion_destino_codigo || '').trim().toUpperCase();
  if (!destCodigo) return err(res, 'ubicacion_destino_codigo requerido');

  const { data: unidad } = await supabase.from('inv_unidades')
    .select('id, item_id, ubicacion_id')
    .eq('codigo', codigo).eq('estado', 'activa').maybeSingle();
  if (!unidad) return err(res, 'Unidad no encontrada o no activa', 404);

  const destino = await resolverUbiPorCodigo(destCodigo);
  if (!destino) return err(res, 'Ubicación destino no encontrada: ' + destCodigo, 404);
  if (destino.id === unidad.ubicacion_id) return err(res, 'La unidad ya está en esa ubicación');

  // Movimiento traslado
  const { error: movErr } = await supabase.rpc('inv_registrar_movimiento', {
    p_tipo: 'traslado', p_item_id: unidad.item_id, p_ubicacion_id: unidad.ubicacion_id,
    p_ubicacion_destino_id: destino.id, p_cantidad: 1,
    p_proyecto_id: null, p_mueble_id: null, p_motivo: null,
    p_origen: 'kiosco', p_empleado_id: b.empleado_id, p_nota: 'Placa ' + codigo,
  });
  if (movErr) return err(res, movErr.message, 500);

  // Actualizar ubicación de la unidad
  await supabase.from('inv_unidades').update({ ubicacion_id: destino.id }).eq('id', unidad.id);

  return ok(res, { codigo, ubicacion_destino: destCodigo });
}

// ── POST descartar-unidad ───────────────────────────────────────────────
async function accionDescartarUnidad(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const b = req.body || {};
  const emp = await verificarOperario(b.empleado_id);
  if (!emp) return err(res, 'No autorizado', 401);

  const codigo = (b.codigo || '').trim().toUpperCase();
  if (!codigo) return err(res, 'codigo requerido');

  const { data: unidad } = await supabase.from('inv_unidades')
    .select('id, item_id, ubicacion_id, costo_usd')
    .eq('codigo', codigo).eq('estado', 'activa').maybeSingle();
  if (!unidad) return err(res, 'Unidad no encontrada o no activa', 404);

  // Actualizar estado
  const { error: updErr } = await supabase.from('inv_unidades')
    .update({ estado: 'descartada', consumido_en: new Date().toISOString() })
    .eq('id', unidad.id);
  if (updErr) return err(res, updErr.message, 500);

  // Movimiento de salida
  const { data: movId, error: movErr } = await supabase.rpc('inv_registrar_movimiento', {
    p_tipo: 'salida', p_item_id: unidad.item_id, p_ubicacion_id: unidad.ubicacion_id,
    p_ubicacion_destino_id: null, p_cantidad: 1,
    p_proyecto_id: null, p_mueble_id: null, p_motivo: 'descarte',
    p_origen: 'kiosco', p_empleado_id: b.empleado_id,
    p_nota: 'Placa ' + codigo + (b.motivo ? ' — ' + b.motivo : ''),
  });
  if (movErr) return err(res, movErr.message, 500);

  if (movId && unidad.costo_usd != null) {
    await supabase.from('inv_movimientos')
      .update({ costo_unitario_usd: unidad.costo_usd, costo_verificado: true })
      .eq('id', movId);
  }

  return ok(res, { codigo });
}

// ── POST setear-reserva-unidad ──────────────────────────────────────────
async function accionSetearReservaUnidad(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const b = req.body || {};
  const emp = await verificarOperario(b.empleado_id);
  if (!emp) return err(res, 'No autorizado', 401);

  const codigo = (b.codigo || '').trim().toUpperCase();
  if (!codigo) return err(res, 'codigo requerido');

  const { data: unidad } = await supabase.from('inv_unidades')
    .select('id').eq('codigo', codigo).eq('estado', 'activa').maybeSingle();
  if (!unidad) return err(res, 'Unidad no encontrada o no activa', 404);

  const { error } = await supabase.from('inv_unidades')
    .update({ reserva_proyecto_id: b.reserva_proyecto_id || null })
    .eq('id', unidad.id);
  if (error) return err(res, error.message, 500);

  return ok(res, { codigo, reserva_proyecto_id: b.reserva_proyecto_id || null });
}

// ── GET items-reposicion (solo lectura) ──────────────────────────────────
async function accionItemsReposicion(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  const sesion = await verificarSesionAdminOficina(req);
  if (!sesion) return err(res, 'No autorizado', 401);

  const CHUNK = 1000;

  // 1. Traer ítems inventariables por cantidad (no placa/madera)
  let items = [];
  let from = 0;
  while (true) {
    const { data } = await supabase.from('inv_items')
      .select('id, codigo, descripcion, familia, stock_min, costo_promedio_usd')
      .eq('inventariable', true).eq('activo', true)
      .not('familia', 'in', '("placa","madera")')
      .range(from, from + CHUNK - 1);
    if (!data || !data.length) break;
    items = items.concat(data);
    if (data.length < CHUNK) break;
    from += CHUNK;
  }

  // 2. Stock total por ítem (todas las filas de inv_stock, paginado)
  const stockMap = {}; // item_id → total
  from = 0;
  while (true) {
    const { data } = await supabase.from('inv_stock')
      .select('item_id, cantidad')
      .range(from, from + CHUNK - 1);
    if (!data || !data.length) break;
    for (const s of data) {
      stockMap[s.item_id] = (stockMap[s.item_id] || 0) + Number(s.cantidad || 0);
    }
    if (data.length < CHUNK) break;
    from += CHUNK;
  }

  // 3. Ítems que rotaron: los que tienen fila en inv_stock (aunque sea 0)
  // Simplificación: si item_id aparece en stockMap, tuvo stock alguna vez
  const tuvoStock = new Set(Object.keys(stockMap).map(Number));

  // 4. Filtrar y armar resultado
  const resultado = [];
  for (const it of items) {
    const stockActual = stockMap[it.id] || 0;
    const minDef = it.stock_min != null && Number(it.stock_min) > 0;

    let incluir = false;
    let motivo = '';

    if (minDef && stockActual < Number(it.stock_min)) {
      incluir = true;
      motivo = 'bajo_minimo';
    } else if (stockActual <= 0 && tuvoStock.has(it.id)) {
      incluir = true;
      motivo = 'sin_stock';
    }

    if (!incluir) continue;

    resultado.push({
      codigo: it.codigo,
      descripcion: it.descripcion,
      familia: it.familia,
      stock_actual: stockActual,
      stock_min: minDef ? Number(it.stock_min) : null,
      faltante: minDef ? Math.max(0, Number(it.stock_min) - stockActual) : null,
      motivo,
    });
  }

  // 5. Ordenar: faltante desc (bajo_minimo primero), luego sin_stock
  resultado.sort((a, b) => {
    if (a.motivo !== b.motivo) return a.motivo === 'bajo_minimo' ? -1 : 1;
    if (a.faltante != null && b.faltante != null) return b.faltante - a.faltante;
    return 0;
  });

  return ok(res, { total: resultado.length, items: resultado });
}

// ── POST descontar-kitting (server-to-server) ───────────────────────────
async function accionDescontarKitting(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const secret = req.headers['x-internal-secret'] || '';
  if (!secret || secret !== process.env.INTERNAL_SECRET) return err(res, 'No autorizado', 401);

  const b = req.body || {};
  const { so_zoho_id, linea_zoho_id, item_zoho_id, cantidad_armada, proyecto_id, empleado_id } = b;
  if (!so_zoho_id || !linea_zoho_id) return err(res, 'so_zoho_id y linea_zoho_id requeridos');

  // 1. Sin item_zoho_id → no se puede resolver
  if (!item_zoho_id) return ok(res, { skip: 'sin_item_zoho' });

  // 2. Buscar ítem en catálogo
  const { data: invItem } = await supabase.from('inv_items')
    .select('id, familia, ubicacion_picking_id, costo_promedio_usd')
    .eq('zoho_item_id', item_zoho_id).maybeSingle();
  if (!invItem) return ok(res, { skip: 'no_catalogado', item_zoho_id });

  // 3. Serializado → no descontar (se consume por escaneo)
  if (invItem.familia === 'placa' || invItem.familia === 'madera') {
    return ok(res, { skip: 'serializado' });
  }

  // 4. Delta: leer cuánto ya se descontó
  const { data: lineaEst } = await supabase.from('so_lineas_estado')
    .select('cantidad_descontada_inv')
    .eq('so_zoho_id', so_zoho_id).eq('linea_zoho_id', linea_zoho_id).maybeSingle();
  const yaDescontado = Number((lineaEst || {}).cantidad_descontada_inv || 0);
  const armado = Number(cantidad_armada || 0);
  const delta = armado - yaDescontado;

  if (delta === 0) return ok(res, { delta: 0 });

  const empId = empleado_id || null;
  const costoUsd = invItem.costo_promedio_usd ? Number(invItem.costo_promedio_usd) : null;
  const costoVerif = costoUsd != null && costoUsd > 0;

  if (delta > 0) {
    // SALIDA — cascada: picking primero, luego bin con más stock
    const pickingId = invItem.ubicacion_picking_id || null;
    const { data: stocks } = await supabase.from('inv_stock')
      .select('ubicacion_id, cantidad').eq('item_id', invItem.id).gt('cantidad', 0)
      .order('cantidad', { ascending: false });

    const ordered = [];
    if (pickingId && stocks) {
      const pi = stocks.find(s => s.ubicacion_id === pickingId);
      if (pi) ordered.push(pi);
      stocks.forEach(s => { if (s.ubicacion_id !== pickingId) ordered.push(s); });
    } else if (stocks) {
      ordered.push(...stocks);
    }

    const totalDisp = ordered.reduce((s, r) => s + Number(r.cantidad), 0);
    // Descontar lo que haya, sin frenar si no alcanza
    const aDescontar = Math.min(delta, totalDisp);
    let restante = aDescontar;
    const desglose = [];

    for (const bin of ordered) {
      if (restante <= 0) break;
      const desc = Math.min(restante, Number(bin.cantidad));
      const { data: movId, error: movErr } = await supabase.rpc('inv_registrar_movimiento', {
        p_tipo: 'salida', p_item_id: invItem.id, p_ubicacion_id: bin.ubicacion_id,
        p_ubicacion_destino_id: null, p_cantidad: desc,
        p_proyecto_id: proyecto_id || null, p_mueble_id: null,
        p_motivo: 'kitting', p_origen: 'kitting', p_empleado_id: empId,
        p_nota: 'SO ' + (so_zoho_id || ''),
      });
      if (movErr) { console.warn('[descontar-kitting] movErr', movErr.message); break; }
      // Setear costo
      if (movId && costoUsd != null) {
        await supabase.from('inv_movimientos')
          .update({ costo_unitario_usd: costoUsd, costo_verificado: costoVerif })
          .eq('id', movId);
      }
      desglose.push({ ubicacion_id: bin.ubicacion_id, cantidad: desc });
      restante -= desc;
    }

    // Actualizar tracking (sumar lo efectivamente descontado)
    const efectivo = aDescontar - restante;
    await supabase.from('so_lineas_estado')
      .update({ cantidad_descontada_inv: yaDescontado + efectivo, item_zoho_id })
      .eq('so_zoho_id', so_zoho_id).eq('linea_zoho_id', linea_zoho_id);

    return ok(res, { delta, descontado: efectivo, faltante: delta - efectivo, desglose });

  } else {
    // delta < 0 → ENTRADA (devolución al picking)
    const cantDevolver = Math.abs(delta);
    const destUbiId = invItem.ubicacion_picking_id;
    if (!destUbiId) {
      // Sin picking → buscar cualquier bin con stock del ítem
      const { data: anyBin } = await supabase.from('inv_stock')
        .select('ubicacion_id').eq('item_id', invItem.id).order('cantidad', { ascending: false }).limit(1).maybeSingle();
      if (!anyBin) return ok(res, { delta, skip: 'sin_ubicacion_destino' });
    }
    const ubiDestino = destUbiId || (await supabase.from('inv_stock')
      .select('ubicacion_id').eq('item_id', invItem.id).order('cantidad', { ascending: false }).limit(1).maybeSingle()).data?.ubicacion_id;

    if (!ubiDestino) return ok(res, { delta, skip: 'sin_ubicacion_destino' });

    const { data: movId, error: movErr } = await supabase.rpc('inv_registrar_movimiento', {
      p_tipo: 'entrada', p_item_id: invItem.id, p_ubicacion_id: ubiDestino,
      p_ubicacion_destino_id: null, p_cantidad: cantDevolver,
      p_proyecto_id: proyecto_id || null, p_mueble_id: null,
      p_motivo: 'kitting_reverso', p_origen: 'kitting', p_empleado_id: empId,
      p_nota: 'SO ' + (so_zoho_id || '') + ' (reverso)',
    });
    if (movErr) return err(res, movErr.message, 500);
    if (movId && costoUsd != null) {
      await supabase.from('inv_movimientos')
        .update({ costo_unitario_usd: costoUsd, costo_verificado: costoVerif })
        .eq('id', movId);
    }

    await supabase.from('so_lineas_estado')
      .update({ cantidad_descontada_inv: armado, item_zoho_id })
      .eq('so_zoho_id', so_zoho_id).eq('linea_zoho_id', linea_zoho_id);

    return ok(res, { delta, devuelto: cantDevolver });
  }
}

// ── GET oc-para-inventario ─────────────────────────────────────────────────
// Lee el PO de Zoho con precio y moneda, matchea con inv_items
async function accionOcParaInventario(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  const sesion = await verificarSesionAdminOficina(req);
  if (!sesion) return err(res, 'No autorizado', 401);

  const ocIdZoho = req.query.oc_id_zoho;
  if (!ocIdZoho) return err(res, 'oc_id_zoho requerido');

  const orgId = process.env.ZOHO_ORG_ID;
  const token = await getZohoToken();
  const poRes = await fetch(
    `https://www.zohoapis.com/books/v3/purchaseorders/${ocIdZoho}?organization_id=${orgId}`,
    { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
  );
  if (!poRes.ok) {
    const detail = await poRes.text();
    return err(res, 'Error Zoho: ' + detail, 502);
  }
  const poData = await poRes.json();
  const po = poData.purchaseorder || {};
  const currencyCode = po.currency_code || 'USD';

  const tc = await _fetchTcUsd(currencyCode);
  if (!tc) return err(res, `Sin tipo de cambio para ${currencyCode}`, 400);

  // Obtener todos los zoho_item_ids de las líneas para matchear en batch
  const zohoIds = (po.line_items || []).map(li => li.item_id).filter(Boolean);
  let itemsMap = {};
  if (zohoIds.length) {
    const { data: invItems } = await supabase.from('inv_items')
      .select('id, codigo, familia, zoho_item_id')
      .in('zoho_item_id', zohoIds);
    for (const it of (invItems || [])) {
      itemsMap[it.zoho_item_id] = it;
    }
  }

  const lineas = (po.line_items || []).map(li => {
    const match = itemsMap[li.item_id];
    return {
      zoho_item_id: li.item_id || '',
      name: li.name || '',
      sku: li.sku || '',
      description: li.description || '',
      quantity: li.quantity,
      rate: li.rate,
      unit: li.unit || '',
      inv_item_id: match ? match.id : null,
      inv_codigo: match ? match.codigo : null,
      familia: match ? match.familia : null,
      sin_item: !match,
    };
  });

  return ok(res, {
    oc_numero: po.purchaseorder_number || '',
    vendor: po.vendor_name || '',
    currency_code: currencyCode,
    tc_aplicado: tc,
    lineas,
  });
}

// ── POST recepcionar-inventario ─────────────────────────────────────────────
// Congelar costos y crear stock desde líneas de OC
async function accionRecepcionarInventario(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const sesion = await verificarSesionAdminOficina(req);
  if (!sesion) return err(res, 'No autorizado', 401);

  const b = req.body || {};
  const { empleado_id, oc_numero, currency_code, ubicacion_placa_id, lineas } = b;
  if (!empleado_id) return err(res, 'empleado_id requerido');
  if (!oc_numero) return err(res, 'oc_numero requerido');
  if (!ubicacion_placa_id) return err(res, 'ubicacion_placa_id requerido');
  if (!Array.isArray(lineas) || !lineas.length) return err(res, 'lineas requeridas');

  const cc = (currency_code || 'USD').toUpperCase();
  const tc = await _fetchTcUsd(cc);
  if (!tc) return err(res, `Sin tipo de cambio para ${cc}`, 400);

  const placasCreadas = [];
  const lineasCantidad = [];
  const errores = [];

  for (const li of lineas) {
    const { inv_item_id, familia, cantidad, rate, atributos, reserva_proyecto_id } = li;
    if (!inv_item_id || !cantidad || cantidad <= 0 || rate == null) {
      errores.push({ inv_item_id, error: 'datos incompletos (inv_item_id, cantidad, rate)' });
      continue;
    }

    const costoUsd = cc === 'USD' ? rate : rate / tc;

    // ── Serializada (placa/madera) ──
    if (familia === 'placa' || familia === 'madera') {
      const { data: codigos, error: rpcErr } = await supabase.rpc('inv_recibir_serializado', {
        p_item_id: inv_item_id,
        p_cantidad: Math.floor(cantidad),
        p_ubicacion_id: ubicacion_placa_id,
        p_costo_usd: costoUsd,
        p_atributos: atributos || null,
        p_empleado_id: empleado_id,
        p_reserva_proyecto_id: reserva_proyecto_id || null,
        p_oc_numero: oc_numero,
      });
      if (rpcErr) {
        errores.push({ inv_item_id, error: rpcErr.message });
        continue;
      }
      placasCreadas.push({ inv_item_id, codigos: codigos || [] });
      continue;
    }

    // ── Por cantidad (herraje/consumible/otro) ──
    // 1. Registrar movimiento de entrada
    const { data: movId, error: movErr } = await supabase.rpc('inv_registrar_movimiento', {
      p_tipo: 'entrada',
      p_item_id: inv_item_id,
      p_ubicacion_id: ubicacion_placa_id,
      p_ubicacion_destino_id: null,
      p_cantidad: cantidad,
      p_proyecto_id: null,
      p_mueble_id: null,
      p_motivo: 'recepcion_oc',
      p_origen: 'recepcion',
      p_empleado_id: empleado_id,
      p_nota: 'OC ' + (oc_numero || ''),
    });
    if (movErr) {
      errores.push({ inv_item_id, error: movErr.message });
      continue;
    }

    // 2. Setear costo en el movimiento (la RPC no tiene params de costo)
    if (movId) {
      await supabase.from('inv_movimientos')
        .update({ costo_unitario_usd: costoUsd, costo_verificado: true })
        .eq('id', movId);
    }

    // 3. Recalcular promedio ponderado
    const { data: itemRow } = await supabase.from('inv_items')
      .select('costo_promedio_usd').eq('id', inv_item_id).maybeSingle();
    const { data: stockRows } = await supabase.from('inv_stock')
      .select('cantidad').eq('item_id', inv_item_id);
    const stockActual = (stockRows || []).reduce((s, r) => s + Number(r.cantidad || 0), 0);
    // stockActual ya incluye la entrada recién registrada por la RPC
    const stockPrevio = stockActual - cantidad;
    const promAnterior = (itemRow && itemRow.costo_promedio_usd != null) ? Number(itemRow.costo_promedio_usd) : 0;
    let nuevoPromedio;
    if (stockPrevio <= 0 || !promAnterior) {
      nuevoPromedio = costoUsd;
    } else {
      nuevoPromedio = (stockPrevio * promAnterior + cantidad * costoUsd) / stockActual;
    }

    await supabase.from('inv_items')
      .update({ costo_promedio_usd: nuevoPromedio, costo_ultimo_usd: costoUsd })
      .eq('id', inv_item_id);

    lineasCantidad.push({ inv_item_id, cantidad, nuevo_promedio: nuevoPromedio });
  }

  return ok(res, { placas_creadas: placasCreadas, lineas_cantidad: lineasCantidad, errores });
}

// ── POST cargar-stock-placa ── INV-5: carga de stock inicial de placas existentes
// Auth: acepta sesión admin/oficina (inventario.html) O operario (kiosco)
async function accionCargarStockPlaca(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const b = req.body || {};
  const sesion = await verificarSesionAdminOficina(req) || await verificarOperario(b.empleado_id);
  if (!sesion) return err(res, 'No autorizado', 401);

  const { inv_item_id, cantidad, ubicacion_id } = b;
  if (!inv_item_id) return err(res, 'inv_item_id requerido');
  if (!cantidad || !Number.isInteger(cantidad) || cantidad <= 0) return err(res, 'cantidad debe ser entero > 0');
  if (!ubicacion_id) return err(res, 'ubicacion_id requerido');

  // Validar ítem existe y familia es placa/madera
  const { data: item, error: itemErr } = await supabase
    .from('inv_items').select('id, codigo, descripcion, familia, costo_ultimo_usd, unidad')
    .eq('id', inv_item_id).maybeSingle();
  if (itemErr || !item) return err(res, 'Ítem no encontrado');
  if (item.familia !== 'placa' && item.familia !== 'madera') return err(res, 'Solo ítems de familia placa o madera');

  // Validar ubicación existe
  const { data: ubi, error: ubiErr } = await supabase
    .from('inv_ubicaciones').select('id').eq('id', ubicacion_id).maybeSingle();
  if (ubiErr || !ubi) return err(res, 'Ubicación no encontrada');

  // Costo del ítem (puede ser null — se carga igual sin costo)
  const costoUsd = (item.costo_ultimo_usd != null) ? Number(item.costo_ultimo_usd) : null;

  // Atributos para etiqueta: tomar lo que haya del ítem
  const atributos = {};
  if (item.descripcion) atributos.material = item.descripcion;

  // Llamar RPC (crea N unidades serializadas + movimientos + stock)
  const { data: codigos, error: rpcErr } = await supabase.rpc('inv_recibir_serializado', {
    p_item_id: inv_item_id,
    p_cantidad: cantidad,
    p_ubicacion_id: ubicacion_id,
    p_costo_usd: costoUsd,
    p_atributos: Object.keys(atributos).length ? atributos : null,
    p_empleado_id: sesion.id,
    p_reserva_proyecto_id: null,
    p_oc_numero: 'CARGA-INICIAL',
  });
  if (rpcErr) return err(res, rpcErr.message, 500);

  // La RPC marca costo_verificado=true (viene de recepción OC). Para carga inicial
  // NO es verificado — corregir los movimientos recién creados.
  // Los identificamos por nota='OC CARGA-INICIAL' + las unidades devueltas.
  if (codigos && codigos.length) {
    // Buscar unidades por código para obtener sus IDs
    const { data: unidades } = await supabase
      .from('inv_unidades').select('id').in('codigo', codigos);
    if (unidades && unidades.length) {
      const unidadIds = unidades.map(u => u.id);
      await supabase.from('inv_movimientos')
        .update({ costo_verificado: false })
        .in('unidad_id', unidadIds)
        .eq('motivo', 'recepcion_oc');
    }
  }

  return ok(res, {
    codigos: codigos || [],
    item: { codigo: item.codigo, descripcion: item.descripcion, medida: item.unidad || '' },
    cantidad,
    costo_usd: costoUsd,
  });
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
    if (action === 'valor-inventario')       return await accionValorInventario(req, res);
    if (action === 'items-reposicion')       return await accionItemsReposicion(req, res);
    // Kitting (server-to-server)
    if (action === 'descontar-kitting')      return await accionDescontarKitting(req, res);
    // Kiosco placa (unidad serializada)
    if (action === 'consumir-unidad')         return await accionConsumirUnidad(req, res);
    if (action === 'trasladar-unidad')        return await accionTrasladarUnidad(req, res);
    if (action === 'descartar-unidad')        return await accionDescartarUnidad(req, res);
    if (action === 'setear-reserva-unidad')   return await accionSetearReservaUnidad(req, res);
    // Recepción OC → inventario
    if (action === 'oc-para-inventario')      return await accionOcParaInventario(req, res);
    if (action === 'recepcionar-inventario')  return await accionRecepcionarInventario(req, res);
    // Carga de stock inicial
    if (action === 'cargar-stock-placa')      return await accionCargarStockPlaca(req, res);
    return err(res, 'Acción no reconocida');
  } catch (e) {
    console.error('[inventario]', action, e);
    return err(res, 'Error interno', 500);
  }
}
