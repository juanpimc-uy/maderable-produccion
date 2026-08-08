-- INV-4a: trackear herraje ya descontado por línea de SO (descuento por delta)
ALTER TABLE so_lineas_estado
  ADD COLUMN IF NOT EXISTS item_zoho_id TEXT,
  ADD COLUMN IF NOT EXISTS cantidad_descontada_inv NUMERIC NOT NULL DEFAULT 0;
