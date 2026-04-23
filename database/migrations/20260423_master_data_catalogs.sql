-- Master data catalogs for NetBox-style reusable references.
-- Adds:
-- 1) device_type_catalog
-- 2) pop_types
-- 3) provinces
-- 4) cities
-- 5) optional FK references on pops

create table if not exists public.device_type_catalog (
  id uuid primary key default gen_random_uuid(),
  device_type_key text not null unique,
  device_type_name text not null,
  asset_group text not null check (asset_group in ('active', 'passive')),
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_device_type_catalog_updated_at on public.device_type_catalog;
create trigger trg_device_type_catalog_updated_at
before update on public.device_type_catalog
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.pop_types (
  id uuid primary key default gen_random_uuid(),
  pop_type_code text unique,
  pop_type_name text not null unique,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_pop_types_updated_at on public.pop_types;
create trigger trg_pop_types_updated_at
before update on public.pop_types
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.provinces (
  id uuid primary key default gen_random_uuid(),
  province_code text unique,
  province_name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_provinces_updated_at on public.provinces;
create trigger trg_provinces_updated_at
before update on public.provinces
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.cities (
  id uuid primary key default gen_random_uuid(),
  city_code text unique,
  city_name text not null,
  province_id uuid references public.provinces(id) on update cascade on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (province_id, city_name)
);

drop trigger if exists trg_cities_updated_at on public.cities;
create trigger trg_cities_updated_at
before update on public.cities
for each row execute function public.set_current_timestamp_updated_at();

alter table if exists public.pops
  add column if not exists pop_type_id uuid,
  add column if not exists province_id uuid,
  add column if not exists city_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pops_pop_type_id_fkey'
  ) then
    alter table public.pops
      add constraint pops_pop_type_id_fkey
      foreign key (pop_type_id) references public.pop_types(id) on update cascade on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pops_province_id_fkey'
  ) then
    alter table public.pops
      add constraint pops_province_id_fkey
      foreign key (province_id) references public.provinces(id) on update cascade on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pops_city_id_fkey'
  ) then
    alter table public.pops
      add constraint pops_city_id_fkey
      foreign key (city_id) references public.cities(id) on update cascade on delete set null;
  end if;
end $$;

-- Seed device type catalog (idempotent).
insert into public.device_type_catalog (device_type_key, device_type_name, asset_group, description, sort_order)
values
  ('OLT', 'OLT', 'active', 'Optical Line Terminal', 10),
  ('SWITCH', 'Switch', 'active', 'Network switch asset', 20),
  ('ROUTER', 'Router', 'active', 'Routing device asset', 30),
  ('ONT', 'ONT', 'active', 'Optical Network Terminal', 40),
  ('OTB', 'OTB', 'passive', 'Optical Termination Box', 50),
  ('JC', 'JC', 'passive', 'Joint Closure', 60),
  ('ODC', 'ODC', 'passive', 'Optical Distribution Cabinet', 70),
  ('ODP', 'ODP', 'passive', 'Optical Distribution Point', 80),
  ('CABLE', 'Cable', 'passive', 'Fiber cable asset', 90)
on conflict (device_type_key) do update
set
  device_type_name = excluded.device_type_name,
  asset_group = excluded.asset_group,
  description = excluded.description,
  sort_order = excluded.sort_order,
  updated_at = now();

-- Seed pop type catalog defaults (idempotent).
insert into public.pop_types (pop_type_code, pop_type_name, description, sort_order)
values
  ('PRIMARY', 'Primary', 'POP utama primer', 10),
  ('MAIN_POP', 'Main POP', 'POP inti wilayah', 20),
  ('POP_OUTDOOR', 'POP Outdoor', 'POP outdoor lapangan', 30),
  ('DISTRIBUTION', 'Distribution', 'POP distribusi', 40),
  ('EDGE', 'Edge', 'POP edge / akses', 50)
on conflict (pop_type_name) do update
set
  pop_type_code = excluded.pop_type_code,
  description = excluded.description,
  sort_order = excluded.sort_order,
  updated_at = now();

-- Backfill province catalog from existing pops.province values.
insert into public.provinces (province_name)
select distinct trim(province)
from public.pops
where province is not null and trim(province) <> ''
on conflict (province_name) do nothing;

-- Backfill city catalog from existing pops.city + pops.province values.
insert into public.cities (city_name, province_id)
select distinct
  trim(p.city) as city_name,
  prov.id as province_id
from public.pops p
left join public.provinces prov
  on lower(prov.province_name) = lower(trim(coalesce(p.province, '')))
where p.city is not null and trim(p.city) <> ''
on conflict (province_id, city_name) do nothing;

-- Backfill pop type by existing text value.
insert into public.pop_types (pop_type_name)
select distinct trim(pop_type)
from public.pops
where pop_type is not null and trim(pop_type) <> ''
on conflict (pop_type_name) do nothing;

-- Link existing pop rows to master data ids.
update public.pops p
set pop_type_id = pt.id
from public.pop_types pt
where p.pop_type_id is null
  and p.pop_type is not null
  and lower(trim(p.pop_type)) = lower(pt.pop_type_name);

update public.pops p
set province_id = prov.id
from public.provinces prov
where p.province_id is null
  and p.province is not null
  and lower(trim(p.province)) = lower(prov.province_name);

update public.pops p
set city_id = c.id
from public.cities c
left join public.provinces prov on prov.id = c.province_id
where p.city_id is null
  and p.city is not null
  and lower(trim(p.city)) = lower(c.city_name)
  and (
    p.province is null
    or trim(p.province) = ''
    or prov.id is null
    or lower(trim(p.province)) = lower(prov.province_name)
  );

create index if not exists idx_pops_pop_type_id on public.pops(pop_type_id);
create index if not exists idx_pops_province_id on public.pops(province_id);
create index if not exists idx_pops_city_id on public.pops(city_id);
create index if not exists idx_device_type_catalog_active on public.device_type_catalog(is_active, sort_order);
create index if not exists idx_pop_types_active on public.pop_types(is_active, sort_order);
create index if not exists idx_provinces_active on public.provinces(is_active, province_name);
create index if not exists idx_cities_lookup on public.cities(province_id, city_name, is_active);

