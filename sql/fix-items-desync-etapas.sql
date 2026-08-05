-- Backfill: re-sincronizar la proyección items con muebles (6 proyectos activos driftados).
-- Causa: partir-tarea / eliminar-etapa / sync de precios actualizaban solo muebles.
-- Ejecutar DESPUÉS de deployar el fix de tiempos.js e informes.js.
update proyectos_cache
set items = muebles
where muebles::text is distinct from items::text;
-- Verificación (debe dar 0):
select count(*) from proyectos_cache where muebles::text is distinct from items::text;
