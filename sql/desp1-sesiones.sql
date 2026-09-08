-- DESP-1 · tabla de sesiones multi-contexto
-- NO reemplaza empleados.session_token todavía. Solo la usa el módulo de despacho.
create table if not exists public.sesiones (
  token       uuid primary key default gen_random_uuid(),
  empleado_id uuid not null references public.empleados(id) on delete cascade,
  contexto    text not null check (contexto in ('oficina','kiosco','despacho')),
  dispositivo text,
  creado_en   timestamptz not null default now(),
  ultimo_uso  timestamptz not null default now(),
  expira_at   timestamptz not null
);

create index if not exists ix_sesiones_empleado on public.sesiones (empleado_id);
create index if not exists ix_sesiones_contexto_exp on public.sesiones (contexto, expira_at);

alter table public.sesiones enable row level security;
-- sin policies: se accede solo con service role desde /api
