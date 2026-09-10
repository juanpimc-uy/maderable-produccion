-- INVRES-1 · Reservas de placas
-- Bloque 1: trazabilidad de la reserva (quién y cuándo)
alter table inv_unidades
  add column if not exists reserva_por uuid,
  add column if not exists reserva_en  timestamptz;

create index if not exists ix_inv_unidades_reserva
  on inv_unidades (item_id)
  where reserva_proyecto_id is not null and estado = 'activa';

-- Verificación (debe dar 0): no puede haber reserva sobre una unidad no activa
-- select count(*) from inv_unidades where reserva_proyecto_id is not null and estado <> 'activa';
