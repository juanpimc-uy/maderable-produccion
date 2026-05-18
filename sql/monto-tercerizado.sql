-- Tercerizados — monto USD por partida
-- JP ejecuta manualmente
ALTER TABLE partidas_terceros ADD COLUMN IF NOT EXISTS monto_usd NUMERIC(10,2);
