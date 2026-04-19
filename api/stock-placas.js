import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;
  let client;

  try {
    client = await pool.connect();

    // GET all plate types
    if (action === 'plate-types' && req.method === 'GET') {
      const r = await client.query('SELECT * FROM plate_types ORDER BY name');
      return res.json(r.rows);
    }

    // GET all positions
    if (action === 'positions' && req.method === 'GET') {
      const r = await client.query('SELECT * FROM positions ORDER BY column_id, level');
      return res.json(r.rows);
    }

    // GET all stock
    if (action === 'stock' && req.method === 'GET') {
      const r = await client.query('SELECT * FROM stock WHERE quantity > 0');
      return res.json(r.rows);
    }

    // GET plate_type by SKU — creates if not exists
    if (action === 'plate-type' && req.method === 'GET') {
      const { sku, name, format } = req.query;
      if (!sku) return res.status(400).json({ error: 'sku requerido' });
      let r = await client.query('SELECT * FROM plate_types WHERE sku = $1', [sku]);
      if (r.rows.length === 0) {
        r = await client.query(
          'INSERT INTO plate_types (name, sku, format) VALUES ($1,$2,$3) RETURNING *',
          [name || sku, sku, format || 'A']
        );
      }
      return res.json(r.rows[0]);
    }

    // POST confirm-item: upsert stock + log movement (handles ingreso and salida)
    if (action === 'confirm-item' && req.method === 'POST') {
      const {
        position_id, plate_type_id, quantity, op,
        movement_type, oc_number, so_number,
      } = req.body;

      const qty = Number(quantity);
      const delta = op === 'subtract' ? -qty : qty;

      await client.query(
        `INSERT INTO stock (position_id, plate_type_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (position_id, plate_type_id)
         DO UPDATE SET quantity = GREATEST(0, stock.quantity + $3)`,
        [position_id, plate_type_id, delta]
      );

      const reference = oc_number || so_number || '';
      await client.query(
        `INSERT INTO movements (position_id, plate_type_id, quantity, type, reference, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [position_id, plate_type_id, qty, movement_type || 'ingreso', reference]
      );

      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Acción no reconocida: ' + action });

  } catch (err) {
    console.error('Error completo:', err);
    return res.status(500).json({ error: err.message, stack: err.stack });
  } finally {
    if (client) client.release();
  }
}
