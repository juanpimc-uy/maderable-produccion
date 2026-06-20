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

// ── Helper A: recalcular snapshot de materiales para un proyecto ──────────
async function recalcularMaterialesProyecto(proyectoId) {
  const { data: proyecto } = await supabase
    .from('proyectos_cache').select('id, materiales').eq('id', proyectoId).maybeSingle();
  if (!proyecto) return null;

  const { data: sosVinculadas } = await supabase.from('so_estado')
    .select('so_zoho_id, so_numero, mueble, estado')
    .eq('proyecto_id', proyectoId)
    .or('oculta.is.null,oculta.eq.false');

  const overrides = proyecto.materiales || [];
  const sos = [];
  let totalHistorico = 0;

  if (sosVinculadas && sosVinculadas.length > 0) {
    let zohoToken;
    try { zohoToken = await getZohoToken(); } catch (e) {
      console.error('[recalcularMat] token error:', e.message);
      return null;
    }
    const orgId = process.env.ZOHO_ORG_ID;

    for (const so of sosVinculadas) {
      try {
        const sUrl = `https://www.zohoapis.com/books/v3/salesorders?salesorder_number=${encodeURIComponent(so.so_numero)}&organization_id=${orgId}`;
        const sRes = await fetch(sUrl, { headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` } });
        const sData = await sRes.json();
        const soFound = sData?.salesorders?.[0];
        if (!soFound) continue;
        const dUrl = `https://www.zohoapis.com/books/v3/salesorders/${soFound.salesorder_id}?organization_id=${orgId}`;
        const dRes = await fetch(dUrl, { headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` } });
        const dData = await dRes.json();
        const soDetail = dData?.salesorder;
        if (!soDetail) continue;
        const lineItems = soDetail.line_items || [];
        const soDate = soDetail.date || null;
        const soKey = so.so_numero;
        const soEntry = {
          so_numero: soKey,
          so_zoho_id: so.so_zoho_id,
          so_date: soDate || null,
          mueble: so.mueble || '',
          sin_fecha: !soDate,
          subtotal_usd: 0,
          items: [],
        };
        for (const li of lineItems) {
          const key = soKey + '::' + (li.line_item_id || '');
          const ov = overrides.find(o => o.key === key);
          const cu = ov?.costo_unitario_usd ?? li.rate ?? 0;
          const cant = li.quantity || 0;
          const subtotal = round2(cu * cant);
          soEntry.items.push({
            key, nombre: li.name || li.description || '', cantidad: cant,
            unidad: li.unit || 'u', precio_unitario: cu, subtotal,
          });
          soEntry.subtotal_usd += subtotal;
          totalHistorico += subtotal;
        }
        soEntry.subtotal_usd = round2(soEntry.subtotal_usd);
        sos.push(soEntry);
        await new Promise(r => setTimeout(r, 100));
      } catch (e) { console.error('[recalcularMat] SO fetch:', so.so_numero, e.message); }
    }
  }

  const snapshot = {
    recalculado_en: new Date().toISOString(),
    sos,
  };

  await supabase.from('proyectos_cache')
    .update({
      materiales_snapshot: snapshot,
      costo_materiales_usd: round2(totalHistorico),
    })
    .eq('id', proyectoId);

  return snapshot;
}

// ── Helper B: sumar materiales al corte desde snapshot ───────────────────
function sumarMaterialesAlCorte(snapshot, fecha_corte) {
  if (!snapshot || !Array.isArray(snapshot.sos)) return { total_usd: 0, sos_incluidas: [] };
  const sos_incluidas = snapshot.sos.filter(so => {
    if (so.sin_fecha) return true;
    if (!so.so_date) return true;
    return so.so_date.slice(0, 10) <= fecha_corte;
  });
  const total_usd = round2(sos_incluidas.reduce((s, so) => s + (so.subtotal_usd || 0), 0));
  return { total_usd, sos_incluidas };
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

  // Fetch en paralelo (registros_trabajo se pagina aparte)
  const [proyectosR, empleadosR, tarifasR, partidasR, costosR] = await Promise.all([
    supabase.from('proyectos_cache').select('*'),
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

  // Paginar registros_trabajo en lotes de 1000
  const PAGE = 1000;
  let registros = [];
  let offset = 0;
  while (true) {
    const { data: lote, error: rErr } = await supabase.from('registros_trabajo')
      .select('empleado_id, proyecto_id, inicio, fin')
      .not('fin', 'is', null)
      .or('eliminada.is.null,eliminada.eq.false')
      .lte('inicio', corteEnd)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (rErr) throw rErr;
    registros = registros.concat(lote || []);
    if (!lote || lote.length < PAGE) break;
    offset += PAGE;
  }

  const proyectos  = proyectosR.data  || [];
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
    const matSnap = proy.materiales_snapshot || null;
    const matResult = matSnap ? sumarMaterialesAlCorte(matSnap, fecha_corte) : null;
    const total_materiales_usd   = matResult ? matResult.total_usd : null;
    const total_tercerizados_usd = round2(part.total);
    const total_oc_usd           = round2(cost.total);
    const total_invertido_usd    = total_materiales_usd != null
      ? round2(costo_mo_usd + total_materiales_usd + total_tercerizados_usd + total_oc_usd)
      : null;
    const precio_venta_usd       = round2(Number(proy.precio_venta_usd || 0) || calcularPrecioVenta(proy.sos_cargadas));
    const saldo_usd              = total_invertido_usd != null ? round2(precio_venta_usd - total_invertido_usd) : null;
    const margen_pct             = (precio_venta_usd > 0 && saldo_usd != null) ? round1(saldo_usd / precio_venta_usd * 100) : null;

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
    totales.total_materiales_usd   += (total_materiales_usd || 0);
    totales.total_tercerizados_usd += total_tercerizados_usd;
    totales.total_oc_usd           += total_oc_usd;
    totales.total_invertido_usd    += (total_invertido_usd || 0);
    totales.total_precio_venta_usd += precio_venta_usd;
    totales.total_saldo_usd        += (saldo_usd || 0);

    return {
      id: proy.id, numero: proy.numero, nombre: proy.nombre, obra: proy.obra,
      cliente_nombre: proy.cliente_nombre,
      fecha_inicio: proy.fecha_inicio, estado: proy.estado, activo: proy.activo,
      horas_reales_min: round1(horas_reales_min),
      horas_reales_hs,
      horas_estimadas_hs: null,
      costo_mo_usd,
      total_materiales_usd,
      total_tercerizados_usd,
      total_oc_usd,
      total_invertido_usd,
      precio_venta_usd,
      precio_venta_pendiente: precio_venta_usd === 0,
      saldo_usd,
      margen_pct,
      saldo_cobranza_usd: proy.saldo_cobranza_usd != null ? round2(Number(proy.saldo_cobranza_usd)) : null,
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

  // ── Materiales (refresh snapshot → filtrar por corte) ────────────────────
  let snapshot;
  try {
    snapshot = await recalcularMaterialesProyecto(proyecto.id);
  } catch (e) {
    console.error('[informes] recalcularMat error:', e.message);
    snapshot = proyecto.materiales_snapshot || null;
  }
  const matAlCorte = snapshot ? sumarMaterialesAlCorte(snapshot, fecha_corte) : null;
  const mat_total = matAlCorte ? matAlCorte.total_usd : null;

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
  const total_invertido = mat_total != null
    ? round2(round2(moTotalUsd) + round2(mat_total) + round2(terc_total) + round2(costos_total))
    : null;
  const saldo  = total_invertido != null ? round2(precio_venta_usd - total_invertido) : null;
  const margen = (precio_venta_usd > 0 && saldo != null) ? round1(saldo / precio_venta_usd * 100) : null;

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
      por_so:    matAlCorte ? matAlCorte.sos_incluidas.map(g => ({ ...g, subtotal_usd: round2(g.subtotal_usd) })) : [],
      total_usd: mat_total != null ? round2(mat_total) : null,
      fuente: matAlCorte && matAlCorte.sos_incluidas.length > 0 ? 'zoho_so' : 'sin_calcular',
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

  let precios_ok = 0, precios_sin = 0, materiales_ok = 0;

  // TC UYU→USD para normalizar balances
  const { data: tcRow } = await supabase
    .from('tipo_cambio').select('valor')
    .eq('moneda_origen', 'UYU').eq('moneda_destino', 'USD').maybeSingle();
  const tcUyuUsd = tcRow ? Number(tcRow.valor) : 0;

  // Procesar en lotes de 5 para precios
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
        const allInvoices = zData?.invoices || [];
        const inv = allInvoices[0];
        if (inv?.invoice_id) {
          const detUrl = `https://www.zohoapis.com/books/v3/invoices/${inv.invoice_id}?organization_id=${orgId}`;
          const detRes = await fetch(detUrl, {
            headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` },
          });
          const detData = await detRes.json();
          const invDetail = detData?.invoice;
          // Precio venta desde sub_total de la primera factura
          const updateFields = {};
          if (invDetail?.sub_total != null && Number(invDetail.sub_total) > 0) {
            updateFields.precio_venta_usd = round2(Number(invDetail.sub_total));
            precios_ok++;
          } else {
            precios_sin++;
          }
          // Saldo cobranza: sum(balance neto sin IVA) normalizado a USD
          const totalBalance = allInvoices.reduce((s, inv_i) => {
            const bal = Number(inv_i.balance) || 0;
            if (!bal) return s;
            const subT = Number(inv_i.sub_total) || 0;
            const totT = Number(inv_i.total) || 0;
            if (totT === 0) return s;
            const netoBal = bal * (subT / totT);
            if (inv_i.currency_code === 'USD') return s + netoBal;
            return tcUyuUsd > 0 ? s + (netoBal / tcUyuUsd) : s;
          }, 0);
          updateFields.saldo_cobranza_usd = round2(totalBalance);
          await supabase.from('proyectos_cache').update(updateFields).eq('id', p.id);
        } else {
          await supabase.from('proyectos_cache').update({ saldo_cobranza_usd: null }).eq('id', p.id);
          precios_sin++;
        }
      } catch { precios_sin++; }
    }));
    if (i + BATCH < conNumero.length) await new Promise(r => setTimeout(r, 200));
  }

  // Sincronizar materiales snapshots en batches de 5
  const allProyIds = (proyectos || []).map(p => p.id);
  const { data: allSos } = await supabase.from('so_estado')
    .select('proyecto_id')
    .in('proyecto_id', allProyIds)
    .or('oculta.is.null,oculta.eq.false');
  const proysConSos = [...new Set((allSos || []).map(s => s.proyecto_id).filter(Boolean))];

  for (let i = 0; i < proysConSos.length; i += BATCH) {
    const lote = proysConSos.slice(i, i + BATCH);
    const results = await Promise.allSettled(lote.map(pid => recalcularMaterialesProyecto(pid)));
    results.forEach(r => { if (r.status === 'fulfilled' && r.value) materiales_ok++; });
    if (i + BATCH < proysConSos.length) await new Promise(r => setTimeout(r, 1000));
  }

  return ok(res, { precios_ok, precios_sin, materiales_ok, total: conNumero.length });
}

// ── Helper: obtener precio de venta desde Zoho Invoice para un proyecto ──
async function obtenerPrecioVenta(numero) {
  if (!numero) return null;
  const zohoToken = await getZohoToken();
  const orgId = process.env.ZOHO_ORG_ID;
  const searchUrl = `https://www.zohoapis.com/books/v3/invoices?organization_id=${orgId}&search_text=${encodeURIComponent(numero)}`;
  const zRes = await fetch(searchUrl, { headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` } });
  const zData = await zRes.json();
  const inv = zData?.invoices?.[0];
  if (!inv?.invoice_id) return null;
  const detUrl = `https://www.zohoapis.com/books/v3/invoices/${inv.invoice_id}?organization_id=${orgId}`;
  const detRes = await fetch(detUrl, { headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` } });
  const detData = await detRes.json();
  const invDetail = detData?.invoice;
  if (invDetail?.sub_total != null && Number(invDetail.sub_total) > 0) {
    return round2(Number(invDetail.sub_total));
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════
// ENDPOINT 6 — POST congelar-odf (precio+costo desde Zoho al completar ODF)
// ══════════════════════════════════════════════════════════════════════════

async function accionCongelarOdf(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const caller = await verificarSesionAdminOficina(req);
  if (!caller) return err(res, 'Sesión inválida o sin permisos', 401);

  const proyecto_id = (req.body || {}).proyecto_id;
  if (!proyecto_id) return err(res, 'proyecto_id requerido');

  const { data: proyecto } = await supabase
    .from('proyectos_cache').select('id, numero').eq('id', proyecto_id).maybeSingle();
  if (!proyecto) return err(res, 'Proyecto no encontrado', 404);

  let zohoError = null;

  // 1. Precio de venta desde Zoho Invoice
  try {
    const precio = await obtenerPrecioVenta(proyecto.numero);
    if (precio != null) {
      await supabase.from('proyectos_cache')
        .update({ precio_venta_usd: precio })
        .eq('id', proyecto_id);
    }
  } catch (e) {
    console.error('[congelar-odf] precio error:', e.message);
    zohoError = e.message;
  }

  // 2. Costo materiales (refresh snapshot)
  try {
    await recalcularMaterialesProyecto(proyecto_id);
  } catch (e) {
    console.error('[congelar-odf] materiales error:', e.message);
    if (!zohoError) zohoError = e.message;
  }

  // 3. Releer valores frescos
  const { data: fresh } = await supabase
    .from('proyectos_cache').select('precio_venta_usd, costo_materiales_usd')
    .eq('id', proyecto_id).maybeSingle();

  // 4. Actualizar último evento 'completada' en odf_completado_log
  const { data: ultimoEvento } = await supabase
    .from('odf_completado_log')
    .select('id')
    .eq('proyecto_id', proyecto_id).eq('evento', 'completada')
    .order('creado_at', { ascending: false })
    .limit(1).maybeSingle();

  if (ultimoEvento) {
    await supabase.from('odf_completado_log').update({
      precio_venta_snapshot: fresh?.precio_venta_usd || null,
      costo_materiales_snapshot: fresh?.costo_materiales_usd || null,
      zoho_ok: !zohoError,
    }).eq('id', ultimoEvento.id);
  }

  if (zohoError && !ultimoEvento) {
    return ok(res, { precio: fresh?.precio_venta_usd, costo: fresh?.costo_materiales_usd, zoho_ok: false, zoho_error: zohoError, sin_evento: true });
  }

  return ok(res, {
    precio: fresh?.precio_venta_usd || null,
    costo: fresh?.costo_materiales_usd || null,
    zoho_ok: !zohoError,
    sin_evento: !ultimoEvento,
    ...(zohoError ? { zoho_error: zohoError } : {}),
  });
}

// ══════════════════════════════════════════════════════════════════════════
// ENDPOINT 7 — POST recalcular-materiales (single project, fire-and-forget from edge)
// ══════════════════════════════════════════════════════════════════════════

async function accionRecalcularMateriales(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret || req.headers['x-internal-secret'] !== internalSecret)
    return err(res, 'No autorizado', 401);
  const proyecto_id = (req.body || {}).proyecto_id || req.query.proyecto_id;
  if (!proyecto_id) return err(res, 'proyecto_id requerido');
  try {
    const snap = await recalcularMaterialesProyecto(proyecto_id);
    return ok(res, { recalculado: !!snap });
  } catch (e) {
    console.error('[informes] recalcular-materiales:', e.message);
    return err(res, e.message, 500);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ENDPOINT 7 — POST recalcular-materiales-todos
// ══════════════════════════════════════════════════════════════════════════

async function accionRecalcularMaterialesTodos(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const seccion = verificarAccesoSeccion(req);
  if (!seccion) return err(res, 'Token de sección inválido o expirado', 401);

  const { data: proyectos } = await supabase.from('proyectos_cache')
    .select('id').eq('activo', true);
  const ids = (proyectos || []).map(p => p.id);

  let recalculados = 0, fallidos = 0;
  const BATCH = 5;
  for (let i = 0; i < ids.length; i += BATCH) {
    const lote = ids.slice(i, i + BATCH);
    const results = await Promise.allSettled(lote.map(pid => recalcularMaterialesProyecto(pid)));
    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value) recalculados++;
      else fallidos++;
    });
    if (i + BATCH < ids.length) await new Promise(r => setTimeout(r, 1000));
  }

  return ok(res, { recalculados, fallidos, total: ids.length });
}

// ══════════════════════════════════════════════════════════════════════════
// ENDPOINT 9 — POST sincronizar-precios-muebles
// ══════════════════════════════════════════════════════════════════════════

async function accionSincronizarPreciosMuebles(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const seccion = verificarAccesoSeccion(req);
  if (!seccion) return err(res, 'Token de sección inválido o expirado', 401);

  const dry = req.query.dry === '1';

  // 1. Proyectos activos con muebles
  const { data: proyectos } = await supabase
    .from('proyectos_cache').select('id, numero, muebles, precio_venta_usd').eq('activo', true);
  const proysConMuebles = (proyectos || []).filter(p => Array.isArray(p.muebles) && p.muebles.length);

  // 2. TC UYU→USD
  const { data: tcRow } = await supabase
    .from('tipo_cambio').select('valor')
    .eq('moneda_origen', 'UYU').eq('moneda_destino', 'USD').maybeSingle();
  const tcUyuUsd = tcRow ? Number(tcRow.valor) : 0;

  // 3. Zoho token
  let zohoToken;
  try { zohoToken = await getZohoToken(); } catch (e) {
    return err(res, 'No se pudo obtener token de Zoho: ' + e.message, 502);
  }
  const orgId = process.env.ZOHO_ORG_ID;

  // 4. Collect unique odfIds
  const odfIdSet = new Set();
  for (const p of proysConMuebles) {
    for (const m of p.muebles) {
      if (m.odfId) odfIdSet.add(m.odfId);
    }
  }
  const odfIds = [...odfIdSet];

  // 5. Fetch invoices by id in batches of 5
  const invoiceCache = {};
  const BATCH = 5;
  for (let i = 0; i < odfIds.length; i += BATCH) {
    const lote = odfIds.slice(i, i + BATCH);
    await Promise.all(lote.map(async (odfId) => {
      try {
        const detUrl = `https://www.zohoapis.com/books/v3/invoices/${odfId}?organization_id=${orgId}`;
        const detRes = await fetch(detUrl, {
          headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` },
        });
        const detData = await detRes.json();
        if (detData?.invoice) invoiceCache[odfId] = detData.invoice;
      } catch (e) {
        console.warn('[sync-precios-muebles] fetch error:', odfId, e.message);
      }
    }));
    if (i + BATCH < odfIds.length) await new Promise(r => setTimeout(r, 1000));
  }

  // 6. Process each project
  let mueblesConPrecio = 0, mueblesSinPrecio = 0;
  const proyectosARevisar = [];
  const detalle = [];
  const ahora = new Date().toISOString();

  for (const proy of proysConMuebles) {
    const muebles = proy.muebles;
    let sumaPreciosMuebles = 0;
    let proyModificado = false;

    for (const m of muebles) {
      // Skip: no odfId
      if (!m.odfId) { mueblesSinPrecio++; continue; }

      // Skip: manual mueble (id = mf_<timestamp largo>)
      const idMatch = String(m.id).match(/^mf_(\d+)$/);
      if (!idMatch) { mueblesSinPrecio++; continue; }
      const idx = Number(idMatch[1]);
      if (idx > 1000) { mueblesSinPrecio++; continue; }

      const invoice = invoiceCache[m.odfId];
      if (!invoice || !Array.isArray(invoice.line_items)) { mueblesSinPrecio++; continue; }

      const linea = invoice.line_items[idx];
      if (!linea) {
        m.precio_venta_usd = null;
        m.precio_fuente = 'zoho_factura';
        m.precio_match = 'sin_match';
        m.precio_sync_at = ahora;
        mueblesSinPrecio++;
        proyModificado = true;
        if (dry) detalle.push({ proyecto: proy.numero, mueble_id: m.id, codigo: m.codigo, precio_usd: null, match: 'sin_match', currency: invoice.currency_code });
        continue;
      }

      // Cross-check name
      const lineDesc = ((linea.name || '') + ' ' + (linea.description || '')).toLowerCase();
      const mNombre = (m.nombre || '').toLowerCase();
      const mCodigo = (m.codigo || '').toLowerCase();
      const crossOk = !mNombre || lineDesc.includes(mNombre.split(' ')[0]) || (mCodigo && lineDesc.includes(mCodigo));

      if (!crossOk) {
        m.precio_venta_usd = null;
        m.precio_fuente = 'zoho_factura';
        m.precio_match = 'sin_match';
        m.precio_sync_at = ahora;
        mueblesSinPrecio++;
        proyModificado = true;
        if (dry) detalle.push({ proyecto: proy.numero, mueble_id: m.id, codigo: m.codigo, precio_usd: null, match: 'sin_match', currency: invoice.currency_code });
        continue;
      }

      // Calcular precio según moneda de la factura — solo USD o UYU, nunca adivinar
      const precioOrigen = linea.item_total != null ? Number(linea.item_total)
        : (Number(linea.rate || 0) * Number(linea.quantity || 1));
      let precioUsd = null;
      let tcAplicado = null;
      let matchTipo = 'indice';
      const moneda = invoice.currency_code;
      if (moneda === 'USD') {
        precioUsd = round2(precioOrigen);
      } else if (moneda === 'UYU') {
        if (tcUyuUsd > 0) {
          precioUsd = round2(precioOrigen / tcUyuUsd);
          tcAplicado = tcUyuUsd;
        } else {
          precioUsd = null; // UYU sin TC disponible
        }
      } else {
        precioUsd = null;            // ni USD ni UYU: no convertir a ojo
        matchTipo = 'moneda_no_soportada';
      }

      m.precio_venta_usd = precioUsd;
      m.precio_fuente = 'zoho_factura';
      m.precio_tc = tcAplicado;
      m.precio_match = matchTipo;
      m.precio_sync_at = ahora;
      proyModificado = true;

      if (precioUsd != null) {
        mueblesConPrecio++;
        sumaPreciosMuebles += precioUsd;
      } else {
        mueblesSinPrecio++;
      }

      if (dry) detalle.push({ proyecto: proy.numero, mueble_id: m.id, codigo: m.codigo, precio_usd: precioUsd, match: matchTipo, currency: moneda });
    }

    // Validation: sum vs cached precio_venta_usd
    const precioCacheado = Number(proy.precio_venta_usd || 0);
    if (precioCacheado > 0 && sumaPreciosMuebles > 0) {
      const dif = Math.abs(sumaPreciosMuebles - precioCacheado);
      if (dif / precioCacheado > 0.10) {
        proyectosARevisar.push({
          id: proy.id, numero: proy.numero,
          suma_muebles: round2(sumaPreciosMuebles),
          precio_cacheado: round2(precioCacheado),
        });
      }
    }

    // Write (only if not dry and modified)
    if (!dry && proyModificado) {
      await supabase.from('proyectos_cache')
        .update({ muebles })
        .eq('id', proy.id);
    }
  }

  const result = {
    dry,
    proyectos: proysConMuebles.length,
    muebles_con_precio: mueblesConPrecio,
    muebles_sin_precio: mueblesSinPrecio,
    proyectos_a_revisar: proyectosARevisar,
  };
  if (dry) result.detalle = detalle;
  return ok(res, result);
}

// ══════════════════════════════════════════════════════════════════════════
// ENDPOINT 13 — GET throughput-mensual
// ══════════════════════════════════════════════════════════════════════════

async function accionThroughputMensual(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  const seccion = verificarAccesoSeccion(req);
  if (!seccion) return err(res, 'Token de sección inválido o expirado', 401);

  const mesesParam = parseInt(req.query.meses) || 12;
  const OE = 55000;

  // Proyectos terminados con precio
  const { data: proys, error: pErr } = await supabase
    .from('proyectos_cache')
    .select('id, fecha_inicio, precio_venta_usd, costo_kitting_usd')
    .eq('activo', true)
    .eq('estado', 'terminado')
    .gt('precio_venta_usd', 0);
  if (pErr) throw pErr;
  if (!proys || !proys.length) return ok(res, { oe_mensual_usd: OE, datos: [] });

  // Max(fin) por proyecto de registros_trabajo
  const proyIds = proys.map(p => p.id);
  const { data: regFins, error: rErr } = await supabase
    .from('registros_trabajo')
    .select('proyecto_id, fin')
    .in('proyecto_id', proyIds)
    .not('fin', 'is', null)
    .or('eliminada.is.null,eliminada.eq.false')
    .order('fin', { ascending: false });
  if (rErr) throw rErr;

  const maxFinByProy = {};
  for (const r of (regFins || [])) {
    if (!maxFinByProy[r.proyecto_id]) maxFinByProy[r.proyecto_id] = r.fin;
  }

  // Generate YYYY-MM range helper
  function mesRange(desde, hasta) {
    const meses = [];
    const [ay, am] = desde.split('-').map(Number);
    const [by, bm] = hasta.split('-').map(Number);
    let y = ay, m = am;
    while (y < by || (y === by && m <= bm)) {
      meses.push(`${y}-${String(m).padStart(2, '0')}`);
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return meses.length ? meses : [desde.slice(0, 7)];
  }

  // Accumulate throughput per month
  const bucket = {}; // YYYY-MM → { throughput: 0, proyectos: Set }

  for (const p of proys) {
    const inicio = (p.fecha_inicio || '').slice(0, 10);
    if (!inicio || inicio.length < 7) continue;

    const finRaw = maxFinByProy[p.id];
    const fin = finRaw ? finRaw.slice(0, 10) : inicio;

    const inicioMes = inicio.slice(0, 7);
    const finMes = fin.slice(0, 7);

    const throughputTotal = round2(Number(p.precio_venta_usd) - Number(p.costo_kitting_usd || 0));
    const meses = mesRange(inicioMes, finMes);
    const porMes = round2(throughputTotal / meses.length);

    for (const mes of meses) {
      if (!bucket[mes]) bucket[mes] = { throughput: 0, proyectos: new Set() };
      bucket[mes].throughput += porMes;
      bucket[mes].proyectos.add(p.id);
    }
  }

  // Build output limited to last N months
  const hoy = new Date();
  const limiteDesde = new Date(hoy);
  limiteDesde.setMonth(limiteDesde.getMonth() - mesesParam + 1);
  const desdeMes = `${limiteDesde.getFullYear()}-${String(limiteDesde.getMonth() + 1).padStart(2, '0')}`;
  const hastaMes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  const mesesSalida = mesRange(desdeMes, hastaMes);

  const datos = mesesSalida.map(mes => {
    const b = bucket[mes];
    const throughput_usd = b ? round2(b.throughput) : 0;
    return {
      mes,
      throughput_usd,
      oe_usd: OE,
      gano_mes: throughput_usd > OE,
      proyectos_contribuyendo: b ? b.proyectos.size : 0,
    };
  });

  return ok(res, { oe_mensual_usd: OE, datos });
}

// ══════════════════════════════════════════════════════════════════════════
// ── Shared: clasificar mueble en etapa ───────────────────────────────────
const ETAPAS_ORDEN = ['sin_registro_propio','shop_drawing','modelado','cam','corte','enchapado','armado','colocacion','completado','fuera'];

function clasificarMueble(proyecto_id, mueble_id, projLast, muebleLast, despachadosSet, completadosSet) {
  if (despachadosSet.has(proyecto_id + '|' + mueble_id)) return 'fuera';
  if (completadosSet.has(proyecto_id + '|' + mueble_id)) return 'completado';
  const plCentro = projLast[proyecto_id];
  if (plCentro === 'colocacion') return 'colocacion';
  const mlCentro = muebleLast[proyecto_id + '|' + mueble_id];
  if (mlCentro && ['shop_drawing', 'obra'].includes(mlCentro)) return 'shop_drawing';
  if (mlCentro && ['armado', 'macizo', 'electrica', 'herreria'].includes(mlCentro)) return 'armado';
  if (mlCentro) return ETAPAS_ORDEN.includes(mlCentro) ? mlCentro : 'sin_registro_propio';
  return 'sin_registro_propio';
}

// ── Shared: queries de último centro + despachos ─────────────────────────
const CENTROS_PROYECTO = ['shop_drawing','obra','modelado','cam','corte','enchapado','armado','macizo','electrica','herreria','colocacion'];
const CENTROS_MUEBLE   = ['shop_drawing','obra','modelado','cam','corte','enchapado','armado','macizo','electrica','herreria'];

function _coalesceTs(r) {
  return r.ultima_actividad || r.fin || r.inicio || '';
}

async function _fetchLeanContexto(proyIds, muebleIds) {
  const [projRegsR, mRegsR, despR, compLogsR] = await Promise.all([
    supabase.from('registros_trabajo')
      .select('proyecto_id, centro, inicio, fin, ultima_actividad')
      .in('proyecto_id', proyIds)
      .or('eliminada.is.null,eliminada.eq.false')
      .in('centro', CENTROS_PROYECTO),
    muebleIds.length
      ? supabase.from('registros_trabajo')
          .select('proyecto_id, item_id, centro, inicio, fin, ultima_actividad')
          .in('item_id', muebleIds)
          .or('eliminada.is.null,eliminada.eq.false')
          .in('centro', CENTROS_MUEBLE)
      : Promise.resolve({ data: [] }),
    supabase.from('despachos_muebles')
      .select('proyecto_id, mf_n')
      .eq('despachado_full', true),
    supabase.from('items_completado_log')
      .select('proyecto_id, item_id, evento, creado_at')
      .in('proyecto_id', proyIds)
      .order('creado_at', { ascending: false }),
  ]);

  // projLast: último centro por proyecto (por coalesce desc)
  const projRegs = (projRegsR.data || []).sort((a, b) => _coalesceTs(b).localeCompare(_coalesceTs(a)));
  const projLast = {};
  for (const r of projRegs) { if (!projLast[r.proyecto_id]) projLast[r.proyecto_id] = r.centro; }

  // muebleLast: último centro por proyecto+mueble (clave compuesta, por coalesce desc)
  const mRegs = (mRegsR.data || []).sort((a, b) => _coalesceTs(b).localeCompare(_coalesceTs(a)));
  const muebleLast = {};
  for (const r of mRegs) {
    const k = r.proyecto_id + '|' + r.item_id;
    if (!muebleLast[k]) muebleLast[k] = r.centro;
  }

  // despachadosSet
  const despachadosSet = new Set((despR.data || []).map(d => d.proyecto_id + '|' + d.mf_n));

  // completadosSet: último evento por (proyecto_id, item_id), solo los que son 'completado'
  const completadosSet = new Set();
  const vistoComp = {};
  for (const l of (compLogsR.data || [])) {
    const k = l.proyecto_id + '|' + l.item_id;
    if (vistoComp[k]) continue;
    vistoComp[k] = true;
    if (l.evento === 'completado') completadosSet.add(k);
  }

  return { projLast, muebleLast, despachadosSet, completadosSet };
}

// ENDPOINT 14 — GET lean-carga-etapa
// ══════════════════════════════════════════════════════════════════════════

async function accionLeanCargaEtapa(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  const seccion = verificarAccesoSeccion(req);
  if (!seccion) return err(res, 'Token de sección inválido o expirado', 401);

  const unidad = req.query.unidad || 'muebles'; // muebles | placas | horas

  // 1. Projects en_produccion with muebles
  const { data: proys } = await supabase
    .from('proyectos_cache').select('id, muebles')
    .eq('activo', true).eq('estado', 'en_produccion');

  const allMuebles = [];
  for (const p of (proys || [])) {
    const mubs = Array.isArray(p.muebles) ? p.muebles : [];
    for (const m of mubs) {
      const placas = Number(m.placas) || 0;
      if (placas >= 999) continue; // skip placeholder muebles (MANTENIMIENTO, CAMION, etc.)
      let horas = 0;
      if (m.horas && typeof m.horas === 'object') {
        horas = Object.values(m.horas).reduce((s, v) => s + (Number(v) || 0), 0);
      }
      allMuebles.push({ proyecto_id: p.id, mueble_id: m.id, placas, horas, precio: Number(m.precio_venta_usd) || 0 });
    }
  }

  // 2. Fetch contexto (último centro proyecto/mueble + despachos)
  const proyIds = (proys || []).map(p => p.id);
  const muebleIds = allMuebles.map(m => m.mueble_id).filter(Boolean);
  const { projLast, muebleLast, despachadosSet, completadosSet } = await _fetchLeanContexto(proyIds, muebleIds);

  // 3. Classify each mueble
  const buckets = {};
  for (const e of ETAPAS_ORDEN) buckets[e] = { muebles: 0, placas: 0, horas: 0, precio: 0 };

  for (const m of allMuebles) {
    const etapa = clasificarMueble(m.proyecto_id, m.mueble_id, projLast, muebleLast, despachadosSet, completadosSet);
    buckets[etapa].muebles++;
    buckets[etapa].placas += m.placas;
    buckets[etapa].horas += m.horas;
    buckets[etapa].precio += m.precio;
  }

  // Find cuello (max PLACAS in planta, excluding 'fuera')
  const plantaEtapas = ['corte','enchapado','armado','colocacion'];
  let cuello = null, cuelloVal = 0;
  for (const e of plantaEtapas) {
    const v = buckets[e].placas || 0;
    if (v > cuelloVal) { cuelloVal = v; cuello = e; }
  }

  const etapas = ETAPAS_ORDEN.map(e => ({
    etapa: e,
    muebles: buckets[e].muebles,
    placas: buckets[e].placas,
    horas: round1(buckets[e].horas),
    precio: round2(buckets[e].precio),
    es_cuello: e === cuello,
  }));

  return ok(res, { unidad, total_muebles: allMuebles.length, cuello, etapas });
}

// ══════════════════════════════════════════════════════════════════════════
// ENDPOINT 14b — GET lean-carga-etapa-detalle
// ══════════════════════════════════════════════════════════════════════════

async function accionLeanCargaEtapaDetalle(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  const seccion = verificarAccesoSeccion(req);
  if (!seccion) return err(res, 'Token de sección inválido o expirado', 401);

  const etapa = req.query.etapa;
  if (!etapa) return err(res, 'etapa requerido');

  const { data: proys } = await supabase
    .from('proyectos_cache').select('id, numero, nombre, muebles')
    .eq('activo', true).eq('estado', 'en_produccion');

  const allMuebles = [];
  for (const p of (proys || [])) {
    const mubs = Array.isArray(p.muebles) ? p.muebles : [];
    for (const m of mubs) {
      const placasD = Number(m.placas) || 0;
      if (placasD >= 999) continue;
      let horasD = 0;
      if (m.horas && typeof m.horas === 'object') {
        horasD = Object.values(m.horas).reduce((s, v) => s + (Number(v) || 0), 0);
      }
      allMuebles.push({ proyecto_id: p.id, proyecto_numero: p.numero, proyecto_nombre: p.nombre, mueble_id: m.id, nombre: m.nombre || '', codigo: m.codigo || '', placas: placasD, horas: horasD, precio: (m.precio_venta_usd != null ? Number(m.precio_venta_usd) : null) });
    }
  }

  const proyIds = (proys || []).map(p => p.id);
  const muebleIds = allMuebles.map(m => m.mueble_id).filter(Boolean);
  const { projLast, muebleLast, despachadosSet, completadosSet } = await _fetchLeanContexto(proyIds, muebleIds);

  const resultado = [];
  for (const m of allMuebles) {
    const etapaCalc = clasificarMueble(m.proyecto_id, m.mueble_id, projLast, muebleLast, despachadosSet, completadosSet);
    if (etapaCalc === etapa) {
      resultado.push({ proyecto: m.proyecto_numero || m.proyecto_nombre, proyecto_nombre: m.proyecto_nombre, proyecto_id: m.proyecto_id, nombre: m.nombre, codigo: m.codigo, placas: m.placas, horas: round1(m.horas), precio: m.precio });
    }
  }

  resultado.sort((a, b) => b.placas - a.placas);
  return ok(res, { etapa, muebles: resultado });
}

// ══════════════════════════════════════════════════════════════════════════
// ENDPOINT 15 — GET lean-cocina-wip
// ══════════════════════════════════════════════════════════════════════════

async function accionLeanCocinaWip(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  const seccion = verificarAccesoSeccion(req);
  if (!seccion) return err(res, 'Token de sección inválido o expirado', 401);

  const { periodo } = _parsePeriodo(req.query);
  // Calendar boundaries matching the tested SQL: desde inclusive, hasta exclusive
  const hoy = new Date();
  let desde, hasta;
  if (periodo === 'mes') {
    desde = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`;
    const nextM = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1);
    hasta = `${nextM.getFullYear()}-${String(nextM.getMonth() + 1).padStart(2, '0')}-01`;
  } else if (periodo === 'anio') {
    desde = `${hoy.getFullYear()}-01-01`;
    hasta = `${hoy.getFullYear() + 1}-01-01`;
  } else if (periodo === 'elegir' && req.query.ym) {
    const [y, m] = req.query.ym.split('-').map(Number);
    desde = `${y}-${String(m).padStart(2, '0')}-01`;
    const nextM = new Date(y, m, 1);
    hasta = `${nextM.getFullYear()}-${String(nextM.getMonth() + 1).padStart(2, '0')}-01`;
  } else {
    const hace12 = new Date(hoy); hace12.setMonth(hace12.getMonth() - 12);
    desde = `${hace12.getFullYear()}-${String(hace12.getMonth() + 1).padStart(2, '0')}-01`;
    const nextM = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1);
    hasta = `${nextM.getFullYear()}-${String(nextM.getMonth() + 1).padStart(2, '0')}-01`;
  }

  // Exact SQL: r.inicio >= desde AND r.inicio < hasta, r.fin IS NOT NULL,
  // coalesce(eliminada,false)=false, centro NOT IN (...)
  const { data: regs } = await supabase
    .from('registros_trabajo')
    .select('proyecto_id, inicio, fin, centro')
    .not('fin', 'is', null)
    .or('eliminada.is.null,eliminada.eq.false')
    .gte('inicio', desde)
    .lt('inicio', hasta);

  const EXCLUIR = new Set(['descanso','reunion','compras','coordinacion','presu']);
  const filtrados = (regs || []).filter(r => r.proyecto_id && !EXCLUIR.has(r.centro));

  const proyIdsAll = [...new Set(filtrados.map(r => r.proyecto_id))];
  const proyEstados = {};
  if (proyIdsAll.length) {
    const { data: ps } = await supabase
      .from('proyectos_cache').select('id, estado, activo')
      .in('id', proyIdsAll);
    for (const p of (ps || [])) proyEstados[p.id] = p;
  }

  let hs_curso = 0, hs_cerrados = 0;
  const proyCurso = new Set();

  for (const r of filtrados) {
    const p = proyEstados[r.proyecto_id];
    if (!p) continue;
    const dur = (new Date(r.fin) - new Date(r.inicio)) / 3600000;
    if (dur <= 0) continue;
    if (p.estado === 'terminado') {
      hs_cerrados += dur;
    } else {
      hs_curso += dur;
      if (p.activo !== false) proyCurso.add(r.proyecto_id);
    }
  }

  return ok(res, {
    periodo, desde, hasta,
    hs_curso: Math.round(hs_curso),
    hs_cerrados: Math.round(hs_cerrados),
    proyectos_curso: proyCurso.size,
  });
}

// ══════════════════════════════════════════════════════════════════════════
// ENDPOINT 16 — GET lean-cnc-dia
// ══════════════════════════════════════════════════════════════════════════

async function accionLeanCncDia(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  const seccion = verificarAccesoSeccion(req);
  if (!seccion) return err(res, 'Token de sección inválido o expirado', 401);

  const { periodo, desde, hasta } = _parsePeriodo(req.query);

  // Placas por día
  const { data: placas } = await supabase
    .from('registros_cnc')
    .select('inicio, fin, resultado')
    .not('inicio', 'is', null)
    .gte('inicio', desde + 'T00:00:00')
    .lte('inicio', hasta + 'T23:59:59');

  const porDia = {};
  for (const p of (placas || [])) {
    const dia = p.inicio.slice(0, 10);
    if (!porDia[dia]) porDia[dia] = { ok: 0, error: 0, saltada: 0 };
    const res_tipo = p.resultado || 'saltada';
    if (res_tipo === 'ok') porDia[dia].ok++;
    else if (res_tipo === 'error') porDia[dia].error++;
    else porDia[dia].saltada++;
  }

  const diasArr = Object.entries(porDia)
    .map(([dia, v]) => ({ dia, placas_ok: v.ok, placas_error: v.error, placas_saltada: v.saltada }))
    .sort((a, b) => a.dia.localeCompare(b.dia));
  const promedio = diasArr.length ? round1(diasArr.reduce((s, d) => s + d.placas_ok, 0) / diasArr.length) : 0;

  // Efectividad hoy
  const hoyStr = new Date().toISOString().split('T')[0];
  const placasHoy = (placas || []).filter(p => p.inicio.slice(0, 10) === hoyStr);
  let en_corte_sec = 0;
  for (const p of placasHoy) {
    if (p.fin) en_corte_sec += (new Date(p.fin) - new Date(p.inicio)) / 1000;
  }

  // Turno: span from registros_trabajo linked via registro_trabajo_id
  const regIds = [...new Set(placasHoy.map(p => p.registro_trabajo_id).filter(Boolean))];
  let turno_sec = 0;
  let operario = null;
  if (regIds.length) {
    // We don't have registro_trabajo_id in our select — re-query today's cnc with it
    const { data: cncHoy } = await supabase
      .from('registros_cnc')
      .select('registro_trabajo_id, placa_numero, resultado, empleado_id')
      .gte('inicio', hoyStr + 'T00:00:00')
      .lte('inicio', hoyStr + 'T23:59:59')
      .order('inicio', { ascending: false });
    const rtIds = [...new Set((cncHoy || []).map(c => c.registro_trabajo_id).filter(Boolean))];
    if (rtIds.length) {
      const { data: rts } = await supabase
        .from('registros_trabajo')
        .select('id, inicio, fin, empleado_id')
        .in('id', rtIds);
      for (const rt of (rts || [])) {
        const fin = rt.fin ? new Date(rt.fin) : new Date();
        turno_sec += (fin - new Date(rt.inicio)) / 1000;
      }
    }
    // Last placa + operario
    const ultima = (cncHoy || [])[0];
    if (ultima) {
      const { data: emp } = await supabase
        .from('empleados').select('nombre').eq('id', ultima.empleado_id).maybeSingle();
      operario = emp?.nombre || null;
    }
  }

  const en_corte_min = round1(en_corte_sec / 60);
  const turno_min = round1(turno_sec / 60);
  const detenido_min = round1(Math.max(0, turno_min - en_corte_min));
  const efectividad_pct = turno_min > 0 ? round1(en_corte_min / turno_min * 100) : 0;
  const placasOkHoy = placasHoy.filter(p => p.resultado === 'ok').map(p => p.placa_numero || 0);
  const ultimaPlaca = placasHoy.length ? { numero: placasOkHoy.length ? Math.max(...placasOkHoy) : 0, resultado: placasHoy[0]?.resultado || null } : null;

  return ok(res, {
    periodo, desde, hasta,
    placas_dia: diasArr,
    promedio_placas_ok: promedio,
    efectividad: {
      pct: efectividad_pct,
      en_corte_min, detenido_min, turno_min,
      ultima_placa: ultimaPlaca,
      operario,
      aproximada: true,
    },
  });
}

// ══════════════════════════════════════════════════════════════════════════
// ENDPOINT 17 — GET lean-compras-serie
// ══════════════════════════════════════════════════════════════════════════

async function accionLeanComprasSerie(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  const seccion = verificarAccesoSeccion(req);
  if (!seccion) return err(res, 'Token de sección inválido o expirado', 401);

  const { periodo, desde, hasta } = _parsePeriodo(req.query);

  const [comprasR, kittingR, ocDirectoR] = await Promise.all([
    supabase.from('compras_oc')
      .select('fecha, total_usd')
      .gte('fecha', desde).lte('fecha', hasta)
      .not('total_usd', 'is', null)
      .not('es_material', 'is', false)
      .not('estado', 'in', '(cancelled,draft,rejected)')
      .order('fecha'),
    supabase.from('so_estado')
      .select('fecha, total_usd')
      .gte('fecha', desde).lte('fecha', hasta)
      .not('total_usd', 'is', null)
      .or('oculta.is.null,oculta.eq.false')
      .order('fecha'),
    supabase.from('costos_directos_proyecto')
      .select('fecha, monto_usd')
      .eq('tipo', 'oc')
      .gte('fecha', desde).lte('fecha', hasta)
      .order('fecha'),
  ]);

  const days = {};
  for (const r of (comprasR.data || [])) {
    const d = r.fecha; if (!days[d]) days[d] = { comprado: 0, kitting: 0, oc_directo: 0 };
    days[d].comprado += Number(r.total_usd) || 0;
  }
  for (const r of (kittingR.data || [])) {
    const d = r.fecha; if (!days[d]) days[d] = { comprado: 0, kitting: 0, oc_directo: 0 };
    days[d].kitting += Number(r.total_usd) || 0;
  }
  for (const r of (ocDirectoR.data || [])) {
    const d = r.fecha; if (!days[d]) days[d] = { comprado: 0, kitting: 0, oc_directo: 0 };
    days[d].oc_directo += Number(r.monto_usd) || 0;
  }

  const sorted = Object.entries(days).sort((a, b) => a[0].localeCompare(b[0]));
  let cComp = 0, cAsig = 0;
  const serie = sorted.map(([dia, v]) => {
    cComp += v.comprado;
    cAsig += v.kitting + v.oc_directo;
    return { dia, comprado_acum: round2(cComp), asignado_acum: round2(cAsig) };
  });

  return ok(res, { periodo, desde, hasta, serie });
}

// ══════════════════════════════════════════════════════════════════════════
// ENDPOINT 18 — POST importar-factura-lineas
// ══════════════════════════════════════════════════════════════════════════

async function accionImportarFacturaLineas(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const seccion = verificarAccesoSeccion(req);
  if (!seccion) return err(res, 'Token de sección inválido o expirado', 401);

  const page = parseInt(req.query.page || req.body?.page) || 1;
  const per_page = parseInt(req.query.per_page || req.body?.per_page) || 20;

  let zohoToken;
  try { zohoToken = await getZohoToken(); } catch (e) {
    return err(res, 'No se pudo obtener token de Zoho: ' + e.message, 502);
  }
  const orgId = process.env.ZOHO_ORG_ID;

  // 1. List invoices (page)
  const listUrl = `https://www.zohoapis.com/books/v3/invoices?organization_id=${orgId}&per_page=${per_page}&page=${page}&sort_column=date&sort_order=D`;
  const listRes = await fetch(listUrl, { headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` } });
  const listData = await listRes.json();
  const invoices = (listData?.invoices || []).filter(inv => inv.status !== 'void' && inv.status !== 'draft');
  const has_more = listData?.page_context?.has_more_page === true;

  // 2. Lookup proyectos_cache by numero for project matching
  const invNumbers = [...new Set(invoices.map(i => i.invoice_number).filter(Boolean))];
  let proyByNumero = {};
  if (invNumbers.length) {
    const { data: proys } = await supabase.from('proyectos_cache').select('id, numero').in('numero', invNumbers);
    for (const p of (proys || [])) {
      if (!proyByNumero[p.numero]) proyByNumero[p.numero] = [];
      proyByNumero[p.numero].push(p.id);
    }
  }

  // 3. Fetch details in batches of 5
  let procesadas = 0, lineas_upsert = 0, sinProyecto = 0;
  const conflictos = [];
  const BATCH = 5;

  for (let i = 0; i < invoices.length; i += BATCH) {
    const lote = invoices.slice(i, i + BATCH);
    await Promise.all(lote.map(async (inv) => {
      try {
        const detUrl = `https://www.zohoapis.com/books/v3/invoices/${inv.invoice_id}?organization_id=${orgId}`;
        const detRes = await fetch(detUrl, { headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` } });
        const detData = await detRes.json();
        const invoice = detData?.invoice;
        if (!invoice) return;
        procesadas++;

        const lineItems = invoice.line_items || [];
        const invNum = invoice.invoice_number;
        const matches = proyByNumero[invNum] || [];
        const proyecto_id = matches.length === 1 ? matches[0] : null;
        if (matches.length > 1 && invNum) conflictos.push(invNum);
        else if (matches.length === 0 && invNum) sinProyecto++;

        const rows = lineItems.map(li => {
          const cfs = li.item_custom_fields || [];
          const cfTipo = cfs.find(f => f.api_name === 'cf_tipo');
          const cf_tipo = cfTipo ? (String(cfTipo.value || '').trim() || null) : null;
          return {
            id: String(li.line_item_id),
            invoice_id: inv.invoice_id,
            invoice_number: invNum,
            proyecto_id,
            cf_tipo,
            descripcion: li.description || null,
            cantidad: Number(li.quantity) || 0,
            monto_usd: round2((Number(li.bcy_rate) || 0) * (Number(li.quantity) || 0)),
            moneda: invoice.currency_code || null,
            tipo_cambio: Number(invoice.exchange_rate) || null,
            descuento_factura_pct: Number(invoice.discount_percent) || null,
            fecha: invoice.date || null,
            estado_factura: invoice.status || null,
            importado_en: new Date().toISOString(),
          };
        });

        if (rows.length) {
          const { error: upErr } = await supabase.from('factura_lineas').upsert(rows, { onConflict: 'id' });
          if (upErr) console.warn('[importar-factura-lineas] upsert error:', invNum, upErr.message);
          else lineas_upsert += rows.length;
        }
      } catch (e) {
        console.warn('[importar-factura-lineas] invoice error:', inv.invoice_id, e.message);
      }
    }));
    if (i + BATCH < invoices.length) await new Promise(r => setTimeout(r, 1000));
  }

  return ok(res, {
    ok: true,
    page,
    procesadas,
    lineas_upsert,
    conflictos: [...new Set(conflictos)],
    sin_proyecto: sinProyecto,
    has_more,
    next_page: has_more ? page + 1 : null,
  });
}

// ══════════════════════════════════════════════════════════════════════════
// ENDPOINT 19 — GET reconciliar-facturas
// ══════════════════════════════════════════════════════════════════════════

async function accionReconciliarFacturas(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  const seccion = verificarAccesoSeccion(req);
  if (!seccion) return err(res, 'Token de sección inválido o expirado', 401);

  // All lines with proyecto_id set
  const { data: lineas } = await supabase.from('factura_lineas')
    .select('invoice_number, proyecto_id, cf_tipo, monto_usd')
    .not('proyecto_id', 'is', null);

  // Group by invoice_number
  const porInv = {};
  for (const l of (lineas || [])) {
    if (!porInv[l.invoice_number]) porInv[l.invoice_number] = { proyecto_id: l.proyecto_id, lineas: [] };
    porInv[l.invoice_number].lineas.push(l);
  }

  // Load matching projects
  const proyIds = [...new Set(Object.values(porInv).map(v => v.proyecto_id))];
  const proyMap = {};
  if (proyIds.length) {
    const { data: proys } = await supabase.from('proyectos_cache')
      .select('id, numero, precio_venta_usd, muebles')
      .in('id', proyIds);
    for (const p of (proys || [])) proyMap[p.id] = p;
  }

  const proyectos = [];
  let totalLineas = 0, totalErp = 0, totalDiff = 0;
  let totalMatch = 0, totalNoMatch = 0, totalSinLinea = 0;

  for (const [invNum, group] of Object.entries(porInv)) {
    const proy = proyMap[group.proyecto_id];
    if (!proy) continue;

    const suma_lineas_usd = round2(group.lineas.reduce((s, l) => s + (Number(l.monto_usd) || 0), 0));
    const precio_erp = round2(Number(proy.precio_venta_usd) || 0);
    const diff = round2(suma_lineas_usd - precio_erp);

    // Code coverage: cf_tipo vs muebles[].codigo
    const muebles = Array.isArray(proy.muebles) ? proy.muebles : [];
    const codigosProyecto = new Set(muebles.map(m => m.codigo).filter(Boolean));
    const cfTipos = group.lineas.map(l => l.cf_tipo).filter(Boolean);

    let lineas_con_match = 0, lineas_sin_match = 0;
    for (const cf of cfTipos) {
      if (codigosProyecto.has(cf)) lineas_con_match++;
      else lineas_sin_match++;
    }
    const muebles_sin_linea = [...codigosProyecto].filter(c => !cfTipos.includes(c)).length;

    totalLineas += suma_lineas_usd;
    totalErp += precio_erp;
    totalDiff += diff;
    totalMatch += lineas_con_match;
    totalNoMatch += lineas_sin_match;
    totalSinLinea += muebles_sin_linea;

    proyectos.push({
      invoice_number: invNum,
      proyecto_id: group.proyecto_id,
      proyecto_numero: proy.numero,
      suma_lineas_usd,
      precio_erp,
      diff,
      cobertura: {
        lineas_con_match,
        lineas_sin_match,
        muebles_sin_linea,
        total_lineas: group.lineas.length,
        total_muebles: muebles.length,
      },
    });
  }

  proyectos.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  return ok(res, {
    ok: true,
    proyectos,
    totales: {
      proyectos: proyectos.length,
      suma_lineas_usd: round2(totalLineas),
      suma_erp_usd: round2(totalErp),
      diff_total: round2(totalDiff),
      lineas_con_match: totalMatch,
      lineas_sin_match: totalNoMatch,
      muebles_sin_linea: totalSinLinea,
    },
  });
}

// ══════════════════════════════════════════════════════════════════════════
// ENDPOINT 10 — POST sincronizar-kitting
// ══════════════════════════════════════════════════════════════════════════

async function accionSincronizarKitting(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const seccion = verificarAccesoSeccion(req);
  if (!seccion) return err(res, 'Token de sección inválido o expirado', 401);

  const dry = req.query.dry === '1';

  // SO con zoho id
  const { data: sos, error: soErr } = await supabase
    .from('so_estado').select('so_zoho_id, so_numero, proyecto_id')
    .not('so_zoho_id', 'is', null);
  if (soErr) throw soErr;
  if (!sos || !sos.length) return ok(res, { dry, sos: 0, proyectos: 0, sin_total: 0 });

  // TC
  const { data: tcRow } = await supabase
    .from('tipo_cambio').select('valor')
    .eq('moneda_origen', 'UYU').eq('moneda_destino', 'USD').maybeSingle();
  const tcUyuUsd = tcRow ? Number(tcRow.valor) : 0;

  let zohoToken;
  try { zohoToken = await getZohoToken(); } catch (e) {
    return err(res, 'No se pudo obtener token de Zoho: ' + e.message, 502);
  }
  const orgId = process.env.ZOHO_ORG_ID;

  // Fetch SO details in batches of 200 ids
  const soMap = {}; // so_zoho_id → zoho SO object
  const BATCH = 200;
  const allIds = sos.map(s => s.so_zoho_id);
  for (let i = 0; i < allIds.length; i += BATCH) {
    const lote = allIds.slice(i, i + BATCH);
    const idsParam = lote.join(',');
    try {
      const url = `https://www.zohoapis.com/books/v3/salesorders?organization_id=${orgId}&salesorder_ids=${encodeURIComponent(idsParam)}`;
      const zRes = await fetch(url, { headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` } });
      const zData = await zRes.json();
      for (const so of (zData?.salesorders || [])) {
        soMap[so.salesorder_id] = so;
      }
    } catch (e) {
      console.warn('[sync-kitting] batch fetch error:', e.message);
    }
    if (i + BATCH < allIds.length) await new Promise(r => setTimeout(r, 1000));
  }

  // Process each SO
  let sinTotal = 0;
  const monedas = {};
  const porProyecto = {}; // proyecto_id → sum total_usd
  const ahora = new Date().toISOString();

  for (const so of sos) {
    const z = soMap[so.so_zoho_id];
    if (!z) { sinTotal++; continue; }

    const moneda = z.currency_code || 'USD';
    monedas[moneda] = (monedas[moneda] || 0) + 1;
    const totalOrigen = Number(z.total) || 0;
    let totalUsd = null;

    if (moneda === 'USD') {
      totalUsd = round2(totalOrigen);
    } else if (moneda === 'UYU') {
      totalUsd = tcUyuUsd > 0 ? round2(totalOrigen / tcUyuUsd) : null;
    }
    // Other currencies: totalUsd stays null

    if (totalUsd == null) sinTotal++;

    if (!dry) {
      await supabase.from('so_estado').update({
        total_usd: totalUsd,
        fecha: z.date || null,
        moneda,
        sync_at: ahora,
      }).eq('so_zoho_id', so.so_zoho_id);
    }

    if (totalUsd != null && so.proyecto_id) {
      porProyecto[so.proyecto_id] = (porProyecto[so.proyecto_id] || 0) + totalUsd;
    }
  }

  // Recalculate costo_kitting_usd from so_estado (source of truth, not in-memory accumulator)
  const proyIds = [...new Set(sos.map(s => s.proyecto_id).filter(Boolean))];
  if (!dry && proyIds.length) {
    const { data: sumsDB } = await supabase
      .from('so_estado')
      .select('proyecto_id, total_usd')
      .in('proyecto_id', proyIds)
      .not('total_usd', 'is', null);
    const sumByProy = {};
    for (const r of (sumsDB || [])) {
      sumByProy[r.proyecto_id] = (sumByProy[r.proyecto_id] || 0) + Number(r.total_usd);
    }
    for (const pid of proyIds) {
      await supabase.from('proyectos_cache')
        .update({ costo_kitting_usd: round2(sumByProy[pid] || 0) })
        .eq('id', pid);
    }
  }

  return ok(res, {
    dry,
    sos: sos.length,
    proyectos: proyIds.length,
    sin_total: sinTotal,
    monedas,
    por_proyecto: dry ? Object.entries(porProyecto).map(([id, suma]) => ({ id, suma: round2(suma) })) : undefined,
  });
}

// ══════════════════════════════════════════════════════════════════════════
// ENDPOINT 11 — POST sincronizar-compras
// ══════════════════════════════════════════════════════════════════════════

async function accionSincronizarCompras(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const seccion = verificarAccesoSeccion(req);
  if (!seccion) return err(res, 'Token de sección inválido o expirado', 401);

  const dry = req.query.dry === '1';

  // TC
  const { data: tcRow } = await supabase
    .from('tipo_cambio').select('valor')
    .eq('moneda_origen', 'UYU').eq('moneda_destino', 'USD').maybeSingle();
  const tcUyuUsd = tcRow ? Number(tcRow.valor) : 0;

  let zohoToken;
  try { zohoToken = await getZohoToken(); } catch (e) {
    return err(res, 'No se pudo obtener token de Zoho: ' + e.message, 502);
  }
  const orgId = process.env.ZOHO_ORG_ID;

  // Date range (default last 90 days)
  const hoy = new Date();
  const hace90 = new Date(hoy.getTime() - 90 * 86400000);
  const dateAfter = req.query.date_after || hace90.toISOString().split('T')[0];
  const dateBefore = req.query.date_before || hoy.toISOString().split('T')[0];

  // Paginate purchase orders from Zoho
  let allPOs = [];
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const url = `https://www.zohoapis.com/books/v3/purchaseorders?organization_id=${orgId}&date_after=${dateAfter}&date_before=${dateBefore}&per_page=200&page=${page}`;
    const zRes = await fetch(url, { headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` } });
    const zData = await zRes.json();
    const pos = zData?.purchaseorders || [];
    allPOs = allPOs.concat(pos);
    hasMore = zData?.page_context?.has_more_page === true;
    page++;
    if (hasMore) await new Promise(r => setTimeout(r, 1000));
  }

  // Process and upsert
  const ahora = new Date().toISOString();
  let upserted = 0;
  const sumasPorMoneda = {};

  for (const po of allPOs) {
    const moneda = po.currency_code || 'USD';
    const totalOrigen = Number(po.total) || 0;
    let totalUsd = null;

    if (moneda === 'USD') {
      totalUsd = round2(totalOrigen);
    } else if (moneda === 'UYU') {
      totalUsd = tcUyuUsd > 0 ? round2(totalOrigen / tcUyuUsd) : null;
    }

    sumasPorMoneda[moneda] = (sumasPorMoneda[moneda] || 0) + (totalUsd || 0);

    if (!dry) {
      const { error: upErr } = await supabase.from('compras_oc').upsert({
        oc_numero: po.purchaseorder_number,
        oc_zoho_id: po.purchaseorder_id,
        proveedor: po.vendor_name || null,
        fecha: po.date || null,
        total_original: totalOrigen,
        moneda,
        total_usd: totalUsd,
        estado: po.status || null,
        sync_at: ahora,
      }, { onConflict: 'oc_numero' });
      if (upErr) console.warn('[sync-compras] upsert error:', po.purchaseorder_number, upErr.message);
      else upserted++;
    } else {
      upserted++;
    }
  }

  return ok(res, {
    dry,
    purchase_orders: allPOs.length,
    upserted,
    sumas_por_moneda: sumasPorMoneda,
    rango: { desde: dateAfter, hasta: dateBefore },
  });
}

// ══════════════════════════════════════════════════════════════════════════
// ENDPOINT 12 — GET costos-flujo
// ══════════════════════════════════════════════════════════════════════════

// ── Helper: parsear período desde query ─────────────────────────────────
function _parsePeriodo(query) {
  const periodo = query.periodo || 'mes';
  const hoy = new Date();
  let desde, hasta;
  if (periodo === 'elegir' && query.ym) {
    const [y, m] = query.ym.split('-').map(Number);
    desde = `${y}-${String(m).padStart(2, '0')}-01`;
    const last = new Date(y, m, 0).getDate();
    const hastaDate = (y === hoy.getFullYear() && m === hoy.getMonth() + 1) ? hoy.toISOString().split('T')[0] : `${y}-${String(m).padStart(2, '0')}-${last}`;
    hasta = hastaDate;
  } else if (periodo === 'mes') {
    desde = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`;
    hasta = hoy.toISOString().split('T')[0];
  } else if (periodo === 'anio') {
    desde = `${hoy.getFullYear()}-01-01`;
    hasta = hoy.toISOString().split('T')[0];
  } else {
    const hace12 = new Date(hoy);
    hace12.setMonth(hace12.getMonth() - 12);
    desde = hace12.toISOString().split('T')[0];
    hasta = hoy.toISOString().split('T')[0];
  }
  return { periodo, desde, hasta };
}

async function accionCostosFlujo(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  const seccion = verificarAccesoSeccion(req);
  if (!seccion) return err(res, 'Token de sección inválido o expirado', 401);

  const { periodo, desde, hasta } = _parsePeriodo(req.query);

  // Parallel queries
  const [comprasR, kittingR, ocDirectoR] = await Promise.all([
    supabase.from('compras_oc')
      .select('total_usd')
      .gte('fecha', desde).lte('fecha', hasta)
      .not('total_usd', 'is', null)
      .not('es_material', 'is', false)
      .not('estado', 'in', '(cancelled,draft,rejected)'),
    supabase.from('so_estado')
      .select('total_usd')
      .gte('fecha', desde).lte('fecha', hasta)
      .not('total_usd', 'is', null),
    supabase.from('costos_directos_proyecto')
      .select('monto_usd')
      .eq('tipo', 'oc')
      .gte('fecha', desde).lte('fecha', hasta),
  ]);

  const comprado_usd = round2((comprasR.data || []).reduce((s, r) => s + (Number(r.total_usd) || 0), 0));
  const asignado_kitting_usd = round2((kittingR.data || []).reduce((s, r) => s + (Number(r.total_usd) || 0), 0));
  const asignado_oc_directo_usd = round2((ocDirectoR.data || []).reduce((s, r) => s + (Number(r.monto_usd) || 0), 0));
  const asignado_usd = round2(asignado_kitting_usd + asignado_oc_directo_usd);
  const gap_usd = round2(comprado_usd - asignado_usd);

  return ok(res, {
    periodo,
    desde,
    hasta,
    comprado_usd,
    asignado_kitting_usd,
    asignado_oc_directo_usd,
    asignado_usd,
    gap_usd,
  });
}

// ══════════════════════════════════════════════════════════════════════════
// ENDPOINT — POST importar-precios-muebles (cf_tipo match → precios_muebles)
// ══════════════════════════════════════════════════════════════════════════

async function accionImportarPreciosMuebles(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const caller = await verificarSesionAdminOficina(req);
  if (!caller) return err(res, 'Sesión inválida o sin permisos', 401);

  // 1. Proyectos activos en_produccion con muebles
  const { data: proyectos } = await supabase
    .from('proyectos_cache').select('id, numero, muebles')
    .eq('activo', true).eq('estado', 'en_produccion');
  const proysConMuebles = (proyectos || []).filter(p => Array.isArray(p.muebles) && p.muebles.length);

  // 2. Zoho token
  let zohoToken;
  try { zohoToken = await getZohoToken(); } catch (e) {
    return err(res, 'No se pudo obtener token de Zoho: ' + e.message, 502);
  }
  const orgId = process.env.ZOHO_ORG_ID;

  let proysProcesados = 0, mueblesConPrecio = 0, mueblesSinMatch = 0, facturasNoEncontradas = 0;
  const ahora = new Date().toISOString();

  // 3. Process each project
  for (const proy of proysConMuebles) {
    const muebles = proy.muebles;

    // Collect odfIds from muebles (all share the same one typically)
    const odfIds = [...new Set(muebles.map(m => m.odfId).filter(Boolean))];

    // If no odfId, try searching by project numero
    let invoices = [];
    if (odfIds.length) {
      for (const odfId of odfIds) {
        try {
          const detUrl = `https://www.zohoapis.com/books/v3/invoices/${odfId}?organization_id=${orgId}`;
          const detRes = await fetch(detUrl, { headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` } });
          const detData = await detRes.json();
          if (detData?.invoice) invoices.push(detData.invoice);
        } catch (_) {}
      }
    } else if (proy.numero) {
      try {
        const searchUrl = `https://www.zohoapis.com/books/v3/invoices?organization_id=${orgId}&search_text=${encodeURIComponent(proy.numero)}`;
        const sRes = await fetch(searchUrl, { headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` } });
        const sData = await sRes.json();
        const inv = sData?.invoices?.[0];
        if (inv?.invoice_id) {
          const detUrl = `https://www.zohoapis.com/books/v3/invoices/${inv.invoice_id}?organization_id=${orgId}`;
          const detRes = await fetch(detUrl, { headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` } });
          const detData = await detRes.json();
          if (detData?.invoice) invoices.push(detData.invoice);
        }
      } catch (_) {}
    }

    if (!invoices.length) { facturasNoEncontradas++; continue; }
    proysProcesados++;

    // Build cf_tipo → { bcy_rate, quantity } map from all invoices' line_items
    const cfMap = {};
    for (const invoice of invoices) {
      for (const li of (invoice.line_items || [])) {
        const cfs = li.item_custom_fields || [];
        const cfTipo = cfs.find(f => f.api_name === 'cf_tipo');
        const val = cfTipo?.value;
        if (val && (typeof val === 'string' || typeof val === 'number')) {
          const key = String(val).trim();
          if (key) {
            cfMap[key] = {
              bcy_rate: Number(li.bcy_rate || li.rate || 0),
              quantity: Number(li.quantity || 1),
            };
          }
        }
      }
    }

    // Match each mueble.codigo → cf_tipo
    for (const m of muebles) {
      const codigo = (m.codigo || '').trim();
      if (!codigo) { mueblesSinMatch++; continue; }
      const match = cfMap[codigo];
      if (!match) { mueblesSinMatch++; continue; }

      const precio_total_usd = round2(match.bcy_rate * match.quantity);

      const { error: uErr } = await supabase
        .from('precios_muebles')
        .upsert({
          proyecto_id: proy.id,
          mf_n: m.id,
          codigo: codigo,
          precio_unitario_usd: round2(match.bcy_rate),
          cantidad: match.quantity,
          precio_total_usd,
          fuente: 'zoho_cf_tipo',
          actualizado_en: ahora,
        }, { onConflict: 'proyecto_id,mf_n' });
      if (uErr) console.error('[importar-precios-muebles] upsert error:', proy.numero, m.id, uErr.message);
      else mueblesConPrecio++;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 200));
  }

  return ok(res, {
    proyectos_procesados: proysProcesados,
    muebles_con_precio: mueblesConPrecio,
    muebles_sin_match: mueblesSinMatch,
    facturas_no_encontradas: facturasNoEncontradas,
    total_proyectos: proysConMuebles.length,
  });
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
    if (action === 'congelar-odf')            return await accionCongelarOdf(req, res);
    if (action === 'recalcular-materiales')   return await accionRecalcularMateriales(req, res);
    if (action === 'recalcular-materiales-todos') return await accionRecalcularMaterialesTodos(req, res);
    if (action === 'sincronizar-precios-muebles') return await accionSincronizarPreciosMuebles(req, res);
    if (action === 'sincronizar-kitting')        return await accionSincronizarKitting(req, res);
    if (action === 'sincronizar-compras')        return await accionSincronizarCompras(req, res);
    if (action === 'costos-flujo')               return await accionCostosFlujo(req, res);
    if (action === 'throughput-mensual')          return await accionThroughputMensual(req, res);
    if (action === 'lean-carga-etapa')           return await accionLeanCargaEtapa(req, res);
    if (action === 'lean-carga-etapa-detalle')   return await accionLeanCargaEtapaDetalle(req, res);
    if (action === 'lean-cocina-wip')            return await accionLeanCocinaWip(req, res);
    if (action === 'lean-cnc-dia')               return await accionLeanCncDia(req, res);
    if (action === 'lean-compras-serie')         return await accionLeanComprasSerie(req, res);
    if (action === 'importar-factura-lineas')   return await accionImportarFacturaLineas(req, res);
    if (action === 'reconciliar-facturas')      return await accionReconciliarFacturas(req, res);
    if (action === 'importar-precios-muebles') return await accionImportarPreciosMuebles(req, res);
    return err(res, 'Acción no reconocida');
  } catch (e) {
    console.error('[informes]', action, e);
    return err(res, 'Error interno', 500);
  }
}
