-- Backfill deterministic legacy device_links into port_connections.
-- Safe to run more than once.
--
-- Rule:
-- A legacy device_link is migrated only when:
-- - both endpoint devices are active inventory rows in the same region,
-- - no port_connection already exists between those two devices,
-- - each endpoint device has exactly one active, non-deleted, unconnected port.
--
-- This script intentionally skips ambiguous endpoint-port choices.

begin;

create temp table tmp_device_link_connection_candidates on commit drop as
with eligible_ports as (
  select
    dp.id,
    dp.port_id,
    dp.region_id,
    dp.device_id,
    dp.port_index,
    dp.port_label
  from public.device_ports dp
  where dp.deleted_at is null
    and dp.is_active = true
    and not exists (
      select 1
      from public.port_connections pc
      where pc.from_port_id = dp.id
         or pc.to_port_id = dp.id
    )
),
single_endpoint_port as (
  select
    ep.device_id,
    count(*)::int as eligible_port_count,
    (array_agg(ep.id order by ep.port_index))[1] as port_id,
    (array_agg(ep.port_id order by ep.port_index))[1] as port_inventory_id,
    (array_agg(ep.port_index order by ep.port_index))[1] as port_index,
    (array_agg(ep.port_label order by ep.port_index))[1] as port_label
  from eligible_ports ep
  group by ep.device_id
),
legacy_candidates as (
  select
    dl.id as device_link_id,
    dl.link_id,
    dl.region_id,
    dl.from_device_id,
    from_device.device_id as from_inventory_id,
    from_device.device_name as from_device_name,
    dl.to_device_id,
    to_device.device_id as to_inventory_id,
    to_device.device_name as to_device_name,
    from_port.port_id as from_port_id,
    from_port.port_inventory_id as from_port_inventory_id,
    from_port.port_index as from_port_index,
    from_port.port_label as from_port_label,
    to_port.port_id as to_port_id,
    to_port.port_inventory_id as to_port_inventory_id,
    to_port.port_index as to_port_index,
    to_port.port_label as to_port_label,
    dl.route_id,
    dl.cable_device_id,
    dl.core_start,
    dl.core_end,
    dl.fiber_count,
    case
      when lower(coalesce(dl.link_type, 'fiber')) in ('fiber', 'patch', 'uplink', 'crossconnect', 'other') then lower(coalesce(dl.link_type, 'fiber'))
      else 'other'
    end as connection_type,
    case
      when lower(coalesce(dl.status, 'active')) = 'planning' then 'planned'
      when lower(coalesce(dl.status, 'active')) in ('active', 'planned', 'inactive', 'cutover') then lower(coalesce(dl.status, 'active'))
      else 'active'
    end as connection_status,
    from_port.eligible_port_count as from_eligible_port_count,
    to_port.eligible_port_count as to_eligible_port_count
  from public.device_links dl
  join public.devices from_device
    on from_device.id = dl.from_device_id
   and from_device.deleted_at is null
  join public.devices to_device
    on to_device.id = dl.to_device_id
   and to_device.deleted_at is null
  join single_endpoint_port from_port
    on from_port.device_id = dl.from_device_id
  join single_endpoint_port to_port
    on to_port.device_id = dl.to_device_id
  where from_device.region_id = dl.region_id
    and to_device.region_id = dl.region_id
    and from_port.eligible_port_count = 1
    and to_port.eligible_port_count = 1
    and not exists (
      select 1
      from public.port_connections pc
      join public.device_ports fp on fp.id = pc.from_port_id
      join public.device_ports tp on tp.id = pc.to_port_id
      where (
          fp.device_id = dl.from_device_id
          and tp.device_id = dl.to_device_id
        )
        or (
          fp.device_id = dl.to_device_id
          and tp.device_id = dl.from_device_id
        )
    )
)
select * from legacy_candidates;

-- Backup/review snapshot. Save this result before applying the insert.
select
  count(*)::int as deterministic_connection_candidate_total,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'device_link_id', device_link_id,
        'link_id', link_id,
        'region_id', region_id,
        'from_device_id', from_device_id,
        'from_inventory_id', from_inventory_id,
        'from_device_name', from_device_name,
        'from_port_id', from_port_id,
        'from_port_inventory_id', from_port_inventory_id,
        'from_port_index', from_port_index,
        'to_device_id', to_device_id,
        'to_inventory_id', to_inventory_id,
        'to_device_name', to_device_name,
        'to_port_id', to_port_id,
        'to_port_inventory_id', to_port_inventory_id,
        'to_port_index', to_port_index,
        'route_id', route_id,
        'cable_device_id', cable_device_id,
        'core_start', core_start,
        'core_end', core_end,
        'fiber_count', fiber_count,
        'connection_type', connection_type,
        'connection_status', connection_status
      )
      order by link_id
    ),
    '[]'::jsonb
  ) as backup_snapshot
from tmp_device_link_connection_candidates;

create temp table tmp_device_link_connection_inserted on commit drop as
with inserted as (
  insert into public.port_connections (
    region_id,
    from_port_id,
    to_port_id,
    connection_type,
    status,
    route_id,
    cable_device_id,
    core_start,
    core_end,
    fiber_count,
    notes
  )
  select
    region_id,
    from_port_id,
    to_port_id,
    connection_type,
    connection_status,
    route_id,
    cable_device_id,
    core_start,
    core_end,
    fiber_count,
    'Backfilled from legacy device_link ' || coalesce(link_id, device_link_id::text)
  from tmp_device_link_connection_candidates c
  where not exists (
    select 1
    from public.port_connections pc
    where (
        pc.from_port_id = c.from_port_id
        and pc.to_port_id = c.to_port_id
      )
      or (
        pc.from_port_id = c.to_port_id
        and pc.to_port_id = c.from_port_id
      )
  )
  returning
    id,
    connection_id,
    region_id,
    from_port_id,
    to_port_id,
    status,
    route_id,
    cable_device_id,
    core_start,
    core_end,
    fiber_count
)
select
  inserted.*,
  c.device_link_id,
  c.link_id,
  c.from_device_id,
  c.from_inventory_id,
  c.from_device_name,
  c.to_device_id,
  c.to_inventory_id,
  c.to_device_name
from inserted
join tmp_device_link_connection_candidates c
  on c.from_port_id = inserted.from_port_id
 and c.to_port_id = inserted.to_port_id;

-- Sync fiber core occupancy for the inserted connections only.
with inserted_connection_cores as (
  select
    pc.id as connection_id,
    pc.cable_device_id,
    pc.from_port_id,
    pc.to_port_id,
    pc.status,
    gs.core_no
  from tmp_device_link_connection_inserted pc
  cross join lateral generate_series(pc.core_start, pc.core_end) as gs(core_no)
  where pc.cable_device_id is not null
    and pc.core_start is not null
    and pc.core_end is not null
),
updated_used as (
  update public.fiber_cores fc
  set
    status = 'used',
    connection_id = icc.connection_id,
    from_port_id = icc.from_port_id,
    to_port_id = icc.to_port_id,
    updated_at = now()
  from inserted_connection_cores icc
  where fc.cable_device_id = icc.cable_device_id
    and fc.core_no = icc.core_no
    and icc.status in ('active', 'cutover')
    and fc.status in ('available', 'reserved')
    and fc.connection_id is null
    and fc.from_port_id is null
    and fc.to_port_id is null
  returning fc.id
),
updated_reserved as (
  update public.fiber_cores fc
  set
    status = 'reserved',
    connection_id = icc.connection_id,
    from_port_id = icc.from_port_id,
    to_port_id = icc.to_port_id,
    updated_at = now()
  from inserted_connection_cores icc
  where fc.cable_device_id = icc.cable_device_id
    and fc.core_no = icc.core_no
    and icc.status = 'planned'
    and fc.status = 'available'
  returning fc.id
)
select
  (select count(*)::int from updated_used) as synced_used_fiber_cores,
  (select count(*)::int from updated_reserved) as synced_reserved_fiber_cores;

select
  count(*)::int as inserted_connection_total,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'connection_id', connection_id,
        'device_link_id', device_link_id,
        'link_id', link_id,
        'from_inventory_id', from_inventory_id,
        'from_device_name', from_device_name,
        'to_inventory_id', to_inventory_id,
        'to_device_name', to_device_name,
        'status', status,
        'route_id', route_id,
        'cable_device_id', cable_device_id,
        'core_start', core_start,
        'core_end', core_end,
        'fiber_count', fiber_count
      )
      order by link_id
    ),
    '[]'::jsonb
  ) as inserted_items
from tmp_device_link_connection_inserted;

-- Rollback SQL for this run only. Copy only if manual rollback is required.
select
  case
    when count(*) = 0 then '-- No port_connections inserted in this run.'
    else 'update public.fiber_cores set status = ''available'', connection_id = null, from_port_id = null, to_port_id = null, updated_at = now() where connection_id in (' ||
      string_agg(quote_literal(id::text), ', ' order by link_id) ||
      ');' || chr(10) ||
      'delete from public.port_connections where id in (' ||
      string_agg(quote_literal(id::text), ', ' order by link_id) ||
      ');'
  end as rollback_inserted_connections_sql
from tmp_device_link_connection_inserted;

-- Verification summary.
with endpoint_ports as (
  select
    dp.device_id,
    count(*)::int as active_port_total
  from public.device_ports dp
  where dp.deleted_at is null
    and dp.is_active = true
  group by dp.device_id
),
remaining_links as (
  select
    dl.id,
    coalesce(from_ports.active_port_total, 0) as from_port_total,
    coalesce(to_ports.active_port_total, 0) as to_port_total
  from public.device_links dl
  join public.devices from_device on from_device.id = dl.from_device_id and from_device.deleted_at is null
  join public.devices to_device on to_device.id = dl.to_device_id and to_device.deleted_at is null
  left join endpoint_ports from_ports on from_ports.device_id = dl.from_device_id
  left join endpoint_ports to_ports on to_ports.device_id = dl.to_device_id
  where from_device.region_id = dl.region_id
    and to_device.region_id = dl.region_id
    and not exists (
      select 1
      from public.port_connections pc
      join public.device_ports fp on fp.id = pc.from_port_id
      join public.device_ports tp on tp.id = pc.to_port_id
      where (
          fp.device_id = dl.from_device_id
          and tp.device_id = dl.to_device_id
        )
        or (
          fp.device_id = dl.to_device_id
          and tp.device_id = dl.from_device_id
        )
    )
)
select
  count(*)::int as legacy_links_without_port_connection_remaining,
  count(*) filter (where from_port_total = 1 and to_port_total = 1)::int as deterministic_candidates_remaining,
  count(*) filter (where from_port_total <> 1 or to_port_total <> 1)::int as manual_review_remaining
from remaining_links;

commit;
