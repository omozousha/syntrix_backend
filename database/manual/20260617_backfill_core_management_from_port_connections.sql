-- Backfill core_management summaries from approved port_connections.
-- Safe to run more than once.
--
-- Rule:
-- A core_management row is created only for a port_connection that already has
-- cable_device_id, core_start, and core_end. The row is a summary/read model
-- for topology/core management; port_connections and fiber_cores remain the
-- source of truth.

begin;

create temp table tmp_core_management_backfill_candidates on commit drop as
with connection_core_summary as (
  select
    pc.id as port_connection_id,
    pc.connection_id,
    pc.region_id,
    pc.route_id,
    pc.cable_device_id,
    pc.core_start,
    pc.core_end,
    pc.status as connection_status,
    pc.from_port_id,
    pc.to_port_id,
    from_port.device_id as from_device_id,
    to_port.device_id as to_device_id,
    route.project_id as route_project_id,
    route.pop_id as route_pop_id,
    cable.project_id as cable_project_id,
    cable.pop_id as cable_pop_id,
    from_device.project_id as from_project_id,
    from_device.pop_id as from_pop_id,
    to_device.project_id as to_project_id,
    to_device.pop_id as to_pop_id,
    count(fc.id)::int as actual_core_rows,
    count(fc.id) filter (where fc.status = 'used')::int as actual_used_count,
    count(fc.id) filter (where fc.status = 'reserved')::int as actual_reserved_count
  from public.port_connections pc
  join public.device_ports from_port on from_port.id = pc.from_port_id
  join public.device_ports to_port on to_port.id = pc.to_port_id
  join public.devices from_device on from_device.id = from_port.device_id and from_device.deleted_at is null
  join public.devices to_device on to_device.id = to_port.device_id and to_device.deleted_at is null
  join public.devices cable on cable.id = pc.cable_device_id and cable.deleted_at is null
  left join public.network_routes route on route.id = pc.route_id
  left join public.fiber_cores fc
    on fc.cable_device_id = pc.cable_device_id
   and fc.core_no between pc.core_start and pc.core_end
  where pc.cable_device_id is not null
    and pc.core_start is not null
    and pc.core_end is not null
    and pc.core_end >= pc.core_start
  group by
    pc.id,
    pc.connection_id,
    pc.region_id,
    pc.route_id,
    pc.cable_device_id,
    pc.core_start,
    pc.core_end,
    pc.status,
    pc.from_port_id,
    pc.to_port_id,
    from_port.device_id,
    to_port.device_id,
    route.project_id,
    route.pop_id,
    cable.project_id,
    cable.pop_id,
    from_device.project_id,
    from_device.pop_id,
    to_device.project_id,
    to_device.pop_id
),
normalized as (
  select
    ccs.*,
    (ccs.core_end - ccs.core_start + 1)::int as core_count,
    coalesce(ccs.route_project_id, ccs.cable_project_id, ccs.from_project_id, ccs.to_project_id) as project_id,
    coalesce(ccs.route_pop_id, ccs.cable_pop_id, ccs.from_pop_id, ccs.to_pop_id) as pop_id,
    case
      when ccs.actual_core_rows > 0 then ccs.actual_used_count
      when ccs.connection_status in ('active', 'cutover') then (ccs.core_end - ccs.core_start + 1)::int
      else 0
    end as used_count,
    case
      when ccs.actual_core_rows > 0 then ccs.actual_reserved_count
      when ccs.connection_status = 'planned' then (ccs.core_end - ccs.core_start + 1)::int
      else 0
    end as reserved_count
  from connection_core_summary ccs
)
select
  n.*,
  case
    when n.connection_status = 'inactive' then 'maintenance'
    when n.reserved_count >= n.core_count and n.core_count > 0 then 'reserved'
    when n.used_count >= n.core_count and n.core_count > 0 then 'full'
    when (n.used_count + n.reserved_count) > 0 then 'partial'
    else 'available'
  end as core_status,
  jsonb_build_object(
    'source', 'port_connection_backfill',
    'port_connection_id', n.port_connection_id,
    'connection_id', n.connection_id,
    'from_port_id', n.from_port_id,
    'to_port_id', n.to_port_id,
    'actual_core_rows', n.actual_core_rows,
    'connection_status', n.connection_status
  ) as splice_info
from normalized n
where not exists (
  select 1
  from public.core_management cm
  where cm.cable_device_id = n.cable_device_id
    and cm.route_id is not distinct from n.route_id
    and cm.from_device_id is not distinct from n.from_device_id
    and cm.to_device_id is not distinct from n.to_device_id
    and cm.core_no_start = n.core_start
    and cm.core_no_end = n.core_end
);

-- Backup/review snapshot. Save this result before applying the insert.
select
  count(*)::int as core_management_candidate_total,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'port_connection_id', port_connection_id,
        'connection_id', connection_id,
        'region_id', region_id,
        'route_id', route_id,
        'project_id', project_id,
        'pop_id', pop_id,
        'cable_device_id', cable_device_id,
        'from_device_id', from_device_id,
        'to_device_id', to_device_id,
        'core_no_start', core_start,
        'core_no_end', core_end,
        'core_count', core_count,
        'used_count', used_count,
        'reserved_count', reserved_count,
        'status', core_status
      )
      order by connection_id
    ),
    '[]'::jsonb
  ) as backup_snapshot
from tmp_core_management_backfill_candidates;

create temp table tmp_core_management_backfill_inserted on commit drop as
with inserted as (
  insert into public.core_management (
    cable_device_id,
    route_id,
    project_id,
    region_id,
    pop_id,
    from_device_id,
    to_device_id,
    core_no_start,
    core_no_end,
    core_count,
    used_count,
    reserved_count,
    status,
    splice_info,
    notes,
    tags
  )
  select
    cable_device_id,
    route_id,
    project_id,
    region_id,
    pop_id,
    from_device_id,
    to_device_id,
    core_start,
    core_end,
    core_count,
    used_count,
    reserved_count,
    core_status,
    splice_info,
    'Backfilled from port_connection ' || coalesce(connection_id, port_connection_id::text),
    array['backfill', 'port_connection']::text[]
  from tmp_core_management_backfill_candidates
  returning
    id,
    core_id,
    core_code,
    cable_device_id,
    route_id,
    project_id,
    region_id,
    pop_id,
    from_device_id,
    to_device_id,
    core_no_start,
    core_no_end,
    core_count,
    used_count,
    reserved_count,
    status,
    splice_info
)
select * from inserted;

select
  count(*)::int as inserted_core_management_total,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'core_id', core_id,
        'core_code', core_code,
        'cable_device_id', cable_device_id,
        'route_id', route_id,
        'project_id', project_id,
        'region_id', region_id,
        'pop_id', pop_id,
        'from_device_id', from_device_id,
        'to_device_id', to_device_id,
        'core_no_start', core_no_start,
        'core_no_end', core_no_end,
        'core_count', core_count,
        'used_count', used_count,
        'reserved_count', reserved_count,
        'status', status,
        'port_connection_id', splice_info ->> 'port_connection_id'
      )
      order by core_code
    ),
    '[]'::jsonb
  ) as inserted_items
from tmp_core_management_backfill_inserted;

-- Rollback SQL for this run only. Copy only if manual rollback is required.
select
  case
    when count(*) = 0 then '-- No core_management rows inserted in this run.'
    else 'delete from public.core_management where id in (' ||
      string_agg(quote_literal(id::text), ', ' order by core_code) ||
      ');'
  end as rollback_inserted_core_management_sql
from tmp_core_management_backfill_inserted;

-- Verification summary.
with eligible_connections as (
  select
    pc.id,
    pc.route_id,
    pc.cable_device_id,
    from_port.device_id as from_device_id,
    to_port.device_id as to_device_id,
    pc.core_start,
    pc.core_end
  from public.port_connections pc
  join public.device_ports from_port on from_port.id = pc.from_port_id
  join public.device_ports to_port on to_port.id = pc.to_port_id
  where pc.cable_device_id is not null
    and pc.core_start is not null
    and pc.core_end is not null
    and pc.core_end >= pc.core_start
)
select
  count(*) filter (
    where not exists (
      select 1
      from public.core_management cm
      where cm.cable_device_id = ec.cable_device_id
        and cm.route_id is not distinct from ec.route_id
        and cm.from_device_id is not distinct from ec.from_device_id
        and cm.to_device_id is not distinct from ec.to_device_id
        and cm.core_no_start = ec.core_start
        and cm.core_no_end = ec.core_end
    )
  )::int as eligible_connections_without_core_management_remaining,
  count(*)::int as eligible_connection_total
from eligible_connections ec;

commit;
