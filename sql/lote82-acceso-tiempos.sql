-- Lote 8.2 — Flag de acceso a tiempos.html
-- JP ejecuta manualmente desde Supabase SQL Editor.
ALTER TABLE empleados
  ADD COLUMN IF NOT EXISTS acceso_tiempos BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN empleados.acceso_tiempos IS
  'true = puede acceder a tiempos.html para ver/editar tiempos. Admin siempre tiene acceso implícito. Operarios nunca.';
