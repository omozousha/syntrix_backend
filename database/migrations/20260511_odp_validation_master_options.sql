-- Master options for ODP field validation form.

create table if not exists public.odp_types (
  id uuid primary key default gen_random_uuid(),
  odp_type_code text unique,
  odp_type_name text not null unique,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  deleted_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_odp_types_updated_at on public.odp_types;
create trigger trg_odp_types_updated_at
before update on public.odp_types
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.installation_types (
  id uuid primary key default gen_random_uuid(),
  installation_type_code text unique,
  installation_type_name text not null unique,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  deleted_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_installation_types_updated_at on public.installation_types;
create trigger trg_installation_types_updated_at
before update on public.installation_types
for each row execute function public.set_current_timestamp_updated_at();

insert into public.odp_types (odp_type_code, odp_type_name, sort_order, is_active)
values
  ('ODP_PB', 'ODP PB', 10, true),
  ('ODP_CA', 'ODP CA', 20, true),
  ('ODP_US', 'ODP US', 30, true)
on conflict (odp_type_name) do update
set
  odp_type_code = excluded.odp_type_code,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

insert into public.installation_types (installation_type_code, installation_type_name, sort_order, is_active)
values
  ('AERIAL', 'Aerial', 10, true),
  ('PEDESTRIAL', 'Pedestrial', 20, true)
on conflict (installation_type_name) do update
set
  installation_type_code = excluded.installation_type_code,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();
