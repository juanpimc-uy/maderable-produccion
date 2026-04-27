-- ════════════════════════════════════════════════════════════════════════════
-- LOTE 2 — Auth + Roles
-- Correr en: Supabase SQL Editor
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE empleados ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS rol_app TEXT DEFAULT 'operario';

-- Constraint: rol_app válido
ALTER TABLE empleados DROP CONSTRAINT IF EXISTS empleados_rol_app_check;
ALTER TABLE empleados ADD CONSTRAINT empleados_rol_app_check
  CHECK (rol_app IN ('operario', 'oficina', 'admin'));

-- Email único (cuando no es null)
DROP INDEX IF EXISTS idx_empleados_email_unique;
CREATE UNIQUE INDEX idx_empleados_email_unique
  ON empleados (email) WHERE email IS NOT NULL;

-- Seed admin (Juan Martinez) — UPDATE en lugar de INSERT porque ya existe el registro
UPDATE empleados
SET cedula = '9.999.999-9',
    email = 'juan@maderable.uy',
    categoria = 'administrativo',
    rol_app = 'admin',
    pin = '1234'
WHERE nombre = 'Juan Martinez';

-- Si por alguna razón Juan Martinez no existe, crearlo
INSERT INTO empleados (nombre, cedula, email, categoria, rol_app, pin)
SELECT 'Juan Martinez', '9.999.999-9', 'juan@maderable.uy', 'administrativo', 'admin', '1234'
WHERE NOT EXISTS (SELECT 1 FROM empleados WHERE nombre = 'Juan Martinez');

-- Seed oficina (Laura Gómez) — UPDATE
UPDATE empleados
SET email = 'laura@maderable.uy',
    rol_app = 'oficina'
WHERE nombre = 'Laura Gómez';

-- Verificación
SELECT id, nombre, cedula, email, categoria, rol_app, pin FROM empleados ORDER BY rol_app, nombre;
