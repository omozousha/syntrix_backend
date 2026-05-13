alter table if exists public.devices
  add column if not exists odp_type text,
  add column if not exists installation_type text;
