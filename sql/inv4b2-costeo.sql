-- Desglose del costo de materiales: real consumido vs teórico SO (para transición y desvío)
ALTER TABLE proyectos_cache
  ADD COLUMN IF NOT EXISTS costo_consumido_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS costo_teorico_usd   NUMERIC;
