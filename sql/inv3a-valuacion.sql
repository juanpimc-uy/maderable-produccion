-- Valuación: costos en USD, congelados al entrar
ALTER TABLE inv_items
  ADD COLUMN costo_promedio_usd NUMERIC,
  ADD COLUMN costo_ultimo_usd   NUMERIC;

ALTER TABLE inv_unidades
  ADD COLUMN costo_usd NUMERIC,
  ADD COLUMN reserva_proyecto_id TEXT;

ALTER TABLE inv_movimientos
  ADD COLUMN costo_unitario_usd NUMERIC,
  ADD COLUMN costo_verificado   BOOLEAN NOT NULL DEFAULT false;
