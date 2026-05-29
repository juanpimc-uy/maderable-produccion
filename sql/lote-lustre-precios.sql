-- Lote: Lustre precios por superficie + control de cambios
-- Reemplaza precio_usd_m2 único por 3 precios (exterior / interior visto / interior no visto)
-- y agrega campo categoria para agrupar en UI + auditoría de cambios.

-- 1. Nuevas columnas en lustre_tipos
ALTER TABLE lustre_tipos
  ADD COLUMN precio_exterior numeric,
  ADD COLUMN precio_interior_visto numeric,
  ADD COLUMN precio_interior_no_visto numeric,
  ADD COLUMN categoria text DEFAULT 'LUSTRE',
  ADD COLUMN modificado_por uuid,
  ADD COLUMN modificado_en timestamptz DEFAULT now();

-- 2. Migrar precio existente
UPDATE lustre_tipos SET precio_exterior = precio_usd_m2;

-- 3. Eliminar columna vieja
ALTER TABLE lustre_tipos DROP COLUMN precio_usd_m2;

-- 4. Tabla historial de cambios
CREATE TABLE lustre_historial (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lustre_tipo_id integer REFERENCES lustre_tipos(id),
  nombre_tipo text,
  campo text,
  precio_anterior numeric,
  precio_nuevo numeric,
  modificado_por uuid,
  modificado_en timestamptz DEFAULT now()
);
