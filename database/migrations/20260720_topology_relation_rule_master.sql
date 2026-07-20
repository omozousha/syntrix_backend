-- Master Data Synchronization Slice 2
-- Topology Relation Rule Master

create table if not exists public.topology_relation_rules (
  id uuid primary key default gen_random_uuid(),
  source_device_type_key text not null,
  direction text not null check (direction in ('front', 'rear')),
  allowed_peer_device_type_key text not null,
  connection_role text,
  route_type text,
  requires_same_pop boolean not null default true,
  requires_same_project boolean not null default false,
  is_required_on_create boolean not null default false,
  is_active boolean not null default true,
  description text,
  sort_order integer not null default 0,
  deleted_at timestamptz,
  deleted_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint topology_relation_rules_unique_rule
    unique (source_device_type_key, direction, allowed_peer_device_type_key)
);

alter table public.topology_relation_rules
  drop constraint if exists topology_relation_rules_connection_role_check,
  add constraint topology_relation_rules_connection_role_check check (
    connection_role is null or connection_role in (
      'uplink',
      'feeder',
      'distribution',
      'branch',
      'drop',
      'physical_fiber'
    )
  );

create index if not exists idx_topology_relation_rules_source_direction
  on public.topology_relation_rules (source_device_type_key, direction)
  where deleted_at is null;

create index if not exists idx_topology_relation_rules_peer
  on public.topology_relation_rules (allowed_peer_device_type_key)
  where deleted_at is null;

drop trigger if exists trg_topology_relation_rules_updated_at on public.topology_relation_rules;
create trigger trg_topology_relation_rules_updated_at
before update on public.topology_relation_rules
for each row execute function public.set_current_timestamp_updated_at();

comment on table public.topology_relation_rules is 'Master rules controlling allowed topology front/rear relations between device types.';
comment on column public.topology_relation_rules.source_device_type_key is 'Source/current device type key.';
comment on column public.topology_relation_rules.allowed_peer_device_type_key is 'Allowed peer device type key.';
comment on column public.topology_relation_rules.connection_role is 'Semantic role of the connection: uplink, feeder, distribution, branch, drop, physical_fiber.';
comment on column public.topology_relation_rules.route_type is 'Optional route/cable role context.';
comment on column public.topology_relation_rules.requires_same_pop is 'Whether relation requires both devices to belong to the same POP.';
comment on column public.topology_relation_rules.requires_same_project is 'Whether relation requires both devices to belong to the same project.';
comment on column public.topology_relation_rules.is_required_on_create is 'Whether relation is mandatory in create flow.';

insert into public.topology_relation_rules (
  source_device_type_key,
  direction,
  allowed_peer_device_type_key,
  connection_role,
  route_type,
  requires_same_pop,
  requires_same_project,
  is_required_on_create,
  is_active,
  sort_order,
  description
)
values
  ('OTB', 'front', 'OLT', 'uplink', null, true, false, false, true, 10, 'OTB front may connect to OLT uplink'),
  ('OTB', 'front', 'SWITCH', 'uplink', null, true, false, false, true, 20, 'OTB front may connect to SWITCH uplink'),
  ('OTB', 'rear', 'ODC', 'feeder', 'distribution', true, false, false, true, 30, 'OTB rear may connect to ODC'),
  ('OTB', 'rear', 'JC', 'distribution', 'distribution', true, false, false, true, 40, 'OTB rear may connect to JC'),
  ('ODC', 'front', 'OTB', 'feeder', 'feeder', true, false, false, true, 50, 'ODC front may connect to OTB'),
  ('ODC', 'rear', 'ODP', 'distribution', 'distribution', true, false, false, true, 60, 'ODC rear may connect to ODP'),
  ('JC', 'front', 'OTB', 'distribution', 'distribution', true, false, false, true, 70, 'JC front may connect to OTB'),
  ('JC', 'front', 'ODC', 'distribution', 'distribution', true, false, false, true, 80, 'JC front may connect to ODC'),
  ('JC', 'front', 'JC', 'branch', 'distribution', true, false, false, true, 90, 'JC front may connect to another JC'),
  ('JC', 'rear', 'ODP', 'branch', 'distribution', true, false, false, true, 100, 'JC rear may connect to ODP'),
  ('JC', 'rear', 'JC', 'branch', 'distribution', true, false, false, true, 110, 'JC rear may connect to another JC'),
  ('JC', 'rear', 'HH', 'branch', 'distribution', true, false, false, true, 120, 'JC rear may connect to HH'),
  ('JC', 'rear', 'MH', 'branch', 'distribution', true, false, false, true, 130, 'JC rear may connect to MH'),
  ('ODP', 'front', 'ODC', 'distribution', 'distribution', true, false, false, true, 140, 'ODP front may connect to ODC'),
  ('ODP', 'front', 'JC', 'distribution', 'distribution', true, false, false, true, 150, 'ODP front may connect to JC'),
  ('ODP', 'rear', 'ONT', 'drop', 'drop', true, false, false, true, 160, 'ODP rear may connect to ONT'),
  ('CABLE', 'front', 'OTB', 'physical_fiber', null, true, false, false, true, 170, 'Cable front may connect to OTB'),
  ('CABLE', 'front', 'ODC', 'physical_fiber', null, true, false, false, true, 180, 'Cable front may connect to ODC'),
  ('CABLE', 'front', 'JC', 'physical_fiber', null, true, false, false, true, 190, 'Cable front may connect to JC'),
  ('CABLE', 'rear', 'ODC', 'physical_fiber', null, true, false, false, true, 200, 'Cable rear may connect to ODC'),
  ('CABLE', 'rear', 'ODP', 'physical_fiber', null, true, false, false, true, 210, 'Cable rear may connect to ODP'),
  ('CABLE', 'rear', 'JC', 'physical_fiber', null, true, false, false, true, 220, 'Cable rear may connect to JC'),
  ('CABLE', 'rear', 'HH', 'physical_fiber', null, true, false, false, true, 230, 'Cable rear may connect to HH'),
  ('CABLE', 'rear', 'MH', 'physical_fiber', null, true, false, false, true, 240, 'Cable rear may connect to MH')
on conflict (source_device_type_key, direction, allowed_peer_device_type_key) do update
set
  connection_role = excluded.connection_role,
  route_type = excluded.route_type,
  requires_same_pop = excluded.requires_same_pop,
  requires_same_project = excluded.requires_same_project,
  is_required_on_create = excluded.is_required_on_create,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  description = excluded.description,
  updated_at = now();
