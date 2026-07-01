-- Cable Categories Master Data
-- Master table untuk mengelola kategori kabel (feeder, distribution, backbone, drop)
-- Ditambah cable_category column di devices dengan FK ke cable_categories

-- 1. Create cable_categories master table
create sequence if not exists public.cable_category_hid_seq start 1;

create table if not exists public.cable_categories (
  id uuid primary key default gen_random_uuid(),
  cable_category_id text unique default public.generate_prefixed_code('CCAT', 'public.cable_category_hid_seq'),
  cable_category_code text unique,
  cable_category_name text not null unique,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  deleted_by_user_id uuid references public.app_users(id) on update cascade on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_cable_categories_updated_at on public.cable_categories;
create trigger trg_cable_categories_updated_at
before update on public.cable_categories
for each row execute function public.set_current_timestamp_updated_at();

create index if not exists idx_cable_categories_active
  on public.cable_categories(is_active, sort_order, cable_category_name);

-- 2. Seed data: feeder, distribution, backbone, drop
insert into public.cable_categories (cable_category_code, cable_category_name, description, sort_order)
values
  ('feeder',       'Feeder',       'Kabel penghubung OTB/POP ke ODC. Membawa sinyal dari POP ke area distribusi.',       1),
  ('distribution', 'Distribution', 'Kabel penghubung ODC ke ODP. Mendistribusikan sinyal ke titik akses pelanggan.',   2),
  ('backbone',     'Backbone',     'Kabel utama antar POP atau antar wilayah. Kapasitas core besar sebagai tulang punggung jaringan.', 3),
  ('drop',         'Drop',         'Kabel penghubung ODP ke ONT pelanggan. Last mile koneksi ke rumah pelanggan.',     4)
on conflict (cable_category_name) do nothing;

-- 3. Add cable_category column to devices table
-- Links to cable_categories for cable-type devices
alter table if exists public.devices
  add column if not exists cable_category text
    check (cable_category is null or cable_category in ('feeder', 'distribution', 'backbone', 'drop'));

comment on column public.devices.cable_category is 'Kategori kabel: feeder, distribution, backbone, drop. Hanya relevan untuk device_type_key = CABLE.';

create index if not exists idx_devices_cable_category
  on public.devices(cable_category)
  where cable_category is not null;

-- 4. Strengthen route_type constraint for CABLE devices
-- route_type should only be distribution, backbone, or feeder
alter table if exists public.devices
  drop constraint if exists chk_devices_route_type_cable;

alter table if exists public.devices
  add constraint chk_devices_route_type_cable
    check (
      device_type_key <> 'CABLE'
      or route_type is null
      or route_type in ('distribution', 'backbone', 'feeder')
    );
