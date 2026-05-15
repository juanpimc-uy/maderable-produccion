// api/armados.js — MRP Armado de SO
import { createClient } from '@supabase/supabase-js';
export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xhfeurinovvsbgobkidy.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

// ── Zoho token cache (mismo patrón que api/tiempos.js) ──────────────────
let _zohoToken = null;
let _zohoTokenExpiry = 0;
async function getZohoToken() {
  if (_zohoToken && _zohoTokenExpiry > Date.now() + 60000) return _zohoToken;
  const params = new URLSearchParams();
  params.append('client_id',     process.env.ZOHO_CLIENT_ID);
  params.append('client_secret', process.env.ZOHO_CLIENT_SECRET);
  params.append('refresh_token', process.env.ZOHO_REFRESH_TOKEN);
  params.append('grant_type',    'refresh_token');
  const res  = await fetch('https://accounts.zoho.com/oauth/v2/token', { method: 'POST', body: params });
  const data = await res.json();
  if (!data.access_token) throw new Error('No se pudo obtener token de Zoho: ' + (data.error || JSON.stringify(data)));
  _zohoToken       = data.access_token;
  _zohoTokenExpiry = Date.now() + ((data.expires_in || 3600) * 1000);
  return _zohoToken;
}

const ZOHO_ORG = process.env.ZOHO_ORG_ID;

async function zohoGet(path) {
  const token = await getZohoToken();
  const sep = path.includes('?') ? '&' : '?';
  const url = `https://www.zohoapis.com/books/v3/${path}${sep}organization_id=${ZOHO_ORG}`;
  const res = await fetch(url, { headers: { 'Authorization': `Zoho-oauthtoken ${token}` } });
  if (!res.ok) throw new Error(`Zoho ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Helpers ──────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function ok(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
function err(msg, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ── Auth: verificar empleado_id del header ──────────────────────────────
async function autenticar(req) {
  const auth = req.headers.get('Authorization') || '';
  const empleado_id = auth.replace('Bearer ', '').trim();
  if (!empleado_id) return null;
  const { data } = await supabase.from('empleados').select('id,rol_app').eq('id', empleado_id).maybeSingle();
  return data;
}

// ═════════════════════════════════════════════════════════════════════════
// HANDLER
// ═════════════════════════════════════════════════════════════════════════
export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS });

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  let body = {};
  if (req.method === 'POST' || req.method === 'PATCH') {
    try { body = await req.json(); } catch { body = {}; }
  }

  // Auth (opcional — vista standalone de planta no tiene sesión de empleado)
  const caller = await autenticar(req);

  try {

    // ── A) GET listar-sos-zoho ────────────────────────────────────────────
    if (action === 'listar-sos-zoho' && req.method === 'GET') {
      // 1. Traer SOs en borrador de Zoho
      const zohoData = await zohoGet('salesorders?status=draft&per_page=200');
      const salesorders = zohoData.salesorders || [];

      // 2. Traer estado local de Supabase
      const [{ data: estados }, { data: lineasEstado }] = await Promise.all([
        supabase.from('so_estado').select('*'),
        supabase.from('so_lineas_estado').select('so_zoho_id,linea_zoho_id,cantidad_armada,eliminada'),
      ]);

      const estadoMap = {};
      (estados || []).forEach(e => { estadoMap[e.so_zoho_id] = e; });

      const lineasMap = {};
      (lineasEstado || []).forEach(l => {
        if (!lineasMap[l.so_zoho_id]) lineasMap[l.so_zoho_id] = [];
        lineasMap[l.so_zoho_id].push(l);
      });

      // 3. Cruzar
      const sos = salesorders.map(so => {
        const id = so.salesorder_id;
        const est = estadoMap[id] || {};
        const lineas = (lineasMap[id] || []).filter(l => !l.eliminada);
        const lineas_total = lineas.length;
        const lineas_con_avance = lineas.filter(l => l.cantidad_armada > 0).length;

        let estado = 'pendiente';
        if (lineas_con_avance > 0) estado = 'parcial';
        // completo real se valida al expandir

        return {
          so_zoho_id:     id,
          so_numero:      so.salesorder_number,
          cliente_nombre: so.customer_name,
          obra:           so.reference_number || '',
          mueble:         so.subject || '',
          oculta:         est.oculta || false,
          proyecto_id:    est.proyecto_id || null,
          lineas_total,
          lineas_armadas: lineas_con_avance,
          estado,
        };
      });

      return ok({ ok: true, sos });
    }

    // ── B) GET detalle-so-zoho ────────────────────────────────────────────
    if (action === 'detalle-so-zoho' && req.method === 'GET') {
      const so_zoho_id = url.searchParams.get('so_zoho_id');
      if (!so_zoho_id) return err('so_zoho_id requerido');

      // 1. Detalle de Zoho
      const zohoData = await zohoGet(`salesorders/${so_zoho_id}`);
      const so = zohoData.salesorder;
      if (!so) return err('SO no encontrada en Zoho', 404);

      const lineItems = so.line_items || [];

      // 2. Estado local
      const { data: lineasEstado } = await supabase
        .from('so_lineas_estado')
        .select('*')
        .eq('so_zoho_id', so_zoho_id);

      const estadoMap = {};
      (lineasEstado || []).forEach(l => { estadoMap[l.linea_zoho_id] = l; });

      // 3. Cruzar
      const lineas = lineItems.map(li => {
        const est = estadoMap[li.line_item_id] || {};
        return {
          linea_zoho_id:  li.line_item_id,
          descripcion:    li.name || li.description || '',
          cantidad_total: li.quantity,
          cantidad_armada: Number(est.cantidad_armada || 0),
          eliminada:      est.eliminada || false,
        };
      });

      return ok({ ok: true, lineas });
    }

    // ── C) POST upsert-linea-estado ───────────────────────────────────────
    if (action === 'upsert-linea-estado' && req.method === 'POST') {
      const { so_zoho_id, so_numero, linea_zoho_id, empleado_id } = body;
      if (!so_zoho_id || !linea_zoho_id) return err('so_zoho_id y linea_zoho_id requeridos');

      // Lazy upsert de so_estado
      if (so_numero) {
        await supabase.from('so_estado').upsert(
          { so_zoho_id, so_numero },
          { onConflict: 'so_zoho_id', ignoreDuplicates: true }
        );
      }

      // Construir update
      const update = { so_zoho_id, linea_zoho_id, actualizado_en: new Date().toISOString() };
      if (empleado_id) update.actualizado_por = empleado_id;
      if (body.cantidad_armada !== undefined) update.cantidad_armada = Number(body.cantidad_armada);
      if (body.eliminada !== undefined) update.eliminada = body.eliminada;

      const { error } = await supabase.from('so_lineas_estado').upsert(
        update,
        { onConflict: 'so_zoho_id,linea_zoho_id' }
      );
      if (error) throw error;

      return ok({ ok: true });
    }

    // ── D) POST ocultar-so ────────────────────────────────────────────────
    if (action === 'ocultar-so' && req.method === 'POST') {
      const { so_zoho_id, so_numero, oculta } = body;
      if (!so_zoho_id || !so_numero) return err('so_zoho_id y so_numero requeridos');

      const { error } = await supabase.from('so_estado').upsert(
        { so_zoho_id, so_numero, oculta: !!oculta, actualizado_en: new Date().toISOString() },
        { onConflict: 'so_zoho_id' }
      );
      if (error) throw error;

      return ok({ ok: true });
    }

    // ── E) POST vincular-proyecto ─────────────────────────────────────────
    if (action === 'vincular-proyecto' && req.method === 'POST') {
      const { so_zoho_id, so_numero, proyecto_id } = body;
      if (!so_zoho_id || !so_numero) return err('so_zoho_id y so_numero requeridos');

      const { error } = await supabase.from('so_estado').upsert(
        { so_zoho_id, so_numero, proyecto_id: proyecto_id || null, actualizado_en: new Date().toISOString() },
        { onConflict: 'so_zoho_id' }
      );
      if (error) throw error;

      return ok({ ok: true });
    }

    return err('Acción no reconocida: ' + action, 404);

  } catch (e) {
    console.error('armados error:', e);
    return err(e.message || 'Error interno', 500);
  }
}
