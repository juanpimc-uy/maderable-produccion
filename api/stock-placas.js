export const config = { runtime: 'edge' };

const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}

async function sql(query, params = []) {
  const dbUrl = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL not set');

  // Neon HTTP API
  const neonUrl = dbUrl.replace('postgresql://', 'https://').replace('postgres://', 'https://');
  const [auth, rest] = neonUrl.replace('https://', '').split('@');
  const host = rest.split('/')[0];
  const dbName = rest.split('/')[1]?.split('?')[0];

  const endpoint = `https://${host}/sql`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${btoa(auth)}`,
      'Neon-Connection-String': dbUrl,
    },
    body: JSON.stringify({ query, params }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Neon error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.rows ?? data;
}

// ── Neon serverless via fetch con el driver HTTP oficial ──────────────────────
async function neonQuery(query, params = []) {
  const connStr = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (!connStr) throw new Error('DATABASE_URL not set');

  // Parse connection string: postgres://user:pass@host/db
  const match = connStr.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^/]+)\/(.+)$/);
  if (!match) throw new Error('Invalid DATABASE_URL format');
  const [, user, pass, host, db] = match;

  const apiUrl = `https://${host}/sql`;
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${btoa(`${user}:${pass}`)}`,
      'Neon-Connection-String': connStr,
    },
    body: JSON.stringify({ query, params }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Neon HTTP ${res.status}: ${text.slice(0, 400)}`);
  const data = JSON.parse(text);
  return data.rows ?? [];
}

export default async function handler(req) {
  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  try {
    // ── SEED: cargar posiciones iniciales ────────────────────────────────────
    if (action === 'seed-positions') {
      await neonQuery(`
        CREATE TABLE IF NOT EXISTS positions (
          id TEXT PRIMARY KEY,
          column_id TEXT NOT NULL,
          level INTEGER NOT NULL,
          format TEXT NOT NULL,
          capacity INTEGER NOT NULL DEFAULT 40
        )
      `);
      await neonQuery(`
        CREATE TABLE IF NOT EXISTS plate_types (
          id SERIAL PRIMARY KEY,
          sku TEXT UNIQUE NOT NULL,
          name TEXT,
          format TEXT NOT NULL
        )
      `);
      await neonQuery(`
        CREATE TABLE IF NOT EXISTS position_items (
          id SERIAL PRIMARY KEY,
          position_id TEXT NOT NULL REFERENCES positions(id),
          plate_type_id INTEGER NOT NULL REFERENCES plate_types(id),
          quantity INTEGER NOT NULL DEFAULT 0,
          oc_number TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await neonQuery(`
        INSERT INTO positions (id, column_id, level, format, capacity) VALUES
        ('A1-1','A1',1,'A',40), ('A1-2','A1',2,'A',40), ('A1-3','A1',3,'A',40),
        ('A1-4','A1',4,'A',40), ('A1-5','A1',5,'A',40),
        ('A2-1','A2',1,'A',40), ('A2-2','A2',2,'A',40), ('A2-3','A2',3,'A',40),
        ('A2-4','A2',4,'A',40), ('A2-5','A2',5,'A',40),
        ('A3-1','A3',1,'A',40), ('A3-2','A3',2,'A',40), ('A3-3','A3',3,'A',40),
        ('A3-4','A3',4,'A',40), ('A3-5','A3',5,'A',40),
        ('A4-1','A4',1,'A',40), ('A4-2','A4',2,'A',40), ('A4-3','A4',3,'A',40),
        ('A4-4','A4',4,'A',40), ('A4-5','A4',5,'A',40),
        ('B1-1','B1',1,'B',25), ('B1-2','B1',2,'B',25), ('B1-3','B1',3,'B',25),
        ('B1-4','B1',4,'B',25), ('B1-5','B1',5,'B',25),
        ('B2-1','B2',1,'B',25), ('B2-2','B2',2,'B',25), ('B2-3','B2',3,'B',25),
        ('B2-4','B2',4,'B',25), ('B2-5','B2',5,'B',25),
        ('B-ESP','B-ESP',1,'B',150)
        ON CONFLICT (id) DO NOTHING
      `);
      return json({ ok: true, message: 'Tablas creadas y posiciones cargadas' });
    }

    // ── GET plate-type: obtener o crear por SKU ──────────────────────────────
    if (action === 'plate-type') {
      const sku    = url.searchParams.get('sku')    || '';
      const name   = url.searchParams.get('name')   || sku;
      const format = url.searchParams.get('format') || 'A';

      let rows = await neonQuery(
        'SELECT * FROM plate_types WHERE sku = $1',
        [sku]
      );
      if (rows.length === 0) {
        rows = await neonQuery(
          'INSERT INTO plate_types (sku, name, format) VALUES ($1, $2, $3) ON CONFLICT (sku) DO UPDATE SET name=EXCLUDED.name, format=EXCLUDED.format RETURNING *',
          [sku, name, format]
        );
      }
      return json({ plate_type: rows[0] });
    }

    // ── GET positions: posiciones del formato con stock actual ───────────────
    if (action === 'positions') {
      const format = url.searchParams.get('format') || 'A';

      const positions = await neonQuery(
        `SELECT p.*,
                COALESCE(SUM(pi.quantity), 0)::int AS total_stock,
                JSON_AGG(
                  CASE WHEN pi.id IS NOT NULL
                  THEN JSON_BUILD_OBJECT(
                    'plate_type_id', pi.plate_type_id,
                    'quantity', pi.quantity,
                    'oc_number', pi.oc_number
                  ) END
                ) FILTER (WHERE pi.id IS NOT NULL) AS items
         FROM positions p
         LEFT JOIN position_items pi ON pi.position_id = p.id
         WHERE p.format = $1
         GROUP BY p.id
         ORDER BY p.column_id, p.level`,
        [format]
      );

      return json({ positions });
    }

    // ── POST confirm-item: agregar stock a una posición ──────────────────────
    if (action === 'confirm-item' && req.method === 'POST') {
      const body = await req.json();
      const { position_id, plate_type_id, quantity, oc_number } = body;

      if (!position_id || !plate_type_id || !quantity) {
        return json({ error: 'Faltan campos: position_id, plate_type_id, quantity' }, 400);
      }

      // Verificar que la posición existe
      const pos = await neonQuery('SELECT * FROM positions WHERE id = $1', [position_id]);
      if (pos.length === 0) return json({ error: `Posición ${position_id} no existe` }, 404);

      // Verificar capacidad
      const stockRows = await neonQuery(
        'SELECT COALESCE(SUM(quantity),0)::int AS total FROM position_items WHERE position_id = $1',
        [position_id]
      );
      const currentStock = stockRows[0]?.total || 0;
      if (currentStock + quantity > pos[0].capacity) {
        return json({ error: `Capacidad excedida. Disponible: ${pos[0].capacity - currentStock}` }, 400);
      }

      const inserted = await neonQuery(
        'INSERT INTO position_items (position_id, plate_type_id, quantity, oc_number) VALUES ($1, $2, $3, $4) RETURNING *',
        [position_id, plate_type_id, quantity, oc_number || null]
      );

      return json({ ok: true, item: inserted[0] });
    }

    // ── GET report: reporte de una OC ────────────────────────────────────────
    if (action === 'report') {
      const ocNumber = url.searchParams.get('oc');
      if (!ocNumber) return json({ error: 'Falta parámetro oc' }, 400);

      const rows = await neonQuery(
        `SELECT pi.*, pt.sku, pt.name, pt.format, pi.position_id AS posicion
         FROM position_items pi
         JOIN plate_types pt ON pt.id = pi.plate_type_id
         WHERE pi.oc_number = $1
         ORDER BY pi.created_at`,
        [ocNumber]
      );
      return json({ items: rows });
    }

    return json({ error: `Acción desconocida: ${action}` }, 400);

  } catch (err) {
    console.error('[stock-placas]', err);
    return json({ error: err.message }, 500);
  }
}
