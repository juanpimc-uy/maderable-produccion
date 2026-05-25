-- Lote 6.5: items seleccionados al imputar OC
ALTER TABLE costos_directos_proyecto
ADD COLUMN IF NOT EXISTS items_seleccionados jsonb;
