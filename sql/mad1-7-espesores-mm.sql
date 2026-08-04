-- MAD-1.7 · Cambiar catálogo espesores: cm → mm

-- 1) Borrar espesores existentes (sin partidas asociadas)
DELETE FROM madera_espesores;

-- 2) Cambiar CHECK constraint: cm → mm
ALTER TABLE madera_espesores DROP CONSTRAINT IF EXISTS madera_espesores_unidad_check;
ALTER TABLE madera_espesores
  ADD CONSTRAINT madera_espesores_unidad_check
  CHECK (unidad IN ('pulgadas', 'mm'));

-- NOTA: madera_piezas.espesor_cm se mantiene como NUMERIC en cm (unidad interna del cálculo).
-- La conversión mm → cm ocurre en el backend al crear piezas.

-- JP carga los espesores desde la tab Catálogos a mano después.
