-- Device connectivity model for core/port level visibility.
-- Adds:
-- 1) region scope on device_links
-- 2) device_ports table
-- 3) port_connections table

create sequence if not exists public.device_port_hid_seq start 1;
create sequence if not exists public.port_connection_hid_seq start 1;

alter table if exists public.device_links
  add column if not exists region_id uuid;

update public.device_links dl
set region_id = coalesce(
  d_from.region_id,
  (
    select d_to.region_id
    from public.devices d_to
    where d_to.id = dl.to_device_id
    limit 1
  )
)
from public.devices d_from
where d_from.id = dl.from_device_id
  and dl.region_id is null;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'device_links'
      and column_name = 'region_id'
      and is_nullable = 'YES'
  ) then
    alter table public.device_links
      alter column region_id set not null;
  end if;
exception when others then
  -- Leave nullable if legacy records cannot be mapped yet.
  null;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'device_links_region_id_fkey'
  ) then
    alter table public.device_links
      add constraint device_links_region_id_fkey
      foreign key (region_id) references public.regions(id) on update cascade on delete restrict;
  end if;
end $$;

create table if not exists public.device_ports (
  id uuid primary key default gen_random_uuid(),
  port_id text unique default public.generate_prefixed_code('PRT', 'public.device_port_hid_seq'),
  region_id uuid not null references public.regions(id) on update cascade on delete restrict,
  device_id uuid not null references public.devices(id) on update cascade on delete cascade,
  port_index integer not null check (port_index > 0),
  port_label text,
  port_type text not null default 'ethernet' check (port_type in ('ethernet', 'pon', 'uplink', 'fiber', 'splitter', 'other')),
  direction text not null default 'bidirectional' check (direction in ('in', 'out', 'bidirectional')),
  status text not null default 'idle' check (status in ('idle', 'used', 'reserved', 'down', 'maintenance')),
  speed_profile text,
  core_capacity integer check (core_capacity is null or core_capacity >= 0),
  core_used integer check (core_used is null or core_used >= 0),
  splitter_ratio text,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, port_index),
  constraint chk_device_ports_core_usage check (core_capacity is null or core_used is null or core_used <= core_capacity)
);

drop trigger if exists trg_device_ports_updated_at on public.device_ports;
create trigger trg_device_ports_updated_at
before update on public.device_ports
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.port_connections (
  id uuid primary key default gen_random_uuid(),
  connection_id text unique default public.generate_prefixed_code('PCN', 'public.port_connection_hid_seq'),
  region_id uuid not null references public.regions(id) on update cascade on delete restrict,
  from_port_id uuid not null references public.device_ports(id) on update cascade on delete cascade,
  to_port_id uuid not null references public.device_ports(id) on update cascade on delete cascade,
  connection_type text not null default 'fiber' check (connection_type in ('fiber', 'patch', 'uplink', 'crossconnect', 'other')),
  status text not null default 'active' check (status in ('active', 'planned', 'inactive', 'cutover')),
  route_id uuid references public.network_routes(id) on update cascade on delete set null,
  cable_device_id uuid references public.devices(id) on update cascade on delete set null,
  core_start integer,
  core_end integer,
  fiber_count integer check (fiber_count is null or fiber_count >= 0),
  installed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_port_connections_not_same_port check (from_port_id <> to_port_id),
  constraint chk_port_connections_core_range check (
    (core_start is null and core_end is null)
    or (core_start is not null and core_end is not null and core_start > 0 and core_end >= core_start)
  )
);

drop trigger if exists trg_port_connections_updated_at on public.port_connections;
create trigger trg_port_connections_updated_at
before update on public.port_connections
for each row execute function public.set_current_timestamp_updated_at();

create index if not exists idx_device_links_region_id on public.device_links(region_id);
create index if not exists idx_device_links_from_to on public.device_links(from_device_id, to_device_id);
create index if not exists idx_device_ports_region_id on public.device_ports(region_id);
create index if not exists idx_device_ports_device_id on public.device_ports(device_id);
create index if not exists idx_port_connections_region_id on public.port_connections(region_id);
create index if not exists idx_port_connections_from_to on public.port_connections(from_port_id, to_port_id);
