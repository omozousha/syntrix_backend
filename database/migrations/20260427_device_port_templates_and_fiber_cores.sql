-- Phase 2 foundation for SoT topology:
-- 1) Device port templates per device_type_key
-- 2) Fiber core inventory per cable device
-- 3) Optional backfill from existing cable capacity

create sequence if not exists public.device_port_template_hid_seq start 1;
create sequence if not exists public.fiber_core_hid_seq start 1;

create table if not exists public.device_port_templates (
  id uuid primary key default gen_random_uuid(),
  template_id text unique default public.generate_prefixed_code('DPT', 'public.device_port_template_hid_seq'),
  device_type_key text not null references public.device_type_catalog(device_type_key) on update cascade on delete restrict,
  profile_name text not null default 'default',
  total_ports integer not null check (total_ports > 0),
  start_port_index integer not null default 1 check (start_port_index > 0),
  default_port_type text not null default 'fiber'
    check (default_port_type in ('ethernet', 'pon', 'uplink', 'fiber', 'splitter', 'other')),
  default_direction text not null default 'bidirectional'
    check (default_direction in ('in', 'out', 'bidirectional')),
  default_speed_profile text,
  default_core_capacity integer check (default_core_capacity is null or default_core_capacity >= 0),
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_type_key, profile_name)
);

drop trigger if exists trg_device_port_templates_updated_at on public.device_port_templates;
create trigger trg_device_port_templates_updated_at
before update on public.device_port_templates
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.fiber_cores (
  id uuid primary key default gen_random_uuid(),
  core_id text unique default public.generate_prefixed_code('FCR', 'public.fiber_core_hid_seq'),
  region_id uuid not null references public.regions(id) on update cascade on delete restrict,
  cable_device_id uuid not null references public.devices(id) on update cascade on delete cascade,
  core_no integer not null check (core_no > 0),
  status text not null default 'available'
    check (status in ('available', 'used', 'reserved', 'damaged', 'inactive')),
  from_port_id uuid references public.device_ports(id) on update cascade on delete set null,
  to_port_id uuid references public.device_ports(id) on update cascade on delete set null,
  connection_id uuid references public.port_connections(id) on update cascade on delete set null,
  splice_label text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cable_device_id, core_no),
  constraint chk_fiber_cores_not_same_port check (
    from_port_id is null
    or to_port_id is null
    or from_port_id <> to_port_id
  )
);

drop trigger if exists trg_fiber_cores_updated_at on public.fiber_cores;
create trigger trg_fiber_cores_updated_at
before update on public.fiber_cores
for each row execute function public.set_current_timestamp_updated_at();

create index if not exists idx_device_port_templates_type_active
  on public.device_port_templates(device_type_key, is_active, profile_name);
create index if not exists idx_fiber_cores_region_status
  on public.fiber_cores(region_id, status);
create index if not exists idx_fiber_cores_cable_core_no
  on public.fiber_cores(cable_device_id, core_no);
create index if not exists idx_fiber_cores_connection_id
  on public.fiber_cores(connection_id);

-- Default templates (idempotent).
insert into public.device_port_templates
  (device_type_key, profile_name, total_ports, start_port_index, default_port_type, default_direction, default_core_capacity, metadata)
values
  ('OLT', 'default', 16, 1, 'pon', 'out', 1, '{"hint":"Default OLT PON profile"}'::jsonb),
  ('ODC', 'default', 24, 1, 'fiber', 'bidirectional', 1, '{"hint":"Default ODC port profile"}'::jsonb),
  ('ODP', 'default', 16, 1, 'fiber', 'bidirectional', 1, '{"hint":"Default ODP drop profile"}'::jsonb),
  ('OTB', 'default', 12, 1, 'fiber', 'bidirectional', 1, '{"hint":"Default OTB splice profile"}'::jsonb),
  ('ONT', 'default', 4, 1, 'ethernet', 'out', null, '{"hint":"Default ONT LAN profile"}'::jsonb),
  ('SWITCH', 'default', 24, 1, 'ethernet', 'bidirectional', null, '{"hint":"Default switch profile"}'::jsonb),
  ('ROUTER', 'default', 8, 1, 'ethernet', 'bidirectional', null, '{"hint":"Default router profile"}'::jsonb)
on conflict (device_type_key, profile_name) do update
set
  total_ports = excluded.total_ports,
  start_port_index = excluded.start_port_index,
  default_port_type = excluded.default_port_type,
  default_direction = excluded.default_direction,
  default_core_capacity = excluded.default_core_capacity,
  metadata = excluded.metadata,
  is_active = true,
  updated_at = now();

-- Backfill core inventory from existing cable devices with capacity_core.
insert into public.fiber_cores (region_id, cable_device_id, core_no, status)
select
  d.region_id,
  d.id as cable_device_id,
  gs.core_no,
  'available'::text as status
from public.devices d
cross join lateral generate_series(1, coalesce(d.capacity_core, 0)) as gs(core_no)
where d.device_type_key = 'CABLE'
  and coalesce(d.capacity_core, 0) > 0
on conflict (cable_device_id, core_no) do nothing;
