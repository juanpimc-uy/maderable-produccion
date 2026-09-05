-- INV6: medidas útiles del estante, en cm.
-- Las placas se guardan paradas de canto:
--   ancho_cm limita el largo de la placa, alto_cm limita su ancho,
--   prof_cm determina la capacidad (prof_cm*10 / espesor_mm placas).
ALTER TABLE inv_ubicaciones ADD COLUMN IF NOT EXISTS ancho_cm integer;
ALTER TABLE inv_ubicaciones ADD COLUMN IF NOT EXISTS alto_cm integer;
ALTER TABLE inv_ubicaciones ADD COLUMN IF NOT EXISTS prof_cm integer;

-- Sin backfill: no hay ninguna fuente de la que derivarlas.
-- Se cargan a mano desde el modal de ubicación, empezando por los estantes
-- donde efectivamente se guardan placas.

-- Verificación (correr aparte):
-- SELECT codigo, nombre, tipo, ancho_cm, alto_cm, prof_cm FROM inv_ubicaciones ORDER BY codigo;
