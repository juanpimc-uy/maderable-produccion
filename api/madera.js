// api/madera.js — Endpoints módulo Madera (Node.js runtime)
// Patrón idéntico a api/despachos.js. Auth browser-facing via admin_id/operario_id.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

function ok(res, data)  { return res.status(200).json({ ok: true, ...data }); }
function err(res, msg, status = 400) { return res.status(status).json({ ok: false, error: msg }); }

// Validar rol admin u oficina
async function requireAdminOficina(res, userId) {
  if (!userId) { err(res, 'admin_id requerido', 400); return null; }
  const { data } = await supabase.from('empleados')
    .select('id, rol_app, nombre').eq('id', userId).eq('activo', true).maybeSingle();
  if (!data || (data.rol_app !== 'admin' && data.rol_app !== 'oficina')) {
    err(res, 'Solo admin u oficina', 403); return null;
  }
  return data;
}

// Validar que existe como empleado activo (cualquier rol)
async function requireEmpleado(res, userId) {
  if (!userId) { err(res, 'operario_id requerido', 400); return null; }
  const { data } = await supabase.from('empleados')
    .select('id, rol_app, nombre').eq('id', userId).eq('activo', true).maybeSingle();
  if (!data) { err(res, 'Empleado no encontrado', 404); return null; }
  return data;
}

// ── Imports de módulos ──
import * as especies from '../lib/madera/especies.js';
import * as espesores from '../lib/madera/espesores.js';
import * as partidas from '../lib/madera/partidas.js';
import * as romaneo from '../lib/madera/romaneo.js';
import * as factura from '../lib/madera/factura.js';
import * as inicial from '../lib/madera/inicial.js';
import * as piezas from '../lib/madera/piezas.js';
import * as etiquetas from '../lib/madera/etiquetas.js';

// ── Handler ──
export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  res.setHeader('Access-Control-Allow-Origin', '*');

  const action = req.query.action;
  const body = req.body || {};
  const query = req.query || {};

  try {
    // ── Catálogos (lectura libre, escritura admin/oficina) ──
    if (action === 'especies' && req.method === 'GET') {
      return ok(res, await especies.listar(supabase));
    }
    if (action === 'crear-especie' && req.method === 'POST') {
      if (!await requireAdminOficina(res, body.admin_id)) return;
      return ok(res, await especies.crear(supabase, body));
    }
    if (action === 'espesores' && req.method === 'GET') {
      return ok(res, await espesores.listar(supabase));
    }
    if (action === 'crear-espesor' && req.method === 'POST') {
      if (!await requireAdminOficina(res, body.admin_id)) return;
      return ok(res, await espesores.crear(supabase, body));
    }

    // ── Fase 0: recepciones esperadas ──
    if (action === 'crear-recepcion-esperada' && req.method === 'POST') {
      if (!await requireAdminOficina(res, body.admin_id)) return;
      return ok(res, await partidas.crearEsperada(supabase, body));
    }
    if (action === 'editar-recepcion-esperada' && req.method === 'POST') {
      if (!await requireAdminOficina(res, body.admin_id)) return;
      return ok(res, await partidas.editarEsperada(supabase, body));
    }
    if (action === 'eliminar-recepcion-esperada' && req.method === 'POST') {
      if (!await requireAdminOficina(res, body.admin_id)) return;
      return ok(res, await partidas.eliminarEsperada(supabase, body));
    }
    if (action === 'recepciones-esperadas' && req.method === 'GET') {
      return ok(res, await partidas.listarEsperadas(supabase));
    }

    // ── Fase A: romaneo ──
    if (action === 'completar-romaneo' && req.method === 'POST') {
      if (!await requireEmpleado(res, body.operario_id)) return;
      return ok(res, await romaneo.completar(supabase, body));
    }

    // ── Fase B: factura ──
    if (action === 'cargar-factura-partida' && req.method === 'POST') {
      if (!await requireAdminOficina(res, body.admin_id)) return;
      return ok(res, await factura.cargar(supabase, body));
    }

    // ── Stock / consulta ──
    if (action === 'stock-agregado' && req.method === 'GET') {
      return ok(res, await piezas.stockAgregado(supabase));
    }
    if (action === 'partida' && req.method === 'GET') {
      return ok(res, await partidas.detalle(supabase, query));
    }
    if (action === 'pieza' && req.method === 'GET') {
      return ok(res, await piezas.detallePorId(supabase, query));
    }
    if (action === 'partidas-listado' && req.method === 'GET') {
      return ok(res, await partidas.listar(supabase, query));
    }
    if (action === 'archivar-partida' && req.method === 'POST') {
      if (!await requireAdminOficina(res, body.admin_id)) return;
      return ok(res, await partidas.archivar(supabase, body));
    }

    // ── Carga inicial ──
    if (action === 'crear-partida-inicial' && req.method === 'POST') {
      if (!await requireAdminOficina(res, body.admin_id)) return;
      return ok(res, await inicial.crear(supabase, body));
    }
    if (action === 'ultimo-costo-por-producto' && req.method === 'GET') {
      return ok(res, await inicial.ultimoCosto(supabase, query));
    }

    // ── Etiquetas ──
    if (action === 'piezas-pendientes-impresion' && req.method === 'GET') {
      return ok(res, await etiquetas.piezasPendientesImpresion(supabase, query));
    }
    if (action === 'marcar-etiquetas-impresas' && req.method === 'POST') {
      if (!await requireEmpleado(res, body.user_id)) return;
      return ok(res, await etiquetas.marcarEtiquetasImpresas(supabase, body));
    }
    if (action === 'marcar-pieza-para-reimpresion' && req.method === 'POST') {
      if (!await requireAdminOficina(res, body.admin_id)) return;
      return ok(res, await etiquetas.marcarPiezaParaReimpresion(supabase, body));
    }

    return err(res, 'Acción no reconocida');
  } catch (e) {
    console.error('[madera]', action, e);
    return err(res, e.message || 'Error interno', 500);
  }
}
