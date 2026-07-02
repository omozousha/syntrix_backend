-- Core Capacities Master Data
-- Master table untuk kapasitas core kabel fiber optik standar

create sequence if not exists public.core_capacity_hid_seq start 1;

create table if not exists public.core_capacities (
  id uuid primary key default gen_random_uuid(),
  core_capacity_id text unique default public.generate_prefixed_code('CCP', 'public.core_capacity_hid_seq'),
  core_capacity_value integer not null,
  label text not null unique,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  deleted_by_user_id uuid references public.app_users(id) on update cascade on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_core_capacities_updated_at on public.core_capacities;
create trigger trg_core_capacities_updated_at
before update on public.core_capacities
for each row execute function public.set_current_timestamp_updated_at();

create index if not exists idx_core_capacities_active
  on public.core_capacities(is_active, sort_order, core_capacity_value);

-- Seed data: standard fiber optic core capacities
insert into public.core_capacities (core_capacity_value, label, description, sort_order)
values
  (12,   '12 Cores',   'Kabel 12 core — untuk distribusi skala kecil / last mile.', 1),
  (24,   '24 Cores',   'Kabel 24 core — standar untuk distribusi ODC ke ODP.', 2),
  (48,   '48 Cores',   'Kabel 48 core — untuk feeder/distribusi menengah.', 3),
  (96,   '96 Cores',   'Kabel 96 core — standar untuk backbone/feeder.', 4),
  (144,  '144 Cores',  'Kabel 144 core — untuk backbone kapasitas tinggi.', 5),
  (288,  '288 Cores',  'Kabel 288 core — untuk backbone core dense / metro.', 6)
on conflict (label) do nothing;
