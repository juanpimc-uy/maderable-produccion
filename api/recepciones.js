// api/recepciones.js — Gestión de recepciones de OC (Zoho + Supabase)
import { createClient } from '@supabase/supabase-js';
import { getZohoToken } from './_zoho-token-cache.js';
export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xhfeurinovvsbgobkidy.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

// ── Helpers ──────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function ok(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
function errRes(msg, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const OC_MINIMA = 5522;

// ── Handler ─────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS });

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  let body = {};
  if (req.method === 'POST') {
    try { body = await req.json(); } catch { body = {}; }
  }

  try {

    // ══════════════════════════════════════════════════════════════════════
    // ACCIÓN 1 — listar-ocs (GET)
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'listar-ocs' && req.method === 'GET') {
      const orgId = process.env.ZOHO_ORG_ID;
      const token = await getZohoToken();
      const headers = { Authorization: `Zoho-oauthtoken ${token}` };

      // Tres llamadas paralelas: Open + Billed + Approved
      const [resOpen, resBilled, resApproved] = await Promise.all([
        fetch(`https://www.zohoapis.com/books/v3/purchaseorders?filter_by=Status.Open&organization_id=${orgId}&per_page=200`, { headers }),
        fetch(`https://www.zohoapis.com/books/v3/purchaseorders?filter_by=Status.Billed&organization_id=${orgId}&per_page=200`, { headers }),
        fetch(`https://www.zohoapis.com/books/v3/purchaseorders?filter_by=Status.Approved&organization_id=${orgId}&per_page=200`, { headers }),
      ]);

      if (!resOpen.ok || !resBilled.ok || !resApproved.ok) {
        const detail = !resOpen.ok ? await resOpen.text() : !resBilled.ok ? await resBilled.text() : await resApproved.text();
        return new Response(JSON.stringify({ ok: false, error: 'zoho_error', detalle: detail }), {
          status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }

      const [dataOpen, dataBilled, dataApproved] = await Promise.all([resOpen.json(), resBilled.json(), resApproved.json()]);
      const allOcs = [...(dataOpen.purchaseorders || []), ...(dataBilled.purchaseorders || []), ...(dataApproved.purchaseorders || [])];

      // Filtrar por número >= OC_MINIMA
      const filtradas = allOcs.filter(oc => {
        const num = parseInt((oc.purchaseorder_number || '').replace(/\D/g, ''), 10);
        return !isNaN(num) && num >= OC_MINIMA;
      });

      const ocNumeros = filtradas.map(oc => oc.purchaseorder_number);

      // Consultas paralelas a Supabase
      const [recepcionesRes, reprogramacionesRes] = await Promise.all([
        ocNumeros.length
          ? supabase.from('recepciones_oc').select('*').in('oc_numero', ocNumeros)
          : { data: [], error: null },
        ocNumeros.length
          ? supabase.from('reprogramaciones_oc').select('*').in('oc_numero', ocNumeros).order('creado_en', { ascending: false })
          : { data: [], error: null },
      ]);

      if (recepcionesRes.error) throw recepcionesRes.error;
      if (reprogramacionesRes.error) throw reprogramacionesRes.error;

      const recepcionesMap = {};
      for (const r of (recepcionesRes.data || [])) recepcionesMap[r.oc_numero] = r;

      // Solo la última reprogramación por OC
      const reprogramacionesMap = {};
      for (const r of (reprogramacionesRes.data || [])) {
        if (!reprogramacionesMap[r.oc_numero]) reprogramacionesMap[r.oc_numero] = r;
      }

      const hoy = new Date().toISOString().split('T')[0];

      const resultado = filtradas.map(oc => {
        const num = oc.purchaseorder_number;
        const recepcion = recepcionesMap[num] || null;
        const reprog = reprogramacionesMap[num] || null;
        const fechaOriginal = oc.delivery_date || null;
        const fechaEfectiva = reprog?.fecha_nueva || fechaOriginal;
        const esRecibida = !!recepcion || oc.status === 'billed';

        let estado;
        if (esRecibida) {
          estado = 'recibida';
        } else if (fechaEfectiva && fechaEfectiva < hoy) {
          estado = 'vencida';
        } else {
          estado = 'pendiente';
        }

        return {
          oc_numero: num,
          oc_id_zoho: oc.purchaseorder_id,
          proveedor: oc.vendor_name || '',
          fecha_original: fechaOriginal,
          fecha_efectiva: fechaEfectiva,
          reprogramada: !!reprog,
          motivo_reprogramacion: reprog?.motivo || null,
          estado,
          reference_number: oc.reference_number || null,
          notas_recepcion: recepcion?.notas || null,
          fecha_recepcion: recepcion?.creado_en || null,
        };
      });

      // Ordenar: vencidas primero, pendientes por fecha ASC, recibidas al final
      const ordenEstado = { vencida: 0, pendiente: 1, recibida: 2 };
      resultado.sort((a, b) => {
        const oa = ordenEstado[a.estado] ?? 9;
        const ob = ordenEstado[b.estado] ?? 9;
        if (oa !== ob) return oa - ob;
        const fa = a.fecha_efectiva || '9999';
        const fb = b.fecha_efectiva || '9999';
        return fa.localeCompare(fb);
      });

      return ok({ ok: true, ocs: resultado });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ACCIÓN 2 — recibir-oc (POST)
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'recibir-oc' && req.method === 'POST') {
      const { oc_numero, oc_id_zoho, notas } = body;
      if (!oc_numero) return errRes('oc_numero requerido', 400);

      // 1. Crear Purchase Receive en Zoho (best-effort)
      let zohoReceive = false;
      let zohoError = null;
      if (oc_id_zoho) {
        try {
          const orgId = process.env.ZOHO_ORG_ID;
          const token = await getZohoToken();
          const zHeaders = { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' };

          // Obtener line_items del PO
          const poRes = await fetch(
            `https://www.zohoapis.com/books/v3/purchaseorders/${oc_id_zoho}?organization_id=${orgId}`,
            { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
          );
          if (!poRes.ok) throw new Error('Error obteniendo PO: ' + await poRes.text());
          const poData = await poRes.json();
          const poItems = (poData.purchaseorder?.line_items || [])
            .filter(li => li.line_item_id)
            .map(li => ({ line_item_id: li.line_item_id, quantity_received: li.quantity }));

          if (poItems.length) {
            const hoy = new Date().toISOString().split('T')[0];
            const receiveBody = {
              purchaseorder_id: oc_id_zoho,
              date: hoy,
              line_items: poItems,
            };
            const rcvRes = await fetch(
              `https://www.zohoapis.com/books/v3/purchasereceives?organization_id=${orgId}`,
              { method: 'POST', headers: zHeaders, body: JSON.stringify(receiveBody) }
            );
            if (!rcvRes.ok) {
              const detail = await rcvRes.text();
              throw new Error(detail);
            }
            zohoReceive = true;
          }
        } catch (e) {
          zohoError = e.message;
          console.warn('[recepciones] Zoho receive error:', e.message);
        }
      }

      // 2. Guardar en Supabase (siempre)
      const { error } = await supabase.from('recepciones_oc')
        .upsert({
          oc_numero,
          oc_id_zoho: oc_id_zoho || null,
          notas: notas || null,
          creado_en: new Date().toISOString(),
        }, { onConflict: 'oc_numero' });

      if (error) throw error;
      return ok({ ok: true, zoho_receive: zohoReceive, ...(zohoError ? { zoho_error: zohoError } : {}) });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ACCIÓN 3 — reprogramar-oc (POST)
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'reprogramar-oc' && req.method === 'POST') {
      const { oc_numero, fecha_anterior, fecha_nueva, motivo } = body;
      if (!oc_numero || !fecha_nueva) return errRes('oc_numero y fecha_nueva requeridos', 400);

      const { error } = await supabase.from('reprogramaciones_oc')
        .insert({
          oc_numero,
          fecha_anterior: fecha_anterior || null,
          fecha_nueva,
          motivo: motivo || null,
          creado_en: new Date().toISOString(),
        });

      if (error) throw error;
      return ok({ ok: true });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ACCIÓN 4 — detalle-oc (GET)
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'detalle-oc' && req.method === 'GET') {
      const oc_id_zoho = url.searchParams.get('oc_id_zoho');
      if (!oc_id_zoho) return errRes('oc_id_zoho requerido', 400);

      const orgId = process.env.ZOHO_ORG_ID;
      const token = await getZohoToken();
      const res = await fetch(
        `https://www.zohoapis.com/books/v3/purchaseorders/${oc_id_zoho}?organization_id=${orgId}`,
        { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
      );

      if (!res.ok) {
        const detail = await res.text();
        return new Response(JSON.stringify({ ok: false, error: 'zoho_error', detalle: detail }), {
          status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }

      const data = await res.json();
      const po = data.purchaseorder || {};
      const lineItems = (po.line_items || []).map(li => ({
        line_item_id: li.line_item_id || '',
        item_id: li.item_id,
        name: li.name || '',
        description: li.description || '',
        quantity: li.quantity,
        unit: li.unit || '',
        sku: li.sku || '',
      }));

      return ok({
        ok: true,
        oc_numero: po.purchaseorder_number || '',
        vendor_name: po.vendor_name || '',
        date: po.date || null,
        delivery_date: po.delivery_date || null,
        notes: po.notes || '',
        reference_number: po.reference_number || '',
        line_items: lineItems,
      });
    }

    // ── Acción no reconocida ──────────────────────────────────────────────
    return errRes('Acción no reconocida: ' + action, 400);

  } catch (e) {
    console.error('[recepciones]', e);
    if (e.message?.includes('Zoho')) {
      return new Response(JSON.stringify({ ok: false, error: 'zoho_error', detalle: e.message }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: false, error: 'db_error', detalle: e.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
}
