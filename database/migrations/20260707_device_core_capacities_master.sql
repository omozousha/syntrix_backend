-- Device Core Capacities Master Data
-- Master table untuk kapasitas core perangkat pasif (OTB, ODC, JC)
-- Terpisah dari core_capacities yang khusus untuk kabel (cable)

create sequence if not exists public.device_core_capacity_hid_seq start 1;

create table if not exists public.device_core_capacities (
  id uuid primary key default gen_random_uuid(),
  device_core_capacity_id text unique default public.generate_prefixed_code('DCC', 'public.device_core_capacity_hid_seq'),
  core_capacity_value integer not null,
  label text not null unique,
  description text,
  allowed_device_type_keys jsonb default null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  deleted_by_user_id uuid references public.app_users(id) on update cascade on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.device_core_capacities.allowed_device_type_keys is
  'Array of device_type_key values that this core capacity applies to (OTB, ODC, JC, etc.). Null = berlaku untuk semua device type.';

drop trigger if exists trg_device_core_capacities_updated_at on public.device_core_capacities;
create trigger trg_device_core_capacities_updated_at
before update on public.device_core_capacities
for each row execute function public.set_current_timestamp_updated_at();

create index if not exists idx_device_core_capacities_active
  on public.device_core_capacities(is_active, sort_order, core_capacity_value);

-- Seed data: standard core capacities for passive devices
insert into public.device_core_capacities (core_capacity_value, label, description, allowed_device_type_keys, sort_order)
values
  (4,   '4 Cores',    'Kapasitas 4 core — untuk sambungan kecil / distribusi akhir.', '["OTB", "JC"]'::jsonb, 1),
  (8,   '8 Cores',    'Kapasitas 8 core — untuk sambungan menengah / OTB kecil.', '["OTB", "JC"]'::jsonb, 2),
  (12,  '12 Cores',   'Kapasitas 12 core — standar OTB / sambungan distribusi.', null, 3),
  (24,  '24 Cores',   'Kapasitas 24 core — untuk ODC/OTB menengah.', null, 4),
  (48,  '48 Cores',   'Kapasitas 48 core — untuk ODC kapasitas menengah.', '["ODC"]'::jsonb, 5),
  (96,  '96 Cores',   'Kapasitas 96 core — untuk ODC kapasitas besar.', '["ODC"]'::jsonb, 6),
  (144, '144 Cores',  'Kapasitas 144 core — untuk ODC backbone.', '["ODC"]'::jsonb, 7)
on conflict (label) do nothing;
