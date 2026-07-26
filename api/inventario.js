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

    const existente = mapZoho.get(zohoItemId);

    if (existente) {
      // UPDATE solo descripcion y activo
      const { error } = await supabase.from('inv_items')
        .update({ descripcion, activo, actualizado_en: new Date().toISOString() })
        .eq('id', existente.id);
      if (!error) actualizados++;
    } else {
      // INSERT — pero verificar colisión de codigo
      if (codigosUsados.has(codigo)) {
        colisiones.push({ codigo, zoho_item_id: zohoItemId });
      } else {
        paraInsertar.push({
          codigo,
          descripcion,
          familia: 'otro',
          zoho_item_id: zohoItemId,
          inventariable: true,
          activo,
        });
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

// ── Handler ───────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const action = req.query.action;
  try {
    if (action === 'listar-items')        return await accionListarItems(req, res);
    if (action === 'crear-item')          return await accionCrearItem(req, res);
    if (action === 'editar-item')         return await accionEditarItem(req, res);
    if (action === 'sync-items-zoho')     return await accionSyncItemsZoho(req, res);
    if (action === 'listar-ubicaciones')  return await accionListarUbicaciones(req, res);
    if (action === 'crear-ubicacion')     return await accionCrearUbicacion(req, res);
    if (action === 'editar-ubicacion')    return await accionEditarUbicacion(req, res);
    if (action === 'stock-item')          return await accionStockItem(req, res);
    if (action === 'stock-ubicacion')     return await accionStockUbicacion(req, res);
    return err(res, 'Acción no reconocida');
  } catch (e) {
    console.error('[inventario]', action, e);
    return err(res, 'Error interno', 500);
  }
}
