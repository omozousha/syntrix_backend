-- Enable soft delete lifecycle for operational ODP entities.
-- This allows archive -> trash -> restore/purge flow for devices and device_ports.

alter table if exists public.devices
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user_id uuid references public.app_users(id) on update cascade on delete set null;

alter table if exists public.device_ports
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user_id uuid references public.app_users(id) on update cascade on delete set null;

create index if not exists idx_devices_deleted_at on public.devices(deleted_at);
create index if not exists idx_device_ports_deleted_at on public.device_ports(deleted_at);
