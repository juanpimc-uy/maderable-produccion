-- INV3 · Parte 1: columnas de dimensión en el catálogo
ALTER TABLE inv_items ADD COLUMN IF NOT EXISTS espesor_mm numeric;
ALTER TABLE inv_items ADD COLUMN IF NOT EXISTS largo_cm integer;
ALTER TABLE inv_items ADD COLUMN IF NOT EXISTS ancho_cm integer;

-- INV3 · Parte 2: backfill del espesor (solo placas, patrón "NN mm").
UPDATE inv_items SET espesor_mm = NULLIF(replace((regexp_match(descripcion, '([0-9]+(?:[.,][0-9]+)?)\s*[mM][mM]'))[1], ',', '.'), '')::numeric
WHERE familia = 'placa'
  AND descripcion ~* '[0-9]+([.,][0-9]+)?\s*mm';

-- INV3 · Parte 3: backfill de largo/ancho SOLO en casos inequívocos.
-- Excluye: pulgadas, tres o más dimensiones encadenadas, y pares con
-- órdenes de magnitud distintos (un lado en metros y el otro en cm).
WITH m AS (
  SELECT id,
    replace((regexp_match(descripcion, '([0-9]+(?:[.,][0-9]+)?)\s*[xX]\s*([0-9]+(?:[.,][0-9]+)?)'))[1], ',', '.')::numeric AS a,
    replace((regexp_match(descripcion, '([0-9]+(?:[.,][0-9]+)?)\s*[xX]\s*([0-9]+(?:[.,][0-9]+)?)'))[2], ',', '.')::numeric AS b
  FROM inv_items
  WHERE familia = 'placa'
    AND descripcion ~* '[0-9]+([.,][0-9]+)?\s*[xX]\s*[0-9]+([.,][0-9]+)?'
    AND descripcion !~ '["'']'                                                    -- sin pulgadas
    AND descripcion !~* '[0-9]\s*[xX]\s*[0-9]+(?:[.,][0-9]+)?\s*[xX]\s*[0-9]'     -- sin triple dimensión
), n AS (
  SELECT id,
    CASE WHEN a < 10 THEN round(a * 100) ELSE round(a) END::int AS a_cm,
    CASE WHEN b < 10 THEN round(b * 100) ELSE round(b) END::int AS b_cm
  FROM m
  WHERE (a < 10) = (b < 10)      -- ambos en metros o ambos en cm, nunca mezclados
)
UPDATE inv_items i SET
  largo_cm = GREATEST(n.a_cm, n.b_cm),
  ancho_cm = LEAST(n.a_cm, n.b_cm)
FROM n WHERE i.id = n.id
  AND GREATEST(n.a_cm, n.b_cm) BETWEEN 50 AND 600     -- descarta cantos y basura
  AND LEAST(n.a_cm, n.b_cm) BETWEEN 30 AND 600;

-- INV3 · Parte 4: backfill de las unidades ya cargadas, desde atributos.medida.
WITH u AS (
  SELECT id,
    replace((regexp_match(atributos->>'medida', '([0-9]+(?:[.,][0-9]+)?)\s*[xX]\s*([0-9]+(?:[.,][0-9]+)?)'))[1], ',', '.')::numeric AS a,
    replace((regexp_match(atributos->>'medida', '([0-9]+(?:[.,][0-9]+)?)\s*[xX]\s*([0-9]+(?:[.,][0-9]+)?)'))[2], ',', '.')::numeric AS b
  FROM inv_unidades
  WHERE atributos->>'medida' ~* '[0-9]+([.,][0-9]+)?\s*[xX]\s*[0-9]+([.,][0-9]+)?'
), n AS (
  SELECT id,
    CASE WHEN a < 10 THEN round(a * 100) ELSE round(a) END::int AS a_cm,
    CASE WHEN b < 10 THEN round(b * 100) ELSE round(b) END::int AS b_cm
  FROM u
)
UPDATE inv_unidades x
SET atributos = x.atributos
  || jsonb_build_object('largo_cm', GREATEST(n.a_cm, n.b_cm))
  || jsonb_build_object('ancho_cm', LEAST(n.a_cm, n.b_cm))
FROM n WHERE x.id = n.id;

-- Verificación (correr aparte):
-- SELECT count(*) FILTER (WHERE largo_cm IS NOT NULL) con_medida,
--        count(*) FILTER (WHERE espesor_mm IS NOT NULL) con_espesor,
--        count(*) total FROM inv_items WHERE activo AND familia='placa';
-- SELECT codigo, descripcion, espesor_mm, largo_cm, ancho_cm FROM inv_items
--   WHERE familia='placa' AND largo_cm IS NOT NULL ORDER BY random() LIMIT 20;
-- SELECT codigo, atributos FROM inv_unidades ORDER BY creado_en DESC LIMIT 10;

-- Aplicado 05-sep-2026. Resultado: 95 de 221 placas con largo/ancho, 148 con espesor.
-- El resto queda null a propósito (pulgadas, triple dimensión, o sin medida en la descripción).
