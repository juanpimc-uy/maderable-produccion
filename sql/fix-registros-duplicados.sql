-- fix-registros-duplicados.sql
-- Bug: sesiones duplicadas en registros_trabajo (múltiples estado='activo' por empleado)
-- Ejecutar ANTES del deploy del código.

-- 1. Limpiar duplicados existentes: mantener el más reciente por empleado,
--    marcar los demás como 'pausado'
UPDATE registros_trabajo r1
SET estado = 'pausado', fin = NOW()
WHERE estado = 'activo'
  AND id NOT IN (
    SELECT DISTINCT ON (empleado_id) id
    FROM registros_trabajo
    WHERE estado = 'activo'
    ORDER BY empleado_id, inicio DESC
  );

-- 2. Índice único parcial: solo 1 registro activo por empleado
CREATE UNIQUE INDEX IF NOT EXISTS uq_registro_activo
ON registros_trabajo (empleado_id)
WHERE estado = 'activo';
