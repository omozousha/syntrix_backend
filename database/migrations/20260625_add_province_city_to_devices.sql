-- Migration: Add province/city columns to devices table
-- Pattern: Same as pops and customers — store both ID (for combobox) and display name (for fallback)

alter table public.devices
  add column if not exists province_id uuid references public.provinces(id) on update cascade on delete set null,
  add column if not exists city_id uuid references public.cities(id) on update cascade on delete set null,
  add column if not exists province text,
  add column if not exists city text;

create index if not exists idx_devices_province_id on public.devices(province_id);
create index if not exists idx_devices_city_id on public.devices(city_id);
