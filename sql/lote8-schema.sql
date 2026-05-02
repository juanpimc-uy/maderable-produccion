-- ============================================================
-- Lote 8 — Rediseño página Tiempos
-- Soft delete de sesiones_trabajo para edición histórica auditable
-- ============================================================

-- 1. Columnas para soft delete en sesiones_trabajo
ALTER TABLE sesiones_trabajo
  ADD COLUMN IF NOT EXISTS eliminada boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS eliminada_en timestamptz,
  ADD COLUMN IF NOT EXISTS eliminada_por uuid REFERENCES empleados(id);

-- 2. Índice parcial para queries de sesiones activas (las que no fueron eliminadas)
-- Acelera jornadas-rango y cualquier listado que filtre eliminada=false
CREATE INDEX IF NOT EXISTS idx_sesiones_no_eliminadas
  ON sesiones_trabajo (jornada_id)
  WHERE eliminada = false;

-- 3. Comentarios para documentar
COMMENT ON COLUMN sesiones_trabajo.eliminada IS
  'Soft delete: true = sesión borrada por usuario, no se muestra en listados normales pero queda para auditoría';
COMMENT ON COLUMN sesiones_trabajo.eliminada_en IS
  'Timestamp de cuando se hizo el soft delete';
COMMENT ON COLUMN sesiones_trabajo.eliminada_por IS
  'empleado.id del usuario (admin u oficina) que ejecutó el soft delete';

-- ============================================================
-- FIN
-- ============================================================
