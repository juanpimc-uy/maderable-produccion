-- MAQ1 · Catálogo de máquinas físicas.
-- El código es la clave escaneable: de él salen los stickers MAQ-<codigo> y FIN-<codigo>.
-- Distinto de centros_virtuales, que son centros de proceso, no equipos.
CREATE TABLE IF NOT EXISTS maquinas (
  id             bigserial PRIMARY KEY,
  codigo         text NOT NULL UNIQUE,        -- CNC1, CNC2, ESC1
  nombre         text NOT NULL,               -- "CNC 1 — Nesting"
  centro_codigo  text,                        -- centros_virtuales.codigo (corte, armado...)
  marca          text,
  modelo         text,
  nro_serie      text,
  notas          text,
  activo         boolean NOT NULL DEFAULT true,
  orden          integer NOT NULL DEFAULT 100,
  creado_en      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_maquinas_activo ON maquinas (activo, orden);

-- Semilla mínima: las dos CNC que ya existen físicamente.
INSERT INTO maquinas (codigo, nombre, centro_codigo, orden) VALUES
  ('CNC1', 'CNC 1', 'corte', 10),
  ('CNC2', 'CNC 2', 'corte', 20)
ON CONFLICT (codigo) DO NOTHING;

-- Verificación (correr aparte):
-- SELECT codigo, nombre, centro_codigo, activo FROM maquinas ORDER BY orden;

-- MAQ1 · Partes / componentes de cada máquina.
CREATE TABLE IF NOT EXISTS maquina_partes (
  id                bigserial PRIMARY KEY,
  codigo            text NOT NULL UNIQUE,        -- MP-000123, generado por el sistema
  maquina_id        bigint NOT NULL REFERENCES maquinas(id) ON DELETE CASCADE,
  nombre            text NOT NULL,               -- "Husillo principal", "Bomba de vacío 1"
  codigo_fabricante text,
  marca             text,
  modelo            text,
  notas             text,
  activo            boolean NOT NULL DEFAULT true,
  orden             integer NOT NULL DEFAULT 100,
  creado_en         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_maquina_partes_maquina ON maquina_partes (maquina_id, orden);

-- Verificación (correr aparte):
-- SELECT m.codigo, p.codigo, p.nombre FROM maquina_partes p JOIN maquinas m ON m.id = p.maquina_id ORDER BY m.codigo, p.orden;
