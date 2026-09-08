-- ═══════════════════════════════════════════════════════════════════════
-- RPC mct_proyecto(p_proyecto_id) — copia canónica de la función deployada
-- en la base ERP (xhfeurinovvsbgobkidy). Deploy: a mano en SQL Editor.
-- 12-ago-2026: incluye filtro de muebles archivados en CTE cod.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.mct_proyecto(p_proyecto_id text)
returns jsonb
language sql
stable
as $function$
with w as (
  select unnest(array['modelado','cam','corte','enchapado','armado',
                      'revision','shop_drawing','herreria']) as c
),
rt as (
  select r.item_id, r.centro, r.inicio, r.item_nombre,
         (r.inicio at time zone 'America/Montevideo')::date as dia
  from registros_trabajo r
  where r.proyecto_id = p_proyecto_id
    and coalesce(r.eliminada,false)=false
    and r.item_id ~ '^mf_[0-9]+$'
    and r.centro in (select c from w)
),
nombre as (
  select distinct on (item_id) item_id, item_nombre
  from rt where item_nombre is not null and item_nombre<>''
  order by item_id, inicio desc
),
agg as (
  select item_id, max(inicio) ultimo_toque_ts, min(dia) primer_toque,
         count(distinct dia) proceso_dias
  from rt group by item_id
),
comp as (
  select distinct on (item_id) item_id, evento, completado_en
  from items_completado_log where proyecto_id=p_proyecto_id
  order by item_id, completado_en desc
),
desp as (
  select mf_n item_id, max(fecha_despacho) fecha_despacho
  from despachos_muebles where proyecto_id=p_proyecto_id group by mf_n
),
pry as (
  select numero, nullif(fecha_inicio,'')::date inicio, muebles
  from proyectos_cache where id=p_proyecto_id
),
cod as (
  select (elem->>'id') item_id, (elem->>'codigo') codigo
  from pry, jsonb_array_elements(
         case when jsonb_typeof(muebles)='array' then muebles else '[]'::jsonb end) elem
  where coalesce((elem->>'archivado')::boolean, false) = false   -- ← ARCHIVADO
),
-- universo de muebles estándar (mf_N) para el Gantt; cod queda intacto para ter_win
cod_mf as (
  select item_id, codigo from cod where item_id ~ '^mf_[0-9]+$'
),
ent as (
  select item_id, fecha_comprometida
  from entregas_comprometidas where proyecto_id=p_proyecto_id
),
ter_win as (
  select c.item_id,
         case when pt.fecha_despacho  ~ '^\d{4}-\d{2}-\d{2}$' then pt.fecha_despacho::date
              when pt.fecha_despacho  ~ '^\d{2}/\d{2}/\d{4}$' then to_date(pt.fecha_despacho,'DD/MM/YYYY') end as desde,
         case when pt.fecha_recepcion ~ '^\d{4}-\d{2}-\d{2}$' then pt.fecha_recepcion::date
              when pt.fecha_recepcion ~ '^\d{2}/\d{2}/\d{4}$' then to_date(pt.fecha_recepcion,'DD/MM/YYYY') end as hasta,
         pt.proveedor_nombre prov, pt.tipo
  from partidas_terceros pt
  join pry p on p.numero = pt.proyecto_num
  join cod c on c.codigo = pt.mueble_codigo
  where nullif(pt.fecha_despacho,'') is not null
    and nullif(pt.mueble_codigo,'') is not null
),
muebles as (
  select c.item_id,
         coalesce(n.item_nombre, c.item_id) item_nombre,
         (select inicio from pry) inicio,
         (a.item_id is not null) tiene_actividad,
         -- fin = fecha del último estado conocido (despacho > completado > último toque).
         -- Maneja el span de la barra; null si el mueble no tiene actividad.
         coalesce(
           (d.fecha_despacho at time zone 'America/Montevideo')::date,
           case when cl.evento='completado'
                then (cl.completado_en at time zone 'America/Montevideo')::date end,
           (a.ultimo_toque_ts at time zone 'America/Montevideo')::date
         ) fin,
         -- completado REAL: flag COMPLETAR (ledger) o despacho
         (coalesce(cl.evento='completado', false) or d.fecha_despacho is not null) completado_real,
         -- fecha del completado real (= fin cuando está completo; cae a último toque
         -- si no hay completado_en). NULL si no está completo o no tiene horas.
         case when (coalesce(cl.evento='completado', false) or d.fecha_despacho is not null)
              then coalesce(
                     (d.fecha_despacho at time zone 'America/Montevideo')::date,
                     case when cl.evento='completado'
                          then (cl.completado_en at time zone 'America/Montevideo')::date end,
                     (a.ultimo_toque_ts at time zone 'America/Montevideo')::date
                   )
         end completado_en_real,
         a.primer_toque,
         coalesce(a.proceso_dias,0) proceso_dias
  from cod_mf c
  left join nombre n on n.item_id=c.item_id
  left join agg    a on a.item_id=c.item_id
  left join comp   cl on cl.item_id=c.item_id
  left join desp   d on d.item_id=c.item_id
),
muebles_calc as (
  select m.item_id, m.item_nombre, m.inicio, m.fin, m.primer_toque, m.proceso_dias,
         (not m.tiene_actividad)                                                  sin_actividad,
         m.completado_real,
         m.completado_en_real,
         case when m.fin is not null then (m.fin-m.inicio+1) end                  span_dias,
         case when m.fin is not null then (m.fin-m.inicio+1)-m.proceso_dias end   espera,
         case when m.primer_toque is not null
              then greatest(m.primer_toque-m.inicio,0) end                        espera_inicial,
         case when m.fin is not null
              then round(m.proceso_dias::numeric/nullif((m.fin-m.inicio+1),0),2) end flow_eff,
         e.fecha_comprometida,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'desde',t.desde,'hasta',t.hasta,'prov',t.prov,'tipo',t.tipo)
                     order by t.desde)
                   from ter_win t where t.item_id=m.item_id and t.desde is not null),'[]'::jsonb) terceros
  from muebles m
  left join ent e on e.item_id=m.item_id
  where m.inicio is not null
    and (m.fin is null or (m.fin-m.inicio+1)>0)   -- conserva los sin actividad (fin null)
),
strip_raw as (
  select item_id, dia,
    case centro when 'modelado' then 'MODELADO' when 'cam' then 'CAM'
      when 'corte' then 'CORTE' when 'enchapado' then 'ENCH/PERF'
      when 'armado' then 'ARMADO' else 'OTRO' end etapa,
    count(*) c
  from rt group by item_id, dia, 3
),
strip as (
  select distinct on (item_id,dia) item_id, dia, etapa
  from strip_raw order by item_id, dia, c desc, etapa
)
select jsonb_build_object(
  'proyecto_id', p_proyecto_id,
  'split_confiable', coalesce((select inicio from pry) >= date '2026-05-12', false),
  'muebles', coalesce((select jsonb_agg(to_jsonb(mc)
               order by (regexp_replace(mc.item_id,'^mf_','')::bigint))
               from muebles_calc mc),'[]'::jsonb),
  'strip', coalesce((select jsonb_agg(jsonb_build_object(
               'item_id',s.item_id,'dia',s.dia,'etapa',s.etapa)
               order by (regexp_replace(s.item_id,'^mf_','')::bigint), s.dia)
             from strip s where s.item_id in (select item_id from muebles_calc)),'[]'::jsonb)
);
$function$;
