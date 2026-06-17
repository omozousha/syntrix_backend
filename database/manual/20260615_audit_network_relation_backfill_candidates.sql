-- Audit candidates for the next network relation backfill phase.
-- Safe to run more than once.
--
-- This script is read-only. It does not update inventory data.
-- Use the result to decide which backfill can be automated safely and which
-- must remain a manual review task.

-- 1. Public QR readiness for non-POP devices.
-- A device is QR-ready when the public QR endpoint can identify it without
-- leaking private project data: id, type, name, and region are enough.
select
  count(*)::int as non_pop_device_total,
  count(*) filter (
    where d.id is null
      or d.device_type_key is null
      or nullif(trim(d.device_name), '') is null
      or d.region_id is null
  )::int as non_pop_device_not_qr_ready,
  jsonb_agg(
    jsonb_build_object(
      'id', d.id,
      'inventory_id', d.device_id,
      'device_name', d.device_name,
      'device_type_key', d.device_type_key,
      'region_id', d.region_id,
      'pop_id', d.pop_id
    )
    order by d.updated_at desc
  ) filter (
    where d.id is null
      or d.device_type_key is null
      or nullif(trim(d.device_name), '') is null
      or d.region_id is null
  ) as not_qr_ready_items
from public.devices d
where d.deleted_at is null;

-- 2. Devices without project relation.
-- Candidate project is suggested only when a device POP has exactly one active
-- or running project in the same region. Ambiguous POP/project relations must
-- stay manual.
with pop_project_candidates as (
  select
    p.region_id,
    p.pop_id,
    count(*) filter (where p.status in ('planning', 'running', 'done'))::int as candidate_count,
    (array_agg(p.id order by p.updated_at desc, p.created_at desc) filter (where p.status in ('planning', 'running', 'done')))[1] as candidate_project_id,
    (array_agg(p.project_id order by p.updated_at desc, p.created_at desc) filter (where p.status in ('planning', 'running', 'done')))[1] as candidate_project_code,
    (array_agg(p.project_name order by p.updated_at desc, p.created_at desc) filter (where p.status in ('planning', 'running', 'done')))[1] as candidate_project_name
  from public.projects p
  where p.pop_id is not null
  group by p.region_id, p.pop_id
),
devices_without_project as (
  select
    d.id,
    d.device_id,
    d.device_name,
    d.device_type_key,
    d.region_id,
    d.pop_id,
    ppc.candidate_count,
    ppc.candidate_project_id,
    ppc.candidate_project_code,
    ppc.candidate_project_name
  from public.devices d
  left join pop_project_candidates ppc
    on ppc.region_id = d.region_id
   and ppc.pop_id = d.pop_id
  where d.deleted_at is null
    and d.project_id is null
)
select
  count(*)::int as devices_without_project_total,
  count(*) filter (where candidate_count = 1)::int as auto_backfill_candidate_total,
  count(*) filter (where coalesce(candidate_count, 0) <> 1)::int as manual_review_total,
  jsonb_agg(
    jsonb_build_object(
      'id', id,
      'inventory_id', device_id,
      'device_name', device_name,
      'device_type_key', device_type_key,
      'region_id', region_id,
      'pop_id', pop_id,
      'candidate_count', coalesce(candidate_count, 0),
      'candidate_project_id', candidate_project_id,
      'candidate_project_code', candidate_project_code,
      'candidate_project_name', candidate_project_name
    )
    order by device_type_key, device_name
  ) filter (where candidate_count = 1) as auto_backfill_candidates
from devices_without_project;

-- 3. Legacy device_links that might become port_connections.
-- This reports links whose endpoints have active device_ports and no matching
-- port_connection between the same devices. The exact deterministic candidate
-- count follows the backfill rule: exactly one unconnected active port per endpoint.
with endpoint_ports as (
  select
    dp.device_id,
    count(*)::int as active_port_total,
    count(*) filter (
      where not exists (
        select 1
        from public.port_connections pc
        where pc.from_port_id = dp.id
           or pc.to_port_id = dp.id
      )
    )::int as unconnected_active_port_total
  from public.device_ports dp
  where dp.deleted_at is null
    and dp.is_active = true
  group by dp.device_id
),
link_candidates as (
  select
    dl.id,
    dl.link_id,
    dl.region_id,
    dl.from_device_id,
    from_device.device_id as from_inventory_id,
    from_device.device_name as from_device_name,
    dl.to_device_id,
    to_device.device_id as to_inventory_id,
    to_device.device_name as to_device_name,
    dl.route_id,
    dl.cable_device_id,
    dl.core_start,
    dl.core_end,
    dl.status,
    coalesce(from_ports.active_port_total, 0) as from_port_total,
    coalesce(to_ports.active_port_total, 0) as to_port_total,
    coalesce(from_ports.unconnected_active_port_total, 0) as from_unconnected_port_total,
    coalesce(to_ports.unconnected_active_port_total, 0) as to_unconnected_port_total
  from public.device_links dl
  join public.devices from_device on from_device.id = dl.from_device_id
  join public.devices to_device on to_device.id = dl.to_device_id
  left join endpoint_ports from_ports on from_ports.device_id = dl.from_device_id
  left join endpoint_ports to_ports on to_ports.device_id = dl.to_device_id
  where from_device.deleted_at is null
    and to_device.deleted_at is null
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
  count(*)::int as legacy_links_without_port_connection_total,
  count(*) filter (where from_unconnected_port_total = 1 and to_unconnected_port_total = 1)::int as deterministic_backfill_candidate_total,
  count(*) filter (where from_port_total > 0 and to_port_total > 0)::int as candidate_with_endpoint_ports_total,
  count(*) filter (where from_port_total = 0 or to_port_total = 0)::int as blocked_missing_endpoint_ports_total,
  count(*) filter (where from_unconnected_port_total <> 1 or to_unconnected_port_total <> 1)::int as manual_review_total,
  jsonb_agg(
    jsonb_build_object(
      'id', id,
      'link_id', link_id,
      'region_id', region_id,
      'from_device_id', from_device_id,
      'from_inventory_id', from_inventory_id,
      'from_device_name', from_device_name,
      'to_device_id', to_device_id,
      'to_inventory_id', to_inventory_id,
      'to_device_name', to_device_name,
      'route_id', route_id,
      'cable_device_id', cable_device_id,
      'core_start', core_start,
      'core_end', core_end,
      'status', status,
      'from_port_total', from_port_total,
      'to_port_total', to_port_total,
      'from_unconnected_port_total', from_unconnected_port_total,
      'to_unconnected_port_total', to_unconnected_port_total
    )
    order by link_id
  ) filter (where from_unconnected_port_total = 1 and to_unconnected_port_total = 1) as deterministic_link_candidates,
  jsonb_agg(
    jsonb_build_object(
      'id', id,
      'link_id', link_id,
      'region_id', region_id,
      'from_device_id', from_device_id,
      'from_inventory_id', from_inventory_id,
      'from_device_name', from_device_name,
      'to_device_id', to_device_id,
      'to_inventory_id', to_inventory_id,
      'to_device_name', to_device_name,
      'route_id', route_id,
      'cable_device_id', cable_device_id,
      'core_start', core_start,
      'core_end', core_end,
      'status', status,
      'from_port_total', from_port_total,
      'to_port_total', to_port_total,
      'from_unconnected_port_total', from_unconnected_port_total,
      'to_unconnected_port_total', to_unconnected_port_total
    )
    order by link_id
  ) filter (where from_unconnected_port_total <> 1 or to_unconnected_port_total <> 1) as manual_review_link_items
from link_candidates;

-- 4. Customer assignment candidates.
-- This is intentionally conservative. It only reports customers with exactly
-- one candidate device in the same region/pop and exactly one idle port across
-- the candidate set.
with candidate_devices as (
  select
    c.id as customer_id,
    c.customer_id as customer_inventory_id,
    c.customer_number,
    c.customer_name,
    d.id as device_id,
    d.device_id as device_inventory_id,
    d.device_name,
    d.device_type_key
  from public.customers c
  join public.devices d
    on d.region_id = c.region_id
   and d.pop_id is not distinct from c.pop_id
   and d.deleted_at is null
   and upper(coalesce(d.device_type_key, '')) in ('ODP', 'ONT')
  where c.status in ('active', 'prospect')
    and not exists (
      select 1
      from public.device_ports assigned
      where assigned.customer_id = c.id
        and assigned.deleted_at is null
    )
),
customer_candidate_counts as (
  select
    customer_id,
    count(distinct device_id)::int as matching_device_count
  from candidate_devices
  group by customer_id
),
customer_device_candidates as (
  select
    cd.customer_id,
    cd.customer_inventory_id,
    cd.customer_number,
    cd.customer_name,
    cd.device_id,
    cd.device_inventory_id,
    cd.device_name,
    cd.device_type_key,
    dp.id as port_id,
    dp.port_id as port_inventory_id,
    dp.port_index,
    ccc.matching_device_count,
    count(dp.id) over (partition by cd.customer_id) as idle_port_count
  from candidate_devices cd
  join customer_candidate_counts ccc
    on ccc.customer_id = cd.customer_id
  left join public.device_ports dp
    on dp.device_id = cd.device_id
   and dp.deleted_at is null
   and dp.is_active = true
   and dp.status = 'idle'
   and dp.customer_id is null
   and dp.ont_device_id is null
)
select
  count(distinct customer_id)::int as customer_without_port_candidate_total,
  count(distinct customer_id) filter (
    where matching_device_count = 1 and idle_port_count = 1
  )::int as auto_assignment_candidate_total,
  count(distinct customer_id) filter (
    where matching_device_count <> 1 or idle_port_count <> 1
  )::int as manual_review_total,
  jsonb_agg(
    jsonb_build_object(
      'customer_id', customer_id,
      'customer_inventory_id', customer_inventory_id,
      'customer_number', customer_number,
      'customer_name', customer_name,
      'device_id', device_id,
      'device_inventory_id', device_inventory_id,
      'device_name', device_name,
      'device_type_key', device_type_key,
      'port_id', port_id,
      'port_inventory_id', port_inventory_id,
      'port_index', port_index
    )
    order by customer_name
  ) filter (where matching_device_count = 1 and idle_port_count = 1) as auto_assignment_candidates,
  jsonb_agg(
    jsonb_build_object(
      'customer_id', customer_id,
      'customer_inventory_id', customer_inventory_id,
      'customer_number', customer_number,
      'customer_name', customer_name,
      'device_id', device_id,
      'device_inventory_id', device_inventory_id,
      'device_name', device_name,
      'device_type_key', device_type_key,
      'port_id', port_id,
      'port_inventory_id', port_inventory_id,
      'port_index', port_index,
      'matching_device_count', matching_device_count,
      'idle_port_count', idle_port_count
    )
    order by customer_name, device_name, port_index
  ) filter (where matching_device_count <> 1 or idle_port_count <> 1) as manual_review_items
from customer_device_candidates;
