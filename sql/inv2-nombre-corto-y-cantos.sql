-- INV2 · Parte 1: columna nombre_corto
ALTER TABLE inv_items ADD COLUMN IF NOT EXISTS nombre_corto text;

-- INV2 · Parte 2: backfill de nombre_corto derivado de la descripción.
-- Quita paréntesis, espesor, medidas, prefijos de material y sufijos de calidad.
-- Es una aproximación: lo que quede feo se corrige a mano desde la UI.
UPDATE inv_items SET nombre_corto = NULLIF(btrim(regexp_replace(
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(upper(descripcion), '\([^)]*\)', '', 'g'),
        '[0-9]+([.,][0-9]+)?\s*MM', '', 'g'),
      '[0-9]+([.,][0-9]+)?\s*[XX×]\s*[0-9]+([.,][0-9]+)?\s*M?', '', 'g'),
    '^(FIBRO FACIL MELAMINICO|FIBRO FACIL MEL|FIBRO FAC\.?\s*MEL\.?|MDF MELAMINICO EGGER|MDF MELAMÍNICO EGGER|MDF MELAMINICO|MDF MELAMÍNICO|MDF MEL|MDF ENCHAPADO|MDF ENCH|CANTO ABS)\s*', '', 'g'),
  '\s*(BASICO|BÁSICO|PREMIUM|1 CARA|A/C|EG\.)\s*$', '', 'g')), '');

-- Fallback: si quedó vacío, usar los primeros 28 caracteres de la descripción.
UPDATE inv_items SET nombre_corto = left(descripcion, 28) WHERE nombre_corto IS NULL;

-- Normalizar espacios dobles y recortar a 28.
UPDATE inv_items SET nombre_corto = left(btrim(regexp_replace(nombre_corto, '\s+', ' ', 'g')), 28);

-- INV2 · Parte 3: separar cantos de placas.
UPDATE inv_items SET familia = 'canto'
WHERE familia = 'placa' AND (descripcion ILIKE 'CANTO%' OR descripcion ILIKE '%CANTO ABS%');

-- Verificación (correr aparte y mirar el resultado):
-- SELECT familia, count(*) FROM inv_items WHERE activo GROUP BY familia ORDER BY 2 DESC;
-- SELECT codigo, descripcion, nombre_corto FROM inv_items WHERE familia='placa' ORDER BY random() LIMIT 20;
