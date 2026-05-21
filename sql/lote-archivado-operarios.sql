-- lote-archivado-operarios.sql
-- Soft-delete para operarios: archivado en lugar de eliminación.
-- Ejecutar manualmente en Supabase ANTES del deploy.

ALTER TABLE empleados
  ADD COLUMN IF NOT EXISTS archivado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archivado_en timestamptz;
