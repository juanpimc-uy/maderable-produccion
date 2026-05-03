-- Lote U1.B: heartbeat de actividad para dashboard
ALTER TABLE registros_trabajo
  ADD COLUMN IF NOT EXISTS ultima_actividad TIMESTAMPTZ
    NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_reg_trab_ult_act_activos
  ON registros_trabajo(ultima_actividad)
  WHERE estado = 'activo';

-- Backfill: para registros activos existentes, igualar
-- a inicio para que no aparezcan como "recién activos"
UPDATE registros_trabajo
  SET ultima_actividad = inicio
  WHERE estado = 'activo' AND inicio IS NOT NULL;
