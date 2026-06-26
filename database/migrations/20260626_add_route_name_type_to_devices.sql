-- Add route_name, route_type, cable_type, cable_length_m to devices table
-- route_name/route_type: route information that belongs to the cable device
-- cable_type/cable_length_m: cable-specific fields that were previously
-- sent by the frontend but silently dropped by sanitizePayload

alter table if exists public.devices
  add column if not exists route_name text,
  add column if not exists route_type text,
  add column if not exists cable_type text,
  add column if not exists cable_length_m numeric(12,2);

create index if not exists idx_devices_route_type
  on public.devices(route_type)
  where route_type is not null;

create index if not exists idx_devices_cable_type
  on public.devices(cable_type)
  where cable_type is not null;
