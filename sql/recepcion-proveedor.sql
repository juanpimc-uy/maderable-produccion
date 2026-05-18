-- Tercerizados — recepción por proveedor + archivado
-- JP ejecuta manualmente
ALTER TABLE partidas_terceros ADD COLUMN IF NOT EXISTS fecha_recepcion_proveedor TIMESTAMPTZ;
ALTER TABLE partidas_terceros ADD COLUMN IF NOT EXISTS archivada BOOLEAN DEFAULT false;
