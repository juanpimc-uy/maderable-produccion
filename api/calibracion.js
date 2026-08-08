// api/calibracion.js — Barrido de placas por SO desde Zoho (Node.js runtime)
// Auth: x-internal-secret (server-to-server). Lo dispara JP a mano.
import { createClient } from '@supabase/supabase-js';
import { getZohoToken } from './_zoho-token-cache.js';

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

// ── Clasificación de líneas: ¿es placa? ──────────────────────────────────

function esPlaca(name, unit) {
  // Regla A: unit normalizado es PLACA
  if ((unit || '').trim().toUpperCase() === 'PLACA') {
    return { es_placa: true, regla: 'unit', medidas_m: null };
  }

  // Regla B: par de medidas en el name
  const medidas = parsearMedidas(name || '');
  if (medidas) {
    return { es_placa: true, regla: 'medidas', medidas_m: medidas };
  }

  return { es_placa: false, regla: null, medidas_m: null };
}

function parsearMedidas(name) {
  // Buscar pares de números separados por x, X o ×, con espacios opcionales
  // Cada número puede tener decimal con punto o coma
  const regex = /(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)/g;
  let match;
  while ((match = regex.exec(name)) !== null) {
    const a = normalizarAMetros(match[1]);
    const b = normalizarAMetros(match[2]);
    if (a !== null && b !== null && a >= 1.5 && a <= 3.2 && b >= 1.5 && b <= 3.2) {
      return [Math.round(a * 100) / 100, Math.round(b * 100) / 100];
    }
  }
  return null;
}

function normalizarAMetros(raw) {
  const n = parseFloat(raw.replace(',', '.'));
  if (isNaN(n) || n <= 0) return null;
  // Tiene decimal (punto o coma en el raw) → ya está en metros
  if (/[.,]/.test(raw)) return n;
  // Entero >= 1000 → milímetros
  if (n >= 1000) return n / 1000;
  // Entero entre 100 y 999 → centímetros
  if (n >= 100) return n / 100;
  // Cualquier otro caso → no es medida de placa
  return null;
}

// ── Handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // CORS
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-internal-secret');
    return res.status(204).end();
  }
  res.setHeader('Access-Control-Allow-Origin', '*');

  const action = req.query.action;

  try {
    if (action === 'sync-placas' && req.method === 'GET') {
      if (!requireInternal(req, res)) return;

      const limite = Math.min(Math.max(parseInt(req.query.limite) || 25, 1), 30);
      const soloConProyecto = req.query.solo_con_proyecto !== '0';
      const forzar = req.query.forzar === '1';

      // 1. Leer SO candidatas de so_estado
      let q = supabase.from('so_estado')
        .select('so_numero, so_zoho_id, proyecto_id')
        .not('so_zoho_id', 'is', null)
        .order('so_numero');
      if (soloConProyecto) q = q.not('proyecto_id', 'is', null);
      const { data: candidatas, error: cErr } = await q;
      if (cErr) throw cErr;

      let soList = candidatas || [];

      // Filtrar las ya sincronizadas (sin error) si no se fuerza
      if (!forzar && soList.length > 0) {
        const numeros = soList.map(s => s.so_numero);
        const { data: yaSync } = await supabase.from('so_placas')
          .select('so_numero').in('so_numero', numeros).is('sync_error', null);
        const yaSyncSet = new Set((yaSync || []).map(s => s.so_numero));
        soList = soList.filter(s => !yaSyncSet.has(s.so_numero));
      }

      const restantes = Math.max(0, soList.length - limite);
      soList = soList.slice(0, limite);

      if (!soList.length) {
        return ok(res, { procesadas: 0, con_placas: 0, sin_placas: 0, errores: 0, restantes: 0, ultima_so: null });
      }

      const token = await getZohoToken();
      const ORG_ID = process.env.ZOHO_ORG_ID || '650251363';

      let procesadas = 0, conPlacas = 0, sinPlacas = 0, errores = 0;
      let ultimaSo = null;

      for (const so of soList) {
        ultimaSo = so.so_numero;
        try {
          // 2. Fetch detalle de la SO desde Zoho
          const url = `https://www.zohoapis.com/books/v3/salesorders/${so.so_zoho_id}?organization_id=${ORG_ID}`;
          const zRes = await fetch(url, {
            headers: { Authorization: `Zoho-oauthtoken ${token}` }
          });
          if (!zRes.ok) {
            const t = await zRes.text().catch(() => '');
            throw new Error(`Zoho ${zRes.status}: ${t.slice(0, 200)}`);
          }
          const zData = await zRes.json();
          const soDetail = zData.salesorder;
          if (!soDetail) throw new Error('Respuesta de Zoho sin salesorder');

          // 3. Clasificar líneas
          const lineas = (soDetail.line_items || []).map(li => {
            const cl = esPlaca(li.name, li.unit);
            return {
              name: li.name || '',
              sku: li.sku || '',
              unit: (li.unit || '').trim(),
              quantity: li.quantity || 0,
              es_placa: cl.es_placa,
              regla: cl.regla,
              medidas_m: cl.medidas_m,
            };
          });

          const placasTotal = lineas
            .filter(l => l.es_placa)
            .reduce((sum, l) => sum + (l.quantity || 0), 0);

          // Extraer custom fields
          const cfHash = soDetail.custom_field_hash || {};
          const cfMueble = cfHash.cf_mueble || cfHash.cf_mueble_a_pedido || null;
          const cfObra = cfHash.cf_obra || null;

          // 4. Upsert en so_placas
          const { error: uErr } = await supabase.from('so_placas').upsert({
            so_numero: so.so_numero,
            so_zoho_id: so.so_zoho_id,
            proyecto_id: so.proyecto_id || null,
            cf_mueble: cfMueble,
            cf_obra: cfObra,
            fecha: soDetail.date || null,
            placas_total: placasTotal,
            lineas,
            sync_at: new Date().toISOString(),
            sync_error: null,
          }, { onConflict: 'so_numero' });
          if (uErr) throw uErr;

          procesadas++;
          if (placasTotal > 0) conPlacas++;
          else sinPlacas++;

        } catch (e) {
          // 5. Grabar error y seguir
          errores++;
          procesadas++;
          await supabase.from('so_placas').upsert({
            so_numero: so.so_numero,
            so_zoho_id: so.so_zoho_id,
            proyecto_id: so.proyecto_id || null,
            cf_mueble: null,
            cf_obra: null,
            fecha: null,
            placas_total: 0,
            lineas: [],
            sync_at: new Date().toISOString(),
            sync_error: e.message || String(e),
          }, { onConflict: 'so_numero' }).catch(() => {});
        }

        // Delay de 1s entre llamadas (rate limit Zoho)
        if (soList.indexOf(so) < soList.length - 1) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      return ok(res, { procesadas, con_placas: conPlacas, sin_placas: sinPlacas, errores, restantes, ultima_so: ultimaSo });
    }

    return err(res, 'Acción no reconocida');
  } catch (e) {
    console.error('[calibracion]', action, e);
    return err(res, e.message || 'Error interno', 500);
  }
}
