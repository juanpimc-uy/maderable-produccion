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

    // GET seed-positions: crear tablas e insertar posiciones iniciales
    if (action === 'seed-positions' && req.method === 'GET') {
      await client.query(`
        CREATE TABLE IF NOT EXISTS positions (
          id TEXT PRIMARY KEY,
          column_id TEXT NOT NULL,
          level INTEGER NOT NULL,
          format TEXT NOT NULL,
          capacity INTEGER NOT NULL DEFAULT 40,
          fixed_position_id TEXT
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS plate_types (
          id SERIAL PRIMARY KEY,
          sku TEXT UNIQUE NOT NULL,
          name TEXT,
          format TEXT NOT NULL DEFAULT 'A',
          fixed_position_id TEXT
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS stock (
          id SERIAL PRIMARY KEY,
          position_id TEXT NOT NULL REFERENCES positions(id),
          plate_type_id INTEGER NOT NULL REFERENCES plate_types(id),
          quantity INTEGER NOT NULL DEFAULT 0,
          UNIQUE(position_id, plate_type_id)
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS movements (
          id SERIAL PRIMARY KEY,
          position_id TEXT NOT NULL,
          plate_type_id INTEGER NOT NULL,
          quantity INTEGER NOT NULL,
          type TEXT NOT NULL DEFAULT 'ingreso',
          reference TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`
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
      const countPos = await client.query('SELECT COUNT(*) FROM positions');
      return res.json({ ok: true, positions: Number(countPos.rows[0].count) });
    }

    return res.status(400).json({ error: 'Acción no reconocida: ' + action });

  } catch (err) {
    console.error('Error completo:', err);
    return res.status(500).json({ error: err.message, stack: err.stack });
  } finally {
    if (client) client.release();
  }
}
