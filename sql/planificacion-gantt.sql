-- ═══════════════════════════════════════════════════════════════════════
-- RPC planificacion_gantt() — gantt global de entregas para planificacion.html
-- Ejecutar a mano en Supabase SQL Editor (proyecto ERP xhfeurinovvsbgobkidy).
-- Variante global de mct_proyecto: todos los proyectos en_produccion,
-- solo muebles NO completados (sin evento 'completado' en items_completado_log
-- y sin fila en despachos_muebles — mismo criterio completado_real del MCT).
-- Strip de actividad limitado a p_dias_strip días hacia atrás (default 60).
-- Validado read-only el 09-ago-2026: 198 pendientes / 35 con fecha / 163 sin fecha.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.planificacion_gantt(p_dias_strip int default 60)
returns jsonb
language sql
stable
as $function$
with pry as (
  select id, numero,
         coalesce(nullif(nombre,''), nullif(obra,''), numero) proyecto_nombre,
         muebles
  from proyectos_cache
  where estado = 'en_produccion'
),
cod as (
  select p.id proyecto_id, p.numero, p.proyecto_nombre,
         (elem->>'id') item_id, (elem->>'codigo') codigo,
         coalesce(nullif(elem->>'nombre',''), elem->>'id') item_nombre
  from pry p,
       jsonb_array_elements(case when jsonb_typeof(p.muebles)='array'
                                 then p.muebles else '[]'::jsonb end) elem
  where (elem->>'id') ~ '^mf_[0-9]+$'
),
comp as (
  select distinct on (proyecto_id, item_id) proyecto_id, item_id, evento
  from items_completado_log
  where proyecto_id in (select id from pry)
  order by proyecto_id, item_id, completado_en desc
),
desp as (
  select proyecto_id, mf_n item_id
  from despachos_muebles
  where proyecto_id in (select id from pry)
  group by 1, 2
),
pend as (
  select c.*
  from cod c
  left join comp cl on cl.proyecto_id = c.proyecto_id and cl.item_id = c.item_id
  left join desp d  on d.proyecto_id  = c.proyecto_id and d.item_id  = c.item_id
  where coalesce(cl.evento,'') <> 'completado'
    and d.item_id is null
),
ent as (
  select proyecto_id, item_id, fecha_comprometida
  from entregas_comprometidas
  where proyecto_id in (select id from pry)
),
rt as (
  select r.proyecto_id, r.item_id, r.centro,
         (r.inicio at time zone 'America/Montevideo')::date dia
  from registros_trabajo r
  join pend p on p.proyecto_id = r.proyecto_id and p.item_id = r.item_id
  where coalesce(r.eliminada,false) = false
    and r.centro in ('modelado','cam','corte','enchapado','armado',
                     'revision','shop_drawing','herreria')
    and (r.inicio at time zone 'America/Montevideo')::date >= current_date - p_dias_strip
),
agg as (
  select proyecto_id, item_id, min(dia) primer_toque, max(dia) ultimo_toque
  from rt
  group by 1, 2
),
ter_win as (
  select c.proyecto_id, c.item_id,
         case when pt.fecha_despacho  ~ '^\d{4}-\d{2}-\d{2}$' then pt.fecha_despacho::date
              when pt.fecha_despacho  ~ '^\d{2}/\d{2}/\d{4}$' then to_date(pt.fecha_despacho,'DD/MM/YYYY') end desde,
         case when pt.fecha_recepcion ~ '^\d{4}-\d{2}-\d{2}$' then pt.fecha_recepcion::date
              when pt.fecha_recepcion ~ '^\d{2}/\d{2}/\d{4}$' then to_date(pt.fecha_recepcion,'DD/MM/YYYY') end hasta,
         pt.proveedor_nombre prov, pt.tipo
  from partidas_terceros pt
  join pend c on c.numero = pt.proyecto_num and c.codigo = pt.mueble_codigo
  where nullif(pt.fecha_despacho,'') is not null
    and nullif(pt.mueble_codigo,'') is not null
),
muebles as (
  select p.proyecto_id, p.numero, p.proyecto_nombre,
         p.item_id, p.codigo, p.item_nombre,
         e.fecha_comprometida,
         a.primer_toque, a.ultimo_toque,
         (a.item_id is null) sin_actividad,
         coalesce((select jsonb_agg(jsonb_build_object(
                      'desde', t.desde, 'hasta', t.hasta,
                      'prov', t.prov, 'tipo', t.tipo)
                    order by t.desde)
                   from ter_win t
                   where t.proyecto_id = p.proyecto_id
                     and t.item_id = p.item_id
                     and t.desde is not null), '[]'::jsonb) terceros
  from pend p
  left join ent e on e.proyecto_id = p.proyecto_id and e.item_id = p.item_id
  left join agg a on a.proyecto_id = p.proyecto_id and a.item_id = p.item_id
),
strip_raw as (
  select proyecto_id, item_id, dia,
         case centro when 'modelado' then 'MODELADO' when 'cam' then 'CAM'
           when 'corte' then 'CORTE' when 'enchapado' then 'ENCH/PERF'
           when 'armado' then 'ARMADO' else 'OTRO' end etapa,
         count(*) c
  from rt
  group by 1, 2, 3, 4
),
strip as (
  select distinct on (proyecto_id, item_id, dia) proyecto_id, item_id, dia, etapa
  from strip_raw
  order by proyecto_id, item_id, dia, c desc, etapa
)
select jsonb_build_object(
  'dias_strip', p_dias_strip,
  'muebles', coalesce((select jsonb_agg(to_jsonb(m)
                order by m.fecha_comprometida asc nulls last, m.numero,
                         (regexp_replace(m.item_id,'^mf_','')::bigint))
              from muebles m), '[]'::jsonb),
  'strip', coalesce((select jsonb_agg(jsonb_build_object(
                'proyecto_id', s.proyecto_id, 'item_id', s.item_id,
                'dia', s.dia, 'etapa', s.etapa)
                order by s.proyecto_id, s.dia)
              from strip s), '[]'::jsonb)
);
$function$;

-- Prueba rápida post-create:
-- select jsonb_array_length(planificacion_gantt()->'muebles');   -- esperado ~198
-- select jsonb_array_length(planificacion_gantt()->'strip');     -- esperado ~282 (09-ago)
