-- Stage 4 foundation:
-- 1) Transition mapping between legacy device_links and actual port_connections
-- 2) Indexes to support integrity checks

create table if not exists public.device_link_transition_map (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null unique references public.device_links(id) on update cascade on delete cascade,
  connection_id uuid not null references public.port_connections(id) on update cascade on delete cascade,
  migration_mode text not null default 'auto'
    check (migration_mode in ('auto', 'manual', 'rollback')),
  migration_notes text,
  migrated_by_user_id uuid references public.app_users(id) on update cascade on delete set null,
  migrated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_device_link_transition_map_updated_at on public.device_link_transition_map;
create trigger trg_device_link_transition_map_updated_at
before update on public.device_link_transition_map
for each row execute function public.set_current_timestamp_updated_at();

create index if not exists idx_device_link_transition_map_connection_id
  on public.device_link_transition_map(connection_id);
create index if not exists idx_device_link_transition_map_migrated_at
  on public.device_link_transition_map(migrated_at desc);

-- Helps overlap integrity checks by cable and core range.
create index if not exists idx_port_connections_cable_core_range
  on public.port_connections(cable_device_id, core_start, core_end)
  where cable_device_id is not null and core_start is not null and core_end is not null;

