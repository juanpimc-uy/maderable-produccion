import pkg from 'pg';
const { Pool } = pkg;

const connectionString =
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL       ||
  process.env.POSTGRES_URL       ||
  process.env.NEON_URL;

const pool = connectionString
  ? new Pool({ connectionString, ssl: { rejectUnauthorized: false } })
  : null;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!pool) {
    return res.status(500).json({
      error: 'NEON_DATABASE_URL no configurada en variables de entorno de Vercel',
      hint: 'Configurar NEON_DATABASE_URL (o DATABASE_URL / POSTGRES_URL) en Settings → Environment Variables',
    });
  }

  const { action } = req.query;
  let client;

  try {
    client = await pool.connect();

    if (action === 'plate-types' && req.method === 'GET') {
      const r = await client.query('SELECT * FROM plate_types ORDER BY name');
      return res.json(r.rows);
    }

    if (action === 'positions' && req.method === 'GET') {
      const r = await client.query('SELECT * FROM positions ORDER BY column_id, level');
      return res.json(r.rows);
    }

    if (action === 'stock' && req.method === 'GET') {
      const r = await client.query('SELECT * FROM stock WHERE quantity > 0');
      return res.json(r.rows);
    }

    // GET full inventory: stock joined with plate_types and positions
    if (action === 'all-stock' && req.method === 'GET') {
      const r = await client.query(`
        SELECT s.position_id, s.plate_type_id, s.quantity,
               pt.name, pt.sku, pt.format AS pt_format,
               p.column_id, p.level, p.format, p.capacity
        FROM stock s
        JOIN plate_types pt ON pt.id = s.plate_type_id
        JOIN positions p ON p.id = s.position_id
        WHERE s.quantity > 0
        ORDER BY s.position_id, pt.name
      `);
      return res.json(r.rows);
    }

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

    // POST confirm-item: upsert stock + log movement
    if (action === 'confirm-item' && req.method === 'POST') {
      const { position_id, plate_type_id, quantity, op, movement_type, oc_number, so_number } = req.body;
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

    // POST update-stock: set absolute quantity
    if (action === 'update-stock' && req.method === 'POST') {
      const { position_id, plate_type_id, quantity } = req.body;
      await client.query(
        'UPDATE stock SET quantity = $1 WHERE position_id = $2 AND plate_type_id = $3',
        [Number(quantity), position_id, Number(plate_type_id)]
      );
      return res.json({ ok: true });
    }

    // POST delete-stock
    if (action === 'delete-stock' && req.method === 'POST') {
      const { position_id, plate_type_id } = req.body;
      await client.query(
        'DELETE FROM stock WHERE position_id = $1 AND plate_type_id = $2',
        [position_id, Number(plate_type_id)]
      );
      return res.json({ ok: true });
    }

    // POST move-stock: relocate from one position to another
    if (action === 'move-stock' && req.method === 'POST') {
      const { from_position_id, to_position_id, plate_type_id, quantity } = req.body;
      await client.query(
        'DELETE FROM stock WHERE position_id = $1 AND plate_type_id = $2',
        [from_position_id, Number(plate_type_id)]
      );
      await client.query(
        `INSERT INTO stock (position_id, plate_type_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (position_id, plate_type_id)
         DO UPDATE SET quantity = stock.quantity + $3`,
        [to_position_id, Number(plate_type_id), Number(quantity)]
      );
      await client.query(
        `INSERT INTO movements (position_id, plate_type_id, quantity, type, reference, created_at)
         VALUES ($1, $2, $3, 'movimiento', $4, NOW())`,
        [to_position_id, Number(plate_type_id), Number(quantity), from_position_id + '→' + to_position_id]
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

    // POST set-fixed-position: guardar o borrar posición fija de un plate_type
    if (action === 'set-fixed-position' && req.method === 'POST') {
      const { sku, position_id } = req.body;
      if (!sku) return res.status(400).json({ error: 'sku requerido' });
      await client.query(
        'UPDATE plate_types SET fixed_position_id = $1 WHERE sku = $2',
        [position_id || null, sku]
      );
      return res.json({ ok: true });
    }

    // GET all-stock: stock completo con JOIN positions + plate_types
    if (action === 'all-stock' && req.method === 'GET') {
      const r = await client.query(`
        SELECT s.id AS stock_id, s.quantity,
               p.id AS position_id, p.column_id, p.level, p.format, p.capacity,
               pt.id AS plate_type_id, pt.name, pt.sku, pt.format AS pt_format
        FROM stock s
        JOIN positions p ON p.id = s.position_id
        JOIN plate_types pt ON pt.id = s.plate_type_id
        WHERE s.quantity > 0
        ORDER BY p.column_id, p.level, pt.name
      `);
      return res.json(r.rows);
    }

    // POST update-stock: actualizar cantidad de un registro de stock
    if (action === 'update-stock' && req.method === 'POST') {
      const { position_id, plate_type_id, quantity } = req.body;
      if (!position_id || !plate_type_id || quantity == null) {
        return res.status(400).json({ error: 'Faltan campos' });
      }
      const qty = Math.max(0, Number(quantity));
      const prev = await client.query(
        'SELECT quantity FROM stock WHERE position_id=$1 AND plate_type_id=$2',
        [position_id, plate_type_id]
      );
      const prevQty = prev.rows[0]?.quantity ?? 0;
      await client.query(
        `INSERT INTO stock (position_id, plate_type_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (position_id, plate_type_id)
         DO UPDATE SET quantity = $3`,
        [position_id, plate_type_id, qty]
      );
      await client.query(
        `INSERT INTO movements (position_id, plate_type_id, quantity, type, reference, created_at)
         VALUES ($1, $2, $3, 'ajuste-manual', $4, NOW())`,
        [position_id, plate_type_id, qty - prevQty, `ajuste: ${prevQty}→${qty}`]
      );
      return res.json({ ok: true });
    }

    // POST delete-stock: eliminar registro de stock
    if (action === 'delete-stock' && req.method === 'POST') {
      const { position_id, plate_type_id } = req.body;
      if (!position_id || !plate_type_id) return res.status(400).json({ error: 'Faltan campos' });
      const prev = await client.query(
        'SELECT quantity FROM stock WHERE position_id=$1 AND plate_type_id=$2',
        [position_id, plate_type_id]
      );
      const prevQty = prev.rows[0]?.quantity ?? 0;
      await client.query(
        'DELETE FROM stock WHERE position_id=$1 AND plate_type_id=$2',
        [position_id, plate_type_id]
      );
      await client.query(
        `INSERT INTO movements (position_id, plate_type_id, quantity, type, reference, created_at)
         VALUES ($1, $2, $3, 'ajuste-manual', 'eliminado manualmente', NOW())`,
        [position_id, plate_type_id, -prevQty]
      );
      return res.json({ ok: true });
    }

    // GET stock-by-sku: posiciones donde hay stock de un SKU, ordenado por quantity ASC
    if (action === 'stock-by-sku' && req.method === 'GET') {
      const { sku } = req.query;
      if (!sku) return res.status(400).json({ error: 'sku requerido' });
      const r = await client.query(`
        SELECT s.quantity AS disponible,
               p.id AS position_id, p.column_id, p.level, p.format, p.capacity,
               pt.id AS plate_type_id, pt.name, pt.sku
        FROM stock s
        JOIN plate_types pt ON pt.id = s.plate_type_id
        JOIN positions p ON p.id = s.position_id
        WHERE pt.sku = $1 AND s.quantity > 0
        ORDER BY s.quantity ASC
      `, [sku]);
      return res.json(r.rows);
    }

    // POST confirm-salida: restar stock en bloque + registrar movimientos
    if (action === 'confirm-salida' && req.method === 'POST') {
      const { items, so_number } = req.body;
      if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items requerido' });
      for (const it of items) {
        const qty = Math.max(0, Number(it.quantity));
        if (!qty) continue;
        await client.query(
          `UPDATE stock SET quantity = GREATEST(0, quantity - $1)
           WHERE position_id = $2 AND plate_type_id = $3`,
          [qty, it.position_id, it.plate_type_id]
        );
        await client.query(
          `DELETE FROM stock WHERE position_id = $1 AND plate_type_id = $2 AND quantity <= 0`,
          [it.position_id, it.plate_type_id]
        );
        const ref = [it.so_number || so_number, it.obra].filter(Boolean).join(' · ') || null;
        await client.query(
          `INSERT INTO movements (position_id, plate_type_id, quantity, type, reference, created_at)
           VALUES ($1, $2, $3, 'salida', $4, NOW())`,
          [it.position_id, it.plate_type_id, qty, ref]
        );
      }
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
