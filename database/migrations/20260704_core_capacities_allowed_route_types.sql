-- Core Capacities: Add allowed_route_type_keys filter
-- Menambahkan kolom allowed_route_type_keys (jsonb) untuk filter berdasarkan kategori kabel
-- Pattern: sama seperti splitter_profiles.allowed_device_type_keys

alter table public.core_capacities
  add column if not exists allowed_route_type_keys jsonb default null;

comment on column public.core_capacities.allowed_route_type_keys is
  'Array of route_type_code values that this core capacity applies to. Null = berlaku untuk semua route type.';

-- Update seed data dengan allowed_route_type_keys yang sesuai
update public.core_capacities set
  allowed_route_type_keys = '["BACKBONE", "FEEDER", "DISTRIBUTION"]'::jsonb,
  description = 'Kabel 48 core — untuk backbone/feeder/distribusi menengah.'
where core_capacity_value = 48;

update public.core_capacities set
  allowed_route_type_keys = '["BACKBONE", "FEEDER"]'::jsonb,
  description = 'Kabel 96 core — standar untuk backbone/feeder.'
where core_capacity_value = 96;

update public.core_capacities set
  allowed_route_type_keys = '["BACKBONE", "FEEDER"]'::jsonb,
  description = 'Kabel 144 core — untuk backbone kapasitas tinggi.'
where core_capacity_value = 144;

update public.core_capacities set
  allowed_route_type_keys = '["BACKBONE"]'::jsonb,
  description = 'Kabel 288 core — untuk backbone core dense / metro.'
where core_capacity_value = 288;

-- 12 dan 24 cores: null = berlaku untuk semua route type (ACCESS, DROP, DISTRIBUTION, dll.)
-- Biarkan null karena core kecil cocok untuk semua kategori termasuk last mile.
