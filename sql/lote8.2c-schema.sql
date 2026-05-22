-- lote8.2c-schema.sql
-- Horario de entrada configurable por empleado.
-- Ejecutar manualmente en Supabase ANTES del deploy.

ALTER TABLE empleados
  ADD COLUMN IF NOT EXISTS horario_entrada TIME DEFAULT '07:30';

UPDATE empleados SET horario_entrada = '09:00'
  WHERE rol_app IN ('oficina', 'admin');
