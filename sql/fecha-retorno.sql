-- Tercerizados — fecha retorno estimada
-- JP ejecuta manualmente
ALTER TABLE partidas_terceros ADD COLUMN IF NOT EXISTS fecha_retorno_estimada DATE;
