#!/usr/bin/env node
// db/migrate.mjs — runner de migraciones (opt-in; lo corre JP a mano).
// ─────────────────────────────────────────────────────────────────────────────
// Convención: archivos db/migrations/NNNN_descripcion.sql, aplicados EN ORDEN,
// trackeados en la tabla public.schema_migrations. Cada migración corre en su
// propia transacción (BEGIN/COMMIT); si una falla, ROLLBACK y se frena.
//
// Uso:
//   node db/migrate.mjs status   # (default) lista aplicadas/pendientes — SOLO LECTURA
//   node db/migrate.mjs up       # aplica las pendientes
//
// Conexión: mismo connection string que el resto del repo
//   NEON_DATABASE_URL | DATABASE_URL | POSTGRES_URL | NEON_URL  (ssl flexible)
//
// IMPORTANTE: este runner EJECUTA SQL. Por la regla del repo (CLAUDE.md), lo corre
// JP, no la IA. `status` es el default justamente para que una corrida accidental
// no modifique nada.
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

const connectionString =
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.NEON_URL;

if (!connectionString) {
  console.error('✗ Falta el connection string (NEON_DATABASE_URL | DATABASE_URL | POSTGRES_URL | NEON_URL).');
  process.exit(1);
}

const sha = (s) => createHash('sha256').update(s).digest('hex');

function migrationFiles() {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}.*\.sql$/.test(f))
    .sort();
}

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version     text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function getApplied(client) {
  try {
    const { rows } = await client.query(
      'SELECT version, checksum FROM public.schema_migrations ORDER BY version'
    );
    return new Map(rows.map((r) => [r.version, r.checksum]));
  } catch (e) {
    if (e.code === '42P01') return new Map(); // la tabla aún no existe → 0 aplicadas
    throw e;
  }
}

async function main() {
  const cmd = process.argv[2] || 'status';
  if (!['status', 'up'].includes(cmd)) {
    console.error(`Comando desconocido: "${cmd}". Usá: status | up`);
    process.exit(1);
  }

  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    if (cmd === 'up') await ensureTable(client); // status NO escribe nada (solo lectura)
    const applied = await getApplied(client);
    const files = migrationFiles();

    // Detección de drift: archivo modificado después de aplicado.
    for (const f of files) {
      if (applied.has(f)) {
        const disk = sha(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
        if (applied.get(f) !== disk) {
          console.warn(`⚠ ${f}: el archivo cambió DESPUÉS de aplicarse (checksum distinto).`);
        }
      }
    }

    const pending = files.filter((f) => !applied.has(f));

    if (cmd === 'status') {
      console.log(`Aplicadas: ${applied.size} | Pendientes: ${pending.length}`);
      if (!files.length) {
        console.log('  (no hay migraciones en db/migrations/ todavía)');
      } else {
        for (const f of files) console.log(`  ${applied.has(f) ? '✓' : '·'} ${f}`);
      }
      return;
    }

    // cmd === 'up'
    if (!pending.length) { console.log('Nada pendiente. ✓'); return; }
    for (const f of pending) {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
      process.stdout.write(`Aplicando ${f} … `);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO public.schema_migrations (version, checksum) VALUES ($1, $2)',
          [f, sha(sql)]
        );
        await client.query('COMMIT');
        console.log('OK');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`\n✗ Falló ${f}: ${e.message}`);
        console.error('  Se hizo ROLLBACK. Las migraciones siguientes NO se aplicaron.');
        process.exit(1);
      }
    }
    console.log('Listo. ✓');
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
