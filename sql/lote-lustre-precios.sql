-- Lote: Lustre precios por superficie
-- Reemplaza precio_usd_m2 único por 3 precios (exterior / interior visto / interior no visto)
-- y agrega campo categoria para agrupar en UI.

ALTER TABLE lustre_tipos
  ADD COLUMN precio_exterior numeric DEFAULT 0,
  ADD COLUMN precio_interior_visto numeric,
  ADD COLUMN precio_interior_no_visto numeric,
  ADD COLUMN categoria text DEFAULT 'LUSTRE';

UPDATE lustre_tipos
  SET precio_exterior = precio_usd_m2;

ALTER TABLE lustre_tipos
  DROP COLUMN precio_usd_m2;
