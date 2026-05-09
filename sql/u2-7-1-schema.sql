-- U2.7.1 — Pit Stop (tolerancia diaria paga)
-- JP ejecuta manualmente desde Supabase SQL Editor.
ALTER TABLE empleados
  ADD COLUMN IF NOT EXISTS pit_stop_minutos INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN empleados.pit_stop_minutos IS
  'Minutos diarios pagos para pausas breves (baño, fumar). Superpuesto a descanso_modalidad. 0 = sin pit stop.';
