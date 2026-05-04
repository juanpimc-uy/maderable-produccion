-- Lote U1.B — Prompt 3.5: Limpieza de tareas zombie
-- Ejecutar una sola vez en producción

-- 1. Ver zombies antes de limpiar
SELECT rt.id, rt.empleado_id, rt.centro, rt.inicio, rt.ultima_actividad,
       j.fecha, j.salida AS jornada_salida
FROM registros_trabajo rt
JOIN jornadas j ON j.id = rt.jornada_id
WHERE rt.estado = 'activo'
  AND j.salida IS NOT NULL;

-- 2. Cerrar tareas zombie: marcar como 'pausado' con fin = jornada.salida
UPDATE registros_trabajo rt
SET fin    = j.salida,
    estado = 'pausado'
FROM jornadas j
WHERE rt.jornada_id = j.id
  AND rt.estado     = 'activo'
  AND j.salida      IS NOT NULL;
