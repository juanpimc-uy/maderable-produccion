# db/migrations

Migraciones de schema **trackeadas y ordenadas** — el reemplazo de los 45 `.sql`
sueltos de `/sql` que hoy se aplican a mano sin registro de cuáles ya corrieron.

> Esto es el "migration runner" del paso 0 de la Fundación (ver `ARQUITECTURA.md`).
> Los `.sql` históricos de `/sql` quedan como están; **de acá en adelante** los
> cambios de schema van en esta carpeta.

## Convención

- Un archivo por cambio: **`NNNN_descripcion.sql`** (4 dígitos, en orden).
  Ej.: `0001_rename_proyectos_cache.sql`, `0002_unificar_cliente.sql`.
- Cada migración debe ser **idempotente cuando se pueda** (`IF NOT EXISTS`, `IF EXISTS`)
  y corre dentro de **una transacción** (la envuelve el runner).
- Una vez aplicada, **no se edita** un archivo (el runner detecta el cambio de checksum
  y avisa). Si te equivocaste, hacés una migración nueva que corrige.

## Cómo se aplica

El runner es `db/migrate.mjs`. Usa el mismo connection string que el resto del repo
(`NEON_DATABASE_URL | DATABASE_URL | POSTGRES_URL | NEON_URL`) y registra lo aplicado
en la tabla `public.schema_migrations`.

```bash
node db/migrate.mjs status   # (default) qué está aplicado y qué falta — SOLO LECTURA
node db/migrate.mjs up        # aplica las pendientes, en orden, c/u en su transacción
```

**Regla del repo:** el runner ejecuta SQL → **lo corre JP, no la IA**. Por eso `status`
es el default: una corrida accidental no modifica nada.

## Baseline

El estado actual de producción se considera el **baseline implícito** (no se reconstruye
desde los 45 `.sql` viejos — la verdad vive en la base). El tracking arranca desde acá:
la primera migración real será, probablemente, los renombres canónicos del ADR-4
(`proyectos_cache`→`proyectos`, unificar `cliente`/`items`).

## Limitación

Algunas operaciones DDL no pueden correr dentro de una transacción (ej.
`CREATE INDEX CONCURRENTLY`). Para esos casos puntuales, aplicar el statement a mano
y registrar la versión en `schema_migrations` manualmente.
