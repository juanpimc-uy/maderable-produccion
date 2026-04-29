-- Modalidad de descanso por empleado
ALTER TABLE empleados
  ADD COLUMN IF NOT EXISTS descanso_modalidad TEXT
    CHECK (descanso_modalidad IN ('paga_30','no_paga_60','sin_limite') OR descanso_modalidad IS NULL);

-- Acumulador de exceso de descanso por jornada (para modalidad paga_30)
ALTER TABLE jornadas
  ADD COLUMN IF NOT EXISTS descanso_excedido_minutos INTEGER NOT NULL DEFAULT 0;

-- Cambiar el default de descanso_minutos a 0 para que nuevas jornadas
-- empiecen sin descanso acumulado (el default 30 era legacy para la fórmula)
ALTER TABLE jornadas
  ALTER COLUMN descanso_minutos SET DEFAULT 0;

-- Verificación
SELECT id, nombre, email, rol_app, descanso_modalidad
FROM empleados ORDER BY nombre;
