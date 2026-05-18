-- Tercerizados — nombre del proveedor en partida
-- JP ejecuta manualmente
ALTER TABLE partidas_terceros ADD COLUMN IF NOT EXISTS proveedor_nombre TEXT;
