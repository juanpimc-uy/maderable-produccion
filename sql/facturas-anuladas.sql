-- Columnas para marcar facturas anuladas por NC (match 1:1 por cliente+monto+fecha)
ALTER TABLE facturas_biller
  ADD COLUMN IF NOT EXISTS anulada       boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS anulada_par_id uuid    REFERENCES facturas_biller(id);
