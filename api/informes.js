// api/informes.js — Endpoints sección Informes (Node.js runtime, NO edge)
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { getZohoToken } from './_zoho-token-cache.js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

const SECRET = process.env.SECCION_PIN_SECRET || 'mble-seccion-fallback-2025';
const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutos

function ok(res, data)  { return res.status(200).json({ ok: true, ...data }); }
function err(res, msg, status = 400) { return res.status(status).json({ ok: false, msg }); }
function round2(n) { return Math.round(n * 100) / 100; }
function round1(n) { return Math.round(n * 10) / 10; }

// ── Token de sección (HMAC-SHA256) ─────────────────────────────────────────

function crearTokenSeccion(empleadoId) {
  const payload = {
    empleado_id: empleadoId,
    exp: Date.now() + TOKEN_TTL_MS,
    seccion: 'privada',
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig  = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return data + '.' + sig;
}

function verificarTokenSeccion(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

function verificarAccesoSeccion(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  return verificarTokenSeccion(token);
}

async function verificarSesionAdmin(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (!token) return null;
  const { data } = await supabase
    .from('empleados')
    .select('id, rol_app, nombre')
    .eq('session_token', token)
    .gt('session_expires_at', new Date().toISOString())
    .maybeSingle();
  if (!data || data.rol_app !== 'admin') return null;
  return data;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim();
}

async function logAudit({ empleado_id, seccion = 'informes', accion, ip, resultado, detalles = null }) {
  try {
    await supabase.from('audit_log').insert({ empleado_id, seccion, accion, ip, resultado, detalles });
  } catch (e) {
    console.error('[audit_log]', e.message);
  }
}

function calcularPrecioVenta(sos_cargadas) {
  if (!Array.isArray(sos_cargadas) || sos_cargadas.length === 0) return 0;
  return sos_cargadas.reduce((sum, so) => {
    const val = Number(so.total_usd || so.total || so.amount || 0);
    return sum + (isNaN(val) ? 0 : val);
  }, 0);
}

function calcularTotalMateriales(materiales) {
  if (!Array.isArray(materiales) || materiales.length === 0) return 0;
  return materiales.reduce((sum, m) => {
    if (m.costo_total_usd != null) return sum + Number(m.costo_total_usd || 0);
    const cant = Number(m.requerido || m.cantidad || 0);
    const cu   = m.costo_unitario_usd != null ? Number(m.costo_unitario_usd) : null;
    return sum + (cu != null ? Math.round(cant * cu * 100) / 100 : 0);
  }, 0);
}

// ══════════════════════════════════════════════════════════════════════════
// ENDPOINT 1 — POST verificar-seccion
// ══════════════════════════════════════════════════════════════════════════

async function accionVerificarSeccion(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const { pin, empleado_id } = req.body || {};
  if (!pin || !empleado_id) return err(res, 'pin y empleado_id requeridos');

  const ip = getIp(req);

  // Lockout: contar intentos fallidos en últimos 5 minutos
  const cincoMinAtras = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('empleado_id', empleado_id)
    .eq('resultado', 'fallido')
    .gte('creado_at', cincoMinAtras);

  const intentos = count || 0;

  if (intentos >= 3) {
    await logAudit({ empleado_id, accion: 'bloqueado', ip, resultado: 'bloqueado' });
    return err(res, 'Demasiados intentos. Esperá 5 minutos.', 429);
  }

  // Obtener hash guardado
  const { data: cfg } = await supabase
    .from('config_global')
    .select('valor')
    .eq('clave', 'pin_seccion_hash')
    .maybeSingle();

  if (!cfg || !cfg.valor) {
    return err(res, 'PIN de sección no configurado. Contactá al administrador.', 403);
  }

  // valor es JSONB — limpiar comillas si vienen como string JSON
  let stored = typeof cfg.valor === 'string' ? cfg.valor : String(cfg.valor);
  stored = stored.replace(/^"|"$/g, '');

  if (stored === 'PENDIENTE_CONFIGURAR') {
    return err(res, 'PIN de sección pendiente de configuración. El administrador debe configurarlo desde Ajustes.', 403);
  }

  // Formato: "pbkdf2:salt:hash"
  const partes = stored.split(':');
  if (partes.length !== 3 || partes[0] !== 'pbkdf2') {
    return err(res, 'Formato de hash inválido. Reconfigurá el PIN.', 500);
  }
  const [, salt, hashStored] = partes;

  const hashAttempt = crypto.pbkdf2Sync(pin, salt, 100000, 64, 'sha512').toString('hex');

  let valid = false;
  try {
    valid = crypto.timingSafeEqual(
      Buffer.from(hashAttempt, 'hex'),
      Buffer.from(hashStored, 'hex')
    );
  } catch { valid = false; }

  if (valid) {
    await logAudit({ empleado_id, accion: 'acceso_ok', ip, resultado: 'ok' });
    const token = crearTokenSeccion(empleado_id);
    return ok(res, { token, expires_in: 900 });
  }

  await logAudit({ empleado_id, accion: 'pin_fallido', ip, resultado: 'fallido' });
  const restantes = Math.max(0, 3 - intentos - 1);
  return err(res, `PIN incorrecto. ${restantes} intento(s) restante(s)`, 401);
}

// ══════════════════════════════════════════════════════════════════════════
// ENDPOINT 2 — POST configurar-pin-seccion
// ══════════════════════════════════════════════════════════════════════════

async function accionConfigurarPin(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);

  const admin = await verificarSesionAdmin(req);
  if (!admin) return err(res, 'Sesión de admin inválida o expirada', 401);

  const { pin_nuevo } = req.body || {};
  if (!pin_nuevo || !/^\d{4}$/.test(pin_nuevo)) {
    return err(res, 'pin_nuevo debe ser exactamente 4 dígitos numéricos');
  }

  const salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto.pbkdf2Sync(pin_nuevo, salt, 100000, 64, 'sha512').toString('hex');
  const stored = `pbkdf2:${salt}:${hash}`;

  const { error } = await supabase.from('config_global')
    .upsert({
      clave: 'pin_seccion_hash',
      valor: stored,
      actualizado_at: new Date().toISOString(),
    }, { onConflict: 'clave' });
  if (error) throw error;

  const ip = getIp(req);
  await logAudit({ empleado_id: admin.id, accion: 'pin_configurado', ip, resultado: 'ok' });

  return ok(res, { msg: 'PIN configurado correctamente' });
}

// ══════════════════════════════════════════════════════════════════════════
// ENDPOINT 3 — GET informe-proyectos
// ══════════════════════════════════════════════════════════════════════════

async function accionInformeProyectos(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  const seccion = verificarAccesoSeccion(req);
  if (!seccion) return err(res, 'Token de sección inválido o expirado', 401);

  const fecha_corte = req.query.fecha_corte || new Date().toISOString().split('T')[0];
  const estado = req.query.estado || 'all';
  const buscar = (req.query.buscar || '').trim().toLowerCase();
  const corteEnd = fecha_corte + 'T23:59:59.999Z';
  const hoy = new Date();

  // Fetch todo en paralelo
  const [proyectosR, registrosR, empleadosR, tarifasR, partidasR, costosR] = await Promise.all([
    supabase.from('proyectos_cache').select('*'),
    supabase.from('registros_trabajo')
      .select('empleado_id, proyecto_id, inicio, fin')
      .not('fin', 'is', null)
      .or('eliminada.is.null,eliminada.eq.false')
      .lte('inicio', corteEnd),
    supabase.from('empleados').select('id, nombre, categoria'),
    supabase.from('tarifas_horarias').select('categoria, monto_usd'),
    supabase.from('partidas_terceros')
      .select('proyecto_num, monto_usd, fecha_despacho')
      .not('monto_usd', 'is', null)
      .or('archivada.is.null,archivada.eq.false')
      .not('fecha_despacho', 'is', null)
      .lte('fecha_despacho', fecha_corte),
    supabase.from('costos_directos_proyecto')
      .select('proyecto_id, monto_usd, fecha')
      .lte('fecha', fecha_corte),
  ]);

  const proyectos  = proyectosR.data  || [];
  const registros  = registrosR.data  || [];
  const empleados  = empleadosR.data  || [];
  const tarifas    = tarifasR.data    || [];
  const partidas   = partidasR.data   || [];
  const costos     = costosR.data     || [];

  // Maps de lookup
  const empMap    = new Map(empleados.map(e => [e.id, e]));
  const tarifaMap = new Map(tarifas.map(t => [t.categoria, Number(t.monto_usd)]));

  // Agrupar registros por proyecto_id
  const regPorProy = {};
  for (const r of registros) {
    if (!r.proyecto_id) continue;
    const durMin = (new Date(r.fin) - new Date(r.inicio)) / 60000;
    if (durMin <= 0) continue;
    const emp    = empMap.get(r.empleado_id);
    const cat    = emp?.categoria || 'sin_categoria';
    const tarifa = tarifaMap.get(cat) || 0;
    const costo  = (durMin / 60) * tarifa;

    if (!regPorProy[r.proyecto_id]) {
      regPorProy[r.proyecto_id] = { totalMin: 0, totalCosto: 0, porCat: {}, ultimaActividad: null };
    }
    const p = regPorProy[r.proyecto_id];
    p.totalMin  += durMin;
    p.totalCosto += costo;
    if (!p.porCat[cat]) p.porCat[cat] = { horas_min: 0, tarifa, subtotal_usd: 0 };
    p.porCat[cat].horas_min    += durMin;
    p.porCat[cat].subtotal_usd += costo;

    const ts = new Date(r.inicio);
    if (!p.ultimaActividad || ts > p.ultimaActividad) p.ultimaActividad = ts;
  }

  // Agrupar partidas por proyecto_num
  const partPorProy = {};
  for (const p of partidas) {
    if (!p.proyecto_num) continue;
    if (!partPorProy[p.proyecto_num]) partPorProy[p.proyecto_num] = { total: 0, ultimaFecha: null };
    partPorProy[p.proyecto_num].total += Number(p.monto_usd);
    if (p.fecha_despacho) {
      const d = new Date(p.fecha_despacho);
      if (!partPorProy[p.proyecto_num].ultimaFecha || d > partPorProy[p.proyecto_num].ultimaFecha)
        partPorProy[p.proyecto_num].ultimaFecha = d;
    }
  }

  // Agrupar costos por proyecto_id
  const costPorProy = {};
  for (const c of costos) {
    if (!c.proyecto_id) continue;
    if (!costPorProy[c.proyecto_id]) costPorProy[c.proyecto_id] = { total: 0, ultimaFecha: null };
    costPorProy[c.proyecto_id].total += Number(c.monto_usd);
    if (c.fecha) {
      const d = new Date(c.fecha);
      if (!costPorProy[c.proyecto_id].ultimaFecha || d > costPorProy[c.proyecto_id].ultimaFecha)
        costPorProy[c.proyecto_id].ultimaFecha = d;
    }
  }

  // Filtrar proyectos
  let filtered = proyectos;
  if (estado === 'activo')   filtered = filtered.filter(p => p.activo === true);
  if (estado === 'inactivo') filtered = filtered.filter(p => p.activo === false);
  if (buscar) {
    filtered = filtered.filter(p =>
      (p.nombre || '').toLowerCase().includes(buscar) ||
      (p.numero || '').toLowerCase().includes(buscar) ||
      (p.obra   || '').toLowerCase().includes(buscar) ||
      (p.cliente_nombre || '').toLowerCase().includes(buscar)
    );
  }

  // Construir resultado por proyecto
  const totales = {
    total_proyectos: filtered.length,
    total_horas_hs: 0, total_costo_mo_usd: 0,
    total_materiales_usd: 0, total_tercerizados_usd: 0, total_oc_usd: 0,
    total_invertido_usd: 0, total_precio_venta_usd: 0, total_saldo_usd: 0,
  };

  const resultado = filtered.map(proy => {
    const reg  = regPorProy[proy.id]     || { totalMin: 0, totalCosto: 0, porCat: {}, ultimaActividad: null };
    const part = partPorProy[proy.numero] || { total: 0, ultimaFecha: null };
    const cost = costPorProy[proy.id]    || { total: 0, ultimaFecha: null };

    const horas_reales_min       = reg.totalMin;
    const horas_reales_hs        = round1(horas_reales_min / 60);
    const costo_mo_usd           = round2(reg.totalCosto);
    const total_materiales_usd   = round2(calcularTotalMateriales(proy.materiales));
    const total_tercerizados_usd = round2(part.total);
    const total_oc_usd           = round2(cost.total);
    const total_invertido_usd    = round2(costo_mo_usd + total_materiales_usd + total_tercerizados_usd + total_oc_usd);
    const precio_venta_usd       = round2(Number(proy.precio_venta_usd || 0) || calcularPrecioVenta(proy.sos_cargadas));
    const saldo_usd              = round2(precio_venta_usd - total_invertido_usd);
    const margen_pct             = precio_venta_usd > 0 ? round1(saldo_usd / precio_venta_usd * 100) : null;

    // Última actividad (max de registros, partidas, costos)
    let fechaUltima = reg.ultimaActividad;
    if (part.ultimaFecha && (!fechaUltima || part.ultimaFecha > fechaUltima)) fechaUltima = part.ultimaFecha;
    if (cost.ultimaFecha && (!fechaUltima || cost.ultimaFecha > fechaUltima)) fechaUltima = cost.ultimaFecha;

    const dias_sin_actividad = fechaUltima ? Math.floor((hoy - fechaUltima) / 86400000) : null;
    const es_zombie = proy.activo === true && dias_sin_actividad != null && dias_sin_actividad > 21;

    // MO por categoría
    const mo_por_categoria = {};
    for (const [cat, d] of Object.entries(reg.porCat)) {
      mo_por_categoria[cat] = {
        horas_min:    round1(d.horas_min),
        horas_hs:     round1(d.horas_min / 60),
        tarifa:       d.tarifa,
        subtotal_usd: round2(d.subtotal_usd),
      };
    }

    // Acumular totales generales
    totales.total_horas_hs         += horas_reales_hs;
    totales.total_costo_mo_usd     += costo_mo_usd;
    totales.total_materiales_usd   += total_materiales_usd;
    totales.total_tercerizados_usd += total_tercerizados_usd;
    totales.total_oc_usd           += total_oc_usd;
    totales.total_invertido_usd    += total_invertido_usd;
    totales.total_precio_venta_usd += precio_venta_usd;
    totales.total_saldo_usd        += saldo_usd;

    return {
      id: proy.id, numero: proy.numero, nombre: proy.nombre, obra: proy.obra,
      cliente_nombre: proy.cliente_nombre,
      fecha_inicio: proy.fecha_inicio, estado: proy.estado, activo: proy.activo,
      horas_reales_min: round1(horas_reales_min),
      horas_reales_hs,
      horas_estimadas_hs: null,
      costo_mo_usd,
      total_materiales_usd,
      materiales_sin_corte: true,
      total_tercerizados_usd,
      total_oc_usd,
      total_invertido_usd,
      precio_venta_usd,
      precio_venta_pendiente: precio_venta_usd === 0,
      saldo_usd,
      margen_pct,
      dias_sin_actividad,
      es_zombie,
      fecha_ultima_actividad: fechaUltima ? fechaUltima.toISOString() : null,
      mo_por_categoria,
    };
  });

  // Redondear totales acumulados
  for (const k of Object.keys(totales)) {
    if (k !== 'total_proyectos') totales[k] = round2(totales[k]);
  }

  return ok(res, {
    proyectos: resultado,
    totales,
    fecha_corte,
    generado_at: new Date().toISOString(),
  });
}

// ══════════════════════════════════════════════════════════════════════════
// ENDPOINT 4 — GET informe-proyecto-detalle
// ══════════════════════════════════════════════════════════════════════════

async function accionInformeDetalle(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  const seccion = verificarAccesoSeccion(req);
  if (!seccion) return err(res, 'Token de sección inválido o expirado', 401);

  const proyecto_id = req.query.proyecto_id;
  if (!proyecto_id) return err(res, 'proyecto_id requerido');
  const fecha_corte = req.query.fecha_corte || new Date().toISOString().split('T')[0];
  const corteEnd = fecha_corte + 'T23:59:59.999Z';

  // Proyecto
  const { data: proyecto, error: pErr } = await supabase
    .from('proyectos_cache').select('*').eq('id', proyecto_id).maybeSingle();
  if (pErr) throw pErr;
  if (!proyecto) return err(res, 'Proyecto no encontrado', 404);

  // Fetch en paralelo
  const [registrosR, empleadosR, tarifasR, costosR, partidasR, recepcionesR] = await Promise.all([
    supabase.from('registros_trabajo')
      .select('id, empleado_id, inicio, fin, centro, item_id, item_nombre, es_retrabajo')
      .eq('proyecto_id', proyecto_id)
      .not('fin', 'is', null)
      .or('eliminada.is.null,eliminada.eq.false')
      .lte('inicio', corteEnd)
      .order('inicio', { ascending: true }),
    supabase.from('empleados').select('id, nombre, categoria'),
    supabase.from('tarifas_horarias').select('categoria, monto_usd'),
    supabase.from('costos_directos_proyecto')
      .select('id, tipo, oc_numero, oc_total_usd, descripcion, monto_usd, moneda_original, monto_original, tc_aplicado, fecha, creado_por, creado_en')
      .eq('proyecto_id', proyecto_id)
      .lte('fecha', fecha_corte)
      .order('fecha', { ascending: false }),
    proyecto.numero
      ? supabase.from('partidas_terceros')
          .select('id, tipo, numero_envio, proveedor_nombre, mueble_nombre, mueble_codigo, estado, fecha_despacho, monto_usd, obra')
          .eq('proyecto_num', proyecto.numero)
          .or('archivada.is.null,archivada.eq.false')
          .not('fecha_despacho', 'is', null)
          .lte('fecha_despacho', fecha_corte)
      : Promise.resolve({ data: [] }),
    supabase.from('recepciones_material').select('id, impactados'),
  ]);

  const registros     = registrosR.data  || [];
  const empleados     = empleadosR.data  || [];
  const tarifas       = tarifasR.data    || [];
  const costosItems   = costosR.data     || [];
  const partidasItems = partidasR.data   || [];
  const recepciones   = recepcionesR.data || [];

  const empMap    = new Map(empleados.map(e => [e.id, e]));
  const tarifaMap = new Map(tarifas.map(t => [t.categoria, Number(t.monto_usd)]));

  // ── MO: por operario y por categoría ──────────────────────────────────
  const porOperario  = {};
  const porCategoria = {};
  let moTotalMin = 0;
  let moTotalUsd = 0;

  for (const r of registros) {
    const durMin = (new Date(r.fin) - new Date(r.inicio)) / 60000;
    if (durMin <= 0) continue;
    const emp    = empMap.get(r.empleado_id);
    const nombre = emp?.nombre || r.empleado_id;
    const cat    = emp?.categoria || 'sin_categoria';
    const tarifa = tarifaMap.get(cat) || 0;
    const costo  = (durMin / 60) * tarifa;

    moTotalMin += durMin;
    moTotalUsd += costo;

    // Por operario
    if (!porOperario[r.empleado_id]) {
      porOperario[r.empleado_id] = { empleado_id: r.empleado_id, nombre, categoria: cat, horas_min: 0, tarifa, subtotal_usd: 0 };
    }
    porOperario[r.empleado_id].horas_min    += durMin;
    porOperario[r.empleado_id].subtotal_usd += costo;

    // Por categoría
    if (!porCategoria[cat]) porCategoria[cat] = { horas_min: 0, tarifa, subtotal_usd: 0 };
    porCategoria[cat].horas_min    += durMin;
    porCategoria[cat].subtotal_usd += costo;
  }

  const operariosArr = Object.values(porOperario).map(o => ({
    ...o,
    horas_hs:     round1(o.horas_min / 60),
    horas_min:    round1(o.horas_min),
    subtotal_usd: round2(o.subtotal_usd),
  }));

  const catObj = {};
  for (const [cat, d] of Object.entries(porCategoria)) {
    catObj[cat] = {
      horas_min:    round1(d.horas_min),
      horas_hs:     round1(d.horas_min / 60),
      tarifa:       d.tarifa,
      subtotal_usd: round2(d.subtotal_usd),
    };
  }

  // ── Costos directos ───────────────────────────────────────────────────
  const costos_total = costosItems.reduce((s, c) => s + Number(c.monto_usd), 0);

  // ── Tercerizados ──────────────────────────────────────────────────────
  const terc_total = partidasItems.reduce((s, p) => s + (p.monto_usd != null ? Number(p.monto_usd) : 0), 0);

  // ── Materiales ────────────────────────────────────────────────────────
  const materiales = proyecto.materiales || [];
  const mat_total  = calcularTotalMateriales(materiales);

  const matPorSo = {};
  for (const m of materiales) {
    const soNum = m.so_numero || m.so || (m.key && m.key.split('::')[0]) || 'sin_so';
    if (!matPorSo[soNum]) matPorSo[soNum] = { so_numero: soNum === 'sin_so' ? null : soNum, items: [], subtotal_usd: 0 };
    const ct = m.costo_total_usd != null
      ? Number(m.costo_total_usd)
      : (m.costo_unitario_usd != null ? round2(Number(m.requerido || m.cantidad || 0) * Number(m.costo_unitario_usd)) : 0);
    matPorSo[soNum].items.push(m);
    matPorSo[soNum].subtotal_usd += ct;
  }

  // ── Precio de venta (cache en BD → fallback Zoho invoice) ──────────────
  let precio_venta_usd = round2(Number(proyecto.precio_venta_usd || 0) || calcularPrecioVenta(proyecto.sos_cargadas));
  let precio_venta_fuente = precio_venta_usd > 0 ? 'cache' : 'no_encontrado';
  let precio_venta_so_numero = null;

  // Si no hay precio en cache, buscar invoice en Zoho y obtener detalle para sub_total
  if (precio_venta_usd === 0 && proyecto.numero) {
    try {
      const zohoToken = await getZohoToken();
      const orgId = process.env.ZOHO_ORG_ID;
      const searchUrl = `https://www.zohoapis.com/books/v3/invoices?organization_id=${orgId}&search_text=${encodeURIComponent(proyecto.numero)}`;
      const zohoRes = await fetch(searchUrl, {
        headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` },
      });
      const zohoData = await zohoRes.json();
      const inv = zohoData?.invoices?.[0];
      if (inv?.invoice_id) {
        const detailUrl = `https://www.zohoapis.com/books/v3/invoices/${inv.invoice_id}?organization_id=${orgId}`;
        const detailRes = await fetch(detailUrl, {
          headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` },
        });
        const detailData = await detailRes.json();
        const invDetail = detailData?.invoice;
        if (invDetail?.sub_total != null) {
          precio_venta_usd = round2(Number(invDetail.sub_total));
          precio_venta_fuente = 'zoho';
          precio_venta_so_numero = invDetail.invoice_number || null;
          await supabase.from('proyectos_cache')
            .update({ precio_venta_usd })
            .eq('id', proyecto.id);
        }
      }
    } catch (e) {
      console.error('[informes] Zoho invoice fetch error:', e.message);
    }
  }

  // ── Totales ───────────────────────────────────────────────────────────
  const total_invertido = round2(round2(moTotalUsd) + round2(mat_total) + round2(terc_total) + round2(costos_total));
  const saldo  = round2(precio_venta_usd - total_invertido);
  const margen = precio_venta_usd > 0 ? round1(saldo / precio_venta_usd * 100) : null;

  // ── Recepciones (conteo) ──────────────────────────────────────────────
  const recepcionesCount = recepciones.filter(r => {
    const imp = r.impactados || [];
    return imp.some(i =>
      i === proyecto.id || i === proyecto.numero ||
      (typeof i === 'object' && i !== null &&
        (i.id === proyecto.id || i.proyecto_id === proyecto.id || i.numero === proyecto.numero))
    );
  }).length;

  return ok(res, {
    proyecto: {
      id: proyecto.id, numero: proyecto.numero, nombre: proyecto.nombre,
      obra: proyecto.obra, cliente_nombre: proyecto.cliente_nombre,
      fecha_inicio: proyecto.fecha_inicio, fecha_entrega: proyecto.fecha_entrega,
      estado: proyecto.estado, activo: proyecto.activo,
    },
    fecha_corte,
    mo: {
      por_operario:  operariosArr,
      por_categoria: catObj,
      total_usd:     round2(moTotalUsd),
      total_hs:      round1(moTotalMin / 60),
    },
    costos_directos: {
      items:     costosItems,
      total_usd: round2(costos_total),
    },
    tercerizados: {
      items: partidasItems.map(p => ({
        ...p, monto_usd: p.monto_usd != null ? round2(Number(p.monto_usd)) : null,
      })),
      total_usd: round2(terc_total),
    },
    materiales: {
      por_so:    Object.values(matPorSo).map(g => ({ ...g, subtotal_usd: round2(g.subtotal_usd) })),
      total_usd: round2(mat_total),
      sin_corte: true,
    },
    recepciones_count: recepcionesCount,
    precio_venta_fuente,
    precio_venta_so_numero,
    totales: {
      total_invertido_usd: total_invertido,
      precio_venta_usd,
      saldo_usd: saldo,
      margen_pct: margen,
    },
  });
}

// ══════════════════════════════════════════════════════════════════════════
// Handler principal
// ══════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════
// ENDPOINT 5 — POST sincronizar-precios
// ══════════════════════════════════════════════════════════════════════════

async function accionSincronizarPrecios(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const seccion = verificarAccesoSeccion(req);
  if (!seccion) return err(res, 'Token de sección inválido o expirado', 401);

  const { data: proyectos } = await supabase.from('proyectos_cache')
    .select('id, numero').eq('activo', true);
  const conNumero = (proyectos || []).filter(p => p.numero);

  let zohoToken;
  try { zohoToken = await getZohoToken(); } catch (e) {
    return err(res, 'No se pudo obtener token de Zoho: ' + e.message, 502);
  }
  const orgId = process.env.ZOHO_ORG_ID;

  let actualizados = 0, sin_invoice = 0;
  const BATCH = 5;
  for (let i = 0; i < conNumero.length; i += BATCH) {
    const lote = conNumero.slice(i, i + BATCH);
    await Promise.all(lote.map(async (p) => {
      try {
        const searchUrl = `https://www.zohoapis.com/books/v3/invoices?organization_id=${orgId}&search_text=${encodeURIComponent(p.numero)}`;
        const zRes = await fetch(searchUrl, {
          headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` },
        });
        const zData = await zRes.json();
        const inv = zData?.invoices?.[0];
        if (inv?.invoice_id) {
          const detUrl = `https://www.zohoapis.com/books/v3/invoices/${inv.invoice_id}?organization_id=${orgId}`;
          const detRes = await fetch(detUrl, {
            headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` },
          });
          const detData = await detRes.json();
          const invDetail = detData?.invoice;
          if (invDetail?.sub_total != null && Number(invDetail.sub_total) > 0) {
            await supabase.from('proyectos_cache')
              .update({ precio_venta_usd: round2(Number(invDetail.sub_total)) })
              .eq('id', p.id);
            actualizados++;
          } else {
            sin_invoice++;
          }
        } else {
          sin_invoice++;
        }
      } catch { sin_invoice++; }
    }));
    if (i + BATCH < conNumero.length) await new Promise(r => setTimeout(r, 200));
  }

  return ok(res, { actualizados, sin_invoice, total: conNumero.length });
}

// ══════════════════════════════════════════════════════════════════════════
// Handler principal
// ══════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;
  try {
    if (action === 'verificar-seccion')        return await accionVerificarSeccion(req, res);
    if (action === 'configurar-pin-seccion')   return await accionConfigurarPin(req, res);
    if (action === 'informe-proyectos')        return await accionInformeProyectos(req, res);
    if (action === 'informe-proyecto-detalle') return await accionInformeDetalle(req, res);
    if (action === 'sincronizar-precios')      return await accionSincronizarPrecios(req, res);
    return err(res, 'Acción no reconocida');
  } catch (e) {
    console.error('[informes]', action, e);
    return err(res, 'Error interno', 500);
  }
}
