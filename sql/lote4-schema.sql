-- ============================================================
-- Lote 4 — Schema: centros virtuales para oficina
-- ============================================================
-- EJECUTAR manualmente en Supabase SQL Editor.
-- NO incluye ALTER TABLE jornadas — ver lote4-investigacion.md.
-- La tabla registros_trabajo ya tiene el campo `centro` (TEXT)
-- y jornada_id nullable, suficiente para registros de oficina.
-- ============================================================

-- Tabla catálogo de centros virtuales de oficina
CREATE TABLE IF NOT EXISTS centros_virtuales (
  id        BIGSERIAL    PRIMARY KEY,
  nombre    TEXT         NOT NULL UNIQUE,
  activo    BOOLEAN      NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Sin RLS por ahora (dato referencial no sensible)
ALTER TABLE centros_virtuales DISABLE ROW LEVEL SECURITY;

-- Datos iniciales
INSERT INTO centros_virtuales (nombre) VALUES
  ('Cam'),
  ('Compras'),
  ('Coordinacion'),
  ('Modelado'),
  ('Reunion'),
  ('Supervision')
ON CONFLICT (nombre) DO NOTHING;

-- ============================================================
-- VERIFICACIÓN (ejecutar después del INSERT para confirmar)
-- SELECT * FROM centros_virtuales ORDER BY nombre;
-- ============================================================
