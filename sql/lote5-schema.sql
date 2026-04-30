-- ═══════════════════════════════════════════════════════════════════
-- Lote 5 — Tabla tarifas_horarias y constraint categoría
-- Ejecutar manualmente en Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════

-- 1. Tabla de tarifas $/h por categoría de empleado
CREATE TABLE IF NOT EXISTS tarifas_horarias (
  id             BIGSERIAL    PRIMARY KEY,
  categoria      TEXT         NOT NULL UNIQUE,
  monto_usd      NUMERIC(10,2) NOT NULL DEFAULT 0,
  actualizado_en TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (categoria IN ('directo','indirecto','tecnico','administrativo'))
);

ALTER TABLE tarifas_horarias DISABLE ROW LEVEL SECURITY;

-- 2. Sembrar las 4 categorías con valor 0
INSERT INTO tarifas_horarias (categoria, monto_usd) VALUES
  ('directo',        0),
  ('indirecto',      0),
  ('tecnico',        0),
  ('administrativo', 0)
ON CONFLICT (categoria) DO NOTHING;

-- 3. Expandir CHECK constraint en empleados.categoria a 4 valores
--    (si no existe el constraint, la segunda sentencia lo crea)
ALTER TABLE empleados
  DROP CONSTRAINT IF EXISTS empleados_categoria_check;

ALTER TABLE empleados
  ADD CONSTRAINT empleados_categoria_check
  CHECK (categoria IN ('directo','indirecto','tecnico','administrativo') OR categoria IS NULL);

-- 4. Verificación
SELECT * FROM tarifas_horarias ORDER BY categoria;
SELECT DISTINCT categoria, COUNT(*) FROM empleados GROUP BY categoria ORDER BY categoria;
