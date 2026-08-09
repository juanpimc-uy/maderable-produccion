-- ═══════════════════════════════════════════════════════════════════════
-- RPC capacidad_horas_fichadas() — horas de taller ya fichadas por mueble
-- para capacidad.html. Ejecutar a mano en Supabase SQL Editor (ERP).
-- Solo proyectos en_produccion. Centros de taller: corte/enchapado/armado/cam.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.capacidad_horas_fichadas()
returns table(proyecto_id text, item_id text, horas numeric)
language sql
stable
as $function$
  select r.proyecto_id, r.item_id,
         round((sum(extract(epoch from (r.fin - r.inicio))) / 3600)::numeric, 1) as horas
  from registros_trabajo r
  join proyectos_cache p on p.id = r.proyecto_id and p.estado = 'en_produccion'
  where coalesce(r.eliminada, false) = false
    and r.fin is not null
    and r.centro in ('corte','enchapado','armado','cam')
  group by 1, 2;
$function$;

-- Prueba rápida post-create:
-- select count(*), round(sum(horas)) from capacidad_horas_fichadas();
