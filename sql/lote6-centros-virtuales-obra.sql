-- ============================================
-- Lote 6 — Agregar centro virtual "Obra"
-- ============================================
-- Ejecutar manualmente en Supabase SQL Editor.
-- Los demás centros de administración (Compras, Coordinacion, Supervision,
-- Reunion) y de oficina técnica (Shop Drawing, Modelado, Cam) ya existen
-- en la tabla centros_virtuales.
-- ============================================

INSERT INTO centros_virtuales (nombre, es_descanso, activo)
VALUES ('Obra', false, true)
ON CONFLICT (nombre) DO NOTHING;
