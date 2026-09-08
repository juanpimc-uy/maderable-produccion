// api/despachos.js — Endpoints de despacho de muebles (Node.js runtime, NO edge)
// Llamado server-to-server desde ctrl-despachos con header x-internal-secret.
// IMPORTANTE: el secret NUNCA debe vivir en el browser — ctrl-despachos llama desde su backend.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

function ok(res, data)  { return res.status(200).json({ ok: true, ...data }); }
function err(res, msg, status = 400) { return res.status(status).json({ ok: false, msg }); }

function requireInternal(req, res) {
  const secret = process.env.INTERNAL_SECRET;
  if (!secret || req.headers['x-internal-secret'] !== secret) {
    err(res, 'No autorizado', 401);
    return false;
  }
  return true;
}

// normaliza mf_n para que matchee el id del JSONB que usa el ① (con prefijo 'mf_')
function normMf(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  return s.startsWith('mf_') ? s : 'mf_' + s;
}

// ── GET lista-odf-muebles ──────────────────────────────────────────────────
// Devuelve los muebles de un ODF para que ctrl-despachos arme el dropdown.
// Input: ?proyecto_id=pr_...  |  ?odf=ODF-2404  (uno de los dos)
async function accionListaOdfMuebles(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  if (!requireInternal(req, res)) return;

  const proyecto_id = (req.query.proyecto_id || '').trim();
  const odf = (req.query.odf || req.query.numero || '').trim();
  if (!proyecto_id && !odf) return err(res, 'proyecto_id u odf requerido');

  let q = supabase.from('proyectos_cache').select('id, numero, cliente, cliente_nombre, muebles');
  if (proyecto_id) q = q.eq('id', proyecto_id);
  else q = q.eq('numero', odf);
  const { data: proys, error } = await q.limit(1);
  if (error) return err(res, error.message, 500);
  if (!proys || !proys.length) return err(res, 'ODF no encontrado', 404);

  const p = proys[0];

  const { data: desp } = await supabase.from('despachos_muebles')
    .select('mf_n, despachado_full')
    .eq('proyecto_id', p.id);
  const fullSet = new Set((desp || []).filter(d => d.despachado_full).map(d => d.mf_n));

  const muebles = (Array.isArray(p.muebles) ? p.muebles : [])
    .filter(m => !m.archivado)
    .filter(m => (Number(m.placas) || 0) < 999)
    .map(m => ({
      id: m.id,
      codigo: m.codigo || '',
      nombre: m.nombre || '',
      cant: m.cant != null ? m.cant : null,
      despachado: fullSet.has(m.id),
    }));

  return ok(res, {
    proyecto_id: p.id,
    numero: p.numero,
    cliente: p.cliente || p.cliente_nombre || '',
    muebles,
  });
}

// ── POST registrar-despacho ────────────────────────────────────────────────
// Marca un mueble como despachado. Idempotente (upsert por proyecto_id+mf_n+unidad).
// Body: { proyecto_id, mf_n, unidad?='', despachado_full?=true, fecha_despacho?, origen? }
async function accionRegistrarDespacho(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  if (!requireInternal(req, res)) return;

  const b = req.body || {};
  const proyecto_id = (b.proyecto_id || '').trim();
  const mf_n = normMf(b.mf_n);
  const unidad = (b.unidad == null ? '' : String(b.unidad)).trim();
  const despachado_full = b.despachado_full === false ? false : true;
  const fecha_despacho = b.fecha_despacho || new Date().toISOString();

  if (!proyecto_id || !mf_n) return err(res, 'proyecto_id y mf_n requeridos');

  const fila = {
    proyecto_id,
    mf_n,
    unidad,
    despachado_full,
    fecha_despacho,
    actualizado_en: new Date().toISOString(),
  };
  if (b.origen) fila.origen = String(b.origen);

  const { data, error } = await supabase
    .from('despachos_muebles')
    .upsert(fila, { onConflict: 'proyecto_id,mf_n,unidad' })
    .select('id, proyecto_id, mf_n, unidad, despachado_full, fecha_despacho')
    .single();

  if (error) return err(res, error.message, 500);
  return ok(res, { despacho: data });
}

// ═══════════════════════════════════════════════════════════════════════════
// ACCIONES NUEVAS — Módulo de despacho en el ERP (auth por sesión de oficina)
// ═══════════════════════════════════════════════════════════════════════════

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

// ── GET board ─────────────────────────────────────────────────────────────
async function accionBoard(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  const sesion = await verificarSesionAdminOficina(req);
  if (!sesion) return err(res, 'No autorizado', 401);

  // 1. Todos los envíos con su proyecto de despacho
  const { data: envios, error: eErr } = await supabase.from('despacho_envios')
    .select('id, proyecto_id, mf_n, codigo, nombre, cant, impreso, impreso_at, creado_en, envio, completado_sync_en, fuera_sync_en')
    .order('creado_en', { ascending: false });
  if (eErr) return err(res, eErr.message, 500);
  if (!envios || !envios.length) return ok(res, { envios: [], despachados_recientes: [] });

  // 2. Proyectos de despacho
  const dpIds = [...new Set(envios.map(e => e.proyecto_id))];
  const { data: dpRows, error: dpErr } = await supabase.from('despacho_proyectos')
    .select('id, odf_proyecto_id, odf_numero, nombre')
    .in('id', dpIds);
  if (dpErr) return err(res, dpErr.message, 500);
  const dpMap = {};
  (dpRows || []).forEach(d => { dpMap[d.id] = d; });

  // 3. Proyectos del ERP para datos legibles
  const erpIds = [...new Set((dpRows || []).map(d => d.odf_proyecto_id).filter(Boolean))];
  const erpMap = {};
  if (erpIds.length) {
    const { data: erpRows, error: erpErr } = await supabase.from('proyectos_cache')
      .select('id, numero, nombre, obra, cliente, cliente_nombre')
      .in('id', erpIds);
    if (erpErr) return err(res, erpErr.message, 500);
    (erpRows || []).forEach(p => { erpMap[p.id] = p; });
  }

  // 4. Bultos — filtrar por los proyectos que estamos devolviendo, paginado
  const bultos = [];
  const PAGE = 500;
  let bFrom = 0;
  while (true) {
    const { data: batch, error: bErr } = await supabase.from('despacho_bultos')
      .select('id, proyecto_id, numero, descripcion, escaneado, fecha_escaneo, mueble_mf_n, envio')
      .in('proyecto_id', dpIds)
      .order('numero', { ascending: true })
      .range(bFrom, bFrom + PAGE - 1);
    if (bErr) return err(res, bErr.message, 500);
    if (batch && batch.length) bultos.push(...batch);
    if (!batch || batch.length < PAGE) break;
    bFrom += PAGE;
  }

  // Agrupar bultos por (proyecto_id, mueble_mf_n, envio)
  const bultoMap = {};
  (bultos || []).forEach(b => {
    const k = b.proyecto_id + '|' + (b.mueble_mf_n || '') + '|' + (b.envio || 1);
    if (!bultoMap[k]) bultoMap[k] = [];
    bultoMap[k].push(b);
  });

  // 5. Producción y entregas — buscar solo las combinaciones que necesitamos
  const combos = envios.map(e => {
    const dp = dpMap[e.proyecto_id];
    return { erpId: dp ? dp.odf_proyecto_id : null, mfn: e.mf_n };
  }).filter(c => c.erpId);

  const comboErpIds = [...new Set(combos.map(c => c.erpId))];
  let compLogMap = {};
  let entregaMap = {};
  if (comboErpIds.length) {
    const mfns = [...new Set(combos.map(c => c.mfn).filter(Boolean))];
    const { data: logs, error: logErr } = await supabase.from('items_completado_log')
      .select('proyecto_id, item_id, evento, creado_at')
      .in('proyecto_id', comboErpIds)
      .in('item_id', mfns)
      .order('creado_at', { ascending: false });
    if (logErr) return err(res, logErr.message, 500);
    (logs || []).forEach(l => {
      const k = l.proyecto_id + '|' + l.item_id;
      if (!compLogMap[k]) compLogMap[k] = { evento: l.evento, fecha: l.creado_at };
    });

    const { data: entregas, error: entErr } = await supabase.from('entregas_comprometidas')
      .select('proyecto_id, item_id, fecha_comprometida')
      .in('proyecto_id', comboErpIds)
      .order('fecha_comprometida', { ascending: true });
    if (entErr) return err(res, entErr.message, 500);
    (entregas || []).forEach(e => {
      const k = e.proyecto_id + '|' + e.item_id;
      if (!entregaMap[k]) entregaMap[k] = e.fecha_comprometida;
    });
  }

  // 6. Armar resultado
  const hace7d = new Date(Date.now() - 7 * 86400000).toISOString();
  const abiertos = [];
  const despachados = [];

  for (const e of envios) {
    const dp = dpMap[e.proyecto_id] || {};
    const erp = erpMap[dp.odf_proyecto_id] || {};
    const bk = e.proyecto_id + '|' + (e.mf_n || '') + '|' + (e.envio || 1);
    const bs = bultoMap[bk] || [];
    const escaneados = bs.filter(b => b.escaneado).length;
    const todosEscaneados = bs.length > 0 && escaneados === bs.length;

    const erpKey = (dp.odf_proyecto_id || '') + '|' + (e.mf_n || '');
    const produccion = compLogMap[erpKey] || null;
    const fecha_comprometida = entregaMap[erpKey] || null;

    // max(fecha_escaneo) de los bultos — fecha real de salida
    let fechaSalida = null;
    for (const b of bs) {
      if (b.fecha_escaneo && (!fechaSalida || b.fecha_escaneo > fechaSalida)) fechaSalida = b.fecha_escaneo;
    }

    const row = {
      id: e.id, mf_n: e.mf_n, codigo: e.codigo, nombre: e.nombre,
      cant: e.cant, impreso: e.impreso, impreso_at: e.impreso_at,
      creado_en: e.creado_en, envio: e.envio,
      bultos_total: bs.length, bultos_escaneados: escaneados,
      bultos: bs.map(b => ({ id: b.id, numero: b.numero, descripcion: b.descripcion, escaneado: b.escaneado, fecha_escaneo: b.fecha_escaneo })),
      proyecto_id: dp.odf_proyecto_id || null,
      odf_numero: dp.odf_numero || erp.numero || '',
      obra: erp.obra || '',
      cliente: erp.cliente_nombre || erp.cliente || '',
      nombre_proyecto: erp.nombre || '',
      produccion,
      fecha_comprometida,
      fecha_salida: fechaSalida,
    };

    if (todosEscaneados) {
      if (fechaSalida && fechaSalida >= hace7d) despachados.push(row);
    } else {
      abiertos.push(row);
    }
  }

  return ok(res, { envios: abiertos, despachados_recientes: despachados });
}

// ── GET catalogo ──────────────────────────────────────────────────────────
async function accionCatalogo(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  const sesion = await verificarSesionAdminOficina(req);
  if (!sesion) return err(res, 'No autorizado', 401);

  const { data: proys, error: pErr } = await supabase.from('proyectos_cache')
    .select('id, numero, nombre, obra, cliente, cliente_nombre, muebles')
    .eq('activo', true)
    .order('nombre');
  if (pErr) return err(res, pErr.message, 500);

  const result = (proys || []).map(p => {
    const mubs = (Array.isArray(p.muebles) ? p.muebles : [])
      .filter(m => !m.archivado && (Number(m.placas) || 0) < 999);
    return {
      id: p.id, numero: p.numero, nombre: p.nombre, obra: p.obra,
      cliente: p.cliente_nombre || p.cliente || '',
      muebles: mubs.map(m => ({ id: m.id, codigo: m.codigo || m.id, nombre: m.nombre || '', cant: (m.cant != null && !isNaN(Number(m.cant))) ? Math.trunc(Number(m.cant)) : null })),
    };
  });

  return ok(res, { proyectos: result });
}

// ── POST crear-envio ──────────────────────────────────────────────────────
async function accionCrearEnvio(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const sesion = await verificarSesionAdminOficina(req);
  if (!sesion) return err(res, 'No autorizado', 401);

  const b = req.body || {};
  const proyecto_id = (b.proyecto_id || '').trim();
  const mf_n = normMf(b.mf_n);
  const nombre = (b.nombre || '').trim();
  const cantBultos = parseInt(b.bultos);
  if (!proyecto_id || !mf_n) return err(res, 'proyecto_id y mf_n requeridos');
  if (!cantBultos || cantBultos < 1) return err(res, 'bultos debe ser >= 1');

  // Buscar proyecto en ERP para datos
  const { data: proy } = await supabase.from('proyectos_cache')
    .select('id, numero, nombre, obra, cliente, cliente_nombre, muebles')
    .eq('id', proyecto_id).maybeSingle();
  if (!proy) return err(res, 'Proyecto no encontrado', 404);

  const mubs = Array.isArray(proy.muebles) ? proy.muebles : [];
  const mueble = mubs.find(m => m.id === mf_n);
  const codigoMueble = mueble ? (mueble.codigo || mf_n) : mf_n;
  const cantRaw = mueble ? mueble.cant : null;
  const cantMueble = (cantRaw != null && !isNaN(Number(cantRaw))) ? Math.trunc(Number(cantRaw)) : null;

  // Asegurar despacho_proyectos
  let { data: dp } = await supabase.from('despacho_proyectos')
    .select('id').eq('odf_proyecto_id', proyecto_id).maybeSingle();
  if (!dp) {
    const dpNombre = (proy.numero || '') + ' · ' + (proy.cliente_nombre || proy.cliente || '');
    const { data: newDp, error: dpErr } = await supabase.from('despacho_proyectos')
      .insert({ nombre: dpNombre, odf_proyecto_id: proyecto_id, odf_numero: proy.numero || '', estado: 'activo' })
      .select('id').single();
    if (dpErr) return err(res, dpErr.message, 500);
    dp = newDp;
  }

  // Calcular envio = max+1
  const { data: maxEnvRows } = await supabase.from('despacho_envios')
    .select('envio').eq('proyecto_id', dp.id).eq('mf_n', mf_n)
    .order('envio', { ascending: false }).limit(1);
  const envio = (maxEnvRows && maxEnvRows.length) ? (maxEnvRows[0].envio || 0) + 1 : 1;

  // Insertar envío
  const { data: nuevoEnvio, error: eErr } = await supabase.from('despacho_envios')
    .insert({
      proyecto_id: dp.id, mf_n, codigo: codigoMueble, nombre: nombre || (mueble ? mueble.nombre : ''),
      cant: cantMueble, impreso: false, envio,
    })
    .select().single();
  if (eErr) return err(res, eErr.message, 500);

  // Calcular numero global de bulto
  const { data: maxBultoRows } = await supabase.from('despacho_bultos')
    .select('numero').eq('proyecto_id', dp.id)
    .order('numero', { ascending: false }).limit(1);
  let numBase = (maxBultoRows && maxBultoRows.length) ? (maxBultoRows[0].numero || 0) : 0;

  // Insertar bultos
  const bultosFila = [];
  for (let i = 0; i < cantBultos; i++) {
    numBase++;
    const idx = String(i + 1).padStart(2, '0');
    const desc = envio === 1
      ? codigoMueble + '-B' + idx
      : codigoMueble + '-E' + envio + '-B' + idx;
    bultosFila.push({
      proyecto_id: dp.id, numero: numBase, descripcion: desc,
      escaneado: false, mueble_mf_n: mf_n, envio,
    });
  }
  const { data: bultos, error: bErr } = await supabase.from('despacho_bultos')
    .insert(bultosFila).select();
  if (bErr) return err(res, bErr.message, 500);

  return ok(res, { envio: nuevoEnvio, bultos: bultos || [] });
}

// ── POST marcar-impreso ───────────────────────────────────────────────────
async function accionMarcarImpreso(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const sesion = await verificarSesionAdminOficina(req);
  if (!sesion) return err(res, 'No autorizado', 401);

  const { envio_id } = req.body || {};
  if (!envio_id) return err(res, 'envio_id requerido');

  const { data, error } = await supabase.from('despacho_envios')
    .update({ impreso: true, impreso_at: new Date().toISOString() })
    .eq('id', envio_id).select().single();
  if (error) return err(res, error.message, 500);
  if (!data) return err(res, 'Envío no encontrado', 404);
  return ok(res, { envio: data });
}

// ── POST marcar-bulto ─────────────────────────────────────────────────────
async function accionMarcarBulto(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const sesion = await verificarSesionAdminOficina(req);
  if (!sesion) return err(res, 'No autorizado', 401);

  const { bulto_id } = req.body || {};
  if (!bulto_id) return err(res, 'bulto_id requerido');

  const { data: bulto, error: bErr } = await supabase.from('despacho_bultos')
    .update({ escaneado: true, fecha_escaneo: new Date().toISOString() })
    .eq('id', bulto_id).select().single();
  if (bErr) return err(res, bErr.message, 500);
  if (!bulto) return err(res, 'Bulto no encontrado', 404);

  // Chequear si todos los bultos del envío quedaron escaneados
  const { data: hermanos } = await supabase.from('despacho_bultos')
    .select('escaneado')
    .eq('proyecto_id', bulto.proyecto_id)
    .eq('mueble_mf_n', bulto.mueble_mf_n)
    .eq('envio', bulto.envio);
  const todosEscaneados = hermanos && hermanos.length > 0 && hermanos.every(h => h.escaneado);

  if (todosEscaneados) {
    // Buscar el envío y su proyecto para escribir el puente
    const { data: envio } = await supabase.from('despacho_envios')
      .select('id, proyecto_id, mf_n')
      .eq('proyecto_id', bulto.proyecto_id)
      .eq('mf_n', bulto.mueble_mf_n)
      .eq('envio', bulto.envio)
      .maybeSingle();
    if (envio) {
      const { data: dp } = await supabase.from('despacho_proyectos')
        .select('odf_proyecto_id').eq('id', envio.proyecto_id).maybeSingle();
      if (dp && dp.odf_proyecto_id) {
        const ahora = new Date().toISOString();
        // Escribir en despachos_muebles (puente) — shape exacto de despachos-sync.js
        await supabase.from('despachos_muebles').upsert({
          proyecto_id: dp.odf_proyecto_id, mf_n: envio.mf_n, unidad: '',
          despachado_full: true, fecha_despacho: ahora, origen: 'erp-despacho',
          actualizado_en: ahora,
        }, { onConflict: 'proyecto_id,mf_n,unidad' });
        // Marcar envío como sincronizado
        await supabase.from('despacho_envios')
          .update({ fuera_sync_en: ahora })
          .eq('id', envio.id);
      }
    }
  }

  return ok(res, { bulto, todos_escaneados: todosEscaneados });
}

// ── POST editar-envio ─────────────────────────────────────────────────────
async function accionEditarEnvio(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const sesion = await verificarSesionAdminOficina(req);
  if (!sesion) return err(res, 'No autorizado', 401);

  const b = req.body || {};
  const { envio_id } = b;
  if (!envio_id) return err(res, 'envio_id requerido');

  const { data: envio } = await supabase.from('despacho_envios')
    .select('id, proyecto_id, mf_n, envio, codigo').eq('id', envio_id).maybeSingle();
  if (!envio) return err(res, 'Envío no encontrado', 404);

  // Verificar que no haya bultos escaneados
  const { data: bultosActuales } = await supabase.from('despacho_bultos')
    .select('id, escaneado')
    .eq('proyecto_id', envio.proyecto_id)
    .eq('mueble_mf_n', envio.mf_n)
    .eq('envio', envio.envio)
    .order('numero', { ascending: true });
  const escaneados = (bultosActuales || []).filter(x => x.escaneado).length;
  if (escaneados > 0) return err(res, 'No se puede editar: hay ' + escaneados + ' bulto(s) ya escaneado(s)', 409);

  // Actualizar nombre
  const campos = {};
  if (b.nombre !== undefined) campos.nombre = b.nombre;
  if (Object.keys(campos).length) {
    await supabase.from('despacho_envios').update(campos).eq('id', envio_id);
  }

  // Ajustar cantidad de bultos
  const nuevaCant = parseInt(b.bultos);
  if (nuevaCant && nuevaCant > 0) {
    const actual = (bultosActuales || []).length;
    if (nuevaCant > actual) {
      // Agregar las que faltan
      const { data: maxBultoRows } = await supabase.from('despacho_bultos')
        .select('numero').eq('proyecto_id', envio.proyecto_id)
        .order('numero', { ascending: false }).limit(1);
      let numBase = (maxBultoRows && maxBultoRows.length) ? maxBultoRows[0].numero : 0;
      const nuevas = [];
      for (let i = actual; i < nuevaCant; i++) {
        numBase++;
        const idx = String(i + 1).padStart(2, '0');
        const cod = envio.codigo || envio.mf_n || '';
        const desc = envio.envio === 1
          ? cod + '-B' + idx
          : cod + '-E' + envio.envio + '-B' + idx;
        nuevas.push({
          proyecto_id: envio.proyecto_id, numero: numBase, descripcion: desc,
          escaneado: false, mueble_mf_n: envio.mf_n, envio: envio.envio,
        });
      }
      await supabase.from('despacho_bultos').insert(nuevas);
    } else if (nuevaCant < actual) {
      // Borrar los últimos
      const aBorrar = bultosActuales.slice(nuevaCant).map(x => x.id);
      if (aBorrar.length) await supabase.from('despacho_bultos').delete().in('id', aBorrar);
    }
  }

  return ok(res, { editado: true });
}

// ── POST resetear-envio ───────────────────────────────────────────────────
async function accionResetearEnvio(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const sesion = await verificarSesionAdminOficina(req);
  if (!sesion) return err(res, 'No autorizado', 401);

  const { envio_id } = req.body || {};
  if (!envio_id) return err(res, 'envio_id requerido');

  const { data: envio } = await supabase.from('despacho_envios')
    .select('id, proyecto_id, mf_n, envio').eq('id', envio_id).maybeSingle();
  if (!envio) return err(res, 'Envío no encontrado', 404);

  await supabase.from('despacho_bultos')
    .update({ escaneado: false, fecha_escaneo: null })
    .eq('proyecto_id', envio.proyecto_id)
    .eq('mueble_mf_n', envio.mf_n)
    .eq('envio', envio.envio);

  await supabase.from('despacho_envios')
    .update({ impreso: false, impreso_at: null, fuera_sync_en: null })
    .eq('id', envio_id);

  return ok(res, { reseteado: true });
}

// ── POST eliminar-envio ───────────────────────────────────────────────────
async function accionEliminarEnvio(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const sesion = await verificarSesionAdminOficina(req);
  if (!sesion) return err(res, 'No autorizado', 401);

  const { envio_id } = req.body || {};
  if (!envio_id) return err(res, 'envio_id requerido');

  const { data: envio } = await supabase.from('despacho_envios')
    .select('id, proyecto_id, mf_n, envio').eq('id', envio_id).maybeSingle();
  if (!envio) return err(res, 'Envío no encontrado', 404);

  await supabase.from('despacho_bultos')
    .delete()
    .eq('proyecto_id', envio.proyecto_id)
    .eq('mueble_mf_n', envio.mf_n)
    .eq('envio', envio.envio);

  await supabase.from('despacho_envios').delete().eq('id', envio_id);

  return ok(res, { eliminado: true });
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const action = req.query.action;
  try {
    // Server-to-server (ctrl-despachos legacy)
    if (action === 'lista-odf-muebles')  return await accionListaOdfMuebles(req, res);
    if (action === 'registrar-despacho') return await accionRegistrarDespacho(req, res);
    // ERP (sesión de oficina)
    if (action === 'board')              return await accionBoard(req, res);
    if (action === 'catalogo')           return await accionCatalogo(req, res);
    if (action === 'crear-envio')        return await accionCrearEnvio(req, res);
    if (action === 'marcar-impreso')     return await accionMarcarImpreso(req, res);
    if (action === 'marcar-bulto')       return await accionMarcarBulto(req, res);
    if (action === 'editar-envio')       return await accionEditarEnvio(req, res);
    if (action === 'resetear-envio')     return await accionResetearEnvio(req, res);
    if (action === 'eliminar-envio')     return await accionEliminarEnvio(req, res);
    return err(res, 'Acción no reconocida');
  } catch (e) {
    console.error('[despachos]', action, e);
    return err(res, 'Error interno', 500);
  }
}
