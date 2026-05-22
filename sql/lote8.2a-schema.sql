-- lote8.2a-schema.sql
-- Anomalías en registros de trabajo: detección automática + aprobación admin.
-- Ejecutar manualmente en Supabase ANTES del deploy.

ALTER TABLE registros_trabajo
  ADD COLUMN IF NOT EXISTS anomalia boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS anomalia_aprobada boolean DEFAULT null;

-- anomalia = true → sistema la detectó automáticamente
-- anomalia_aprobada = null → pendiente revisión
-- anomalia_aprobada = true → admin aprobó, cuenta en totales
-- anomalia_aprobada = false → admin rechazó (no cuenta)
