-- Backfill deterministic customer assignment to device_ports.
-- Safe to run more than once.
--
-- Rule:
-- A customer is assigned to a port only when:
-- - the customer is active/prospect and has no existing active port assignment,
-- - exactly one ODP/ONT device exists in the same region/POP candidate scope,
-- - exactly one active, non-deleted, idle, unassigned port exists across that candidate scope.
--
-- This script intentionally skips ambiguous customer/device/port choices.

begin;

create temp table tmp_customer_port_assignment_candidates on commit drop as
with candidate_devices as (
  select
    c.id as customer_id,
    c.customer_id as customer_inventory_id,
    c.customer_number,
    c.customer_name,
    c.region_id,
    c.pop_id,
    c.project_id,
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
candidate_ports as (
  select
    cd.customer_id,
    cd.customer_inventory_id,
    cd.customer_number,
    cd.customer_name,
    cd.region_id,
    cd.pop_id,
    cd.project_id,
    cd.device_id,
    cd.device_inventory_id,
    cd.device_name,
    cd.device_type_key,
    dp.id as port_id,
    dp.port_id as port_inventory_id,
    dp.port_index,
    dp.port_label,
    ccc.matching_device_count,
    count(dp.id) over (partition by cd.customer_id) as idle_port_count
  from candidate_devices cd
  join customer_candidate_counts ccc
    on ccc.customer_id = cd.customer_id
  join public.device_ports dp
    on dp.device_id = cd.device_id
   and dp.region_id = cd.region_id
   and dp.deleted_at is null
   and dp.is_active = true
   and dp.status = 'idle'
   and dp.customer_id is null
   and dp.ont_device_id is null
   and dp.occupied_at is null
)
select *
from candidate_ports
where matching_device_count = 1
  and idle_port_count = 1;

-- Backup/review snapshot. Save this result before applying the update.
select
  count(*)::int as deterministic_assignment_candidate_total,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'customer_id', customer_id,
        'customer_inventory_id', customer_inventory_id,
        'customer_number', customer_number,
        'customer_name', customer_name,
        'region_id', region_id,
        'pop_id', pop_id,
        'project_id', project_id,
        'device_id', device_id,
        'device_inventory_id', device_inventory_id,
        'device_name', device_name,
        'device_type_key', device_type_key,
        'port_id', port_id,
        'port_inventory_id', port_inventory_id,
        'port_index', port_index,
        'port_label', port_label
      )
      order by customer_name, device_name, port_index
    ),
    '[]'::jsonb
  ) as backup_snapshot
from tmp_customer_port_assignment_candidates;

create temp table tmp_customer_port_assignment_updated on commit drop as
with updated_ports as (
  update public.device_ports dp
  set
    customer_id = c.customer_id,
    status = 'used',
    occupied_at = coalesce(dp.occupied_at, current_date),
    notes = case
      when nullif(trim(coalesce(dp.notes, '')), '') is null then
        'Backfilled customer assignment ' || coalesce(c.customer_inventory_id, c.customer_id::text)
      when dp.notes like '%Backfilled customer assignment%' then dp.notes
      else dp.notes || E'\nBackfilled customer assignment ' || coalesce(c.customer_inventory_id, c.customer_id::text)
    end,
    updated_at = now()
  from tmp_customer_port_assignment_candidates c
  where dp.id = c.port_id
    and dp.deleted_at is null
    and dp.is_active = true
    and dp.status = 'idle'
    and dp.customer_id is null
    and dp.ont_device_id is null
    and dp.occupied_at is null
  returning
    dp.id as port_id,
    dp.port_id as port_inventory_id,
    dp.device_id,
    dp.port_index,
    dp.port_label,
    dp.customer_id,
    dp.status
)
select
  up.port_id,
  up.port_inventory_id,
  up.device_id,
  c.device_inventory_id,
  c.device_name,
  c.device_type_key,
  up.port_index,
  up.port_label,
  up.customer_id,
  c.customer_inventory_id,
  c.customer_number,
  c.customer_name,
  up.status
from updated_ports up
join tmp_customer_port_assignment_candidates c
  on c.port_id = up.port_id;

with port_usage as (
  select
    d.id as device_id,
    count(dp.id) filter (
      where dp.deleted_at is null
        and (
          dp.status = 'used'
          or dp.customer_id is not null
          or dp.ont_device_id is not null
        )
    )::int as used_ports
  from public.devices d
  join tmp_customer_port_assignment_updated changed
    on changed.device_id = d.id
  left join public.device_ports dp
    on dp.device_id = d.id
  group by d.id
)
update public.devices d
set
  used_ports = port_usage.used_ports,
  updated_at = now()
from port_usage
where d.id = port_usage.device_id
  and d.used_ports is distinct from port_usage.used_ports;

select
  count(*)::int as updated_customer_port_assignment_total,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'port_id', port_id,
        'port_inventory_id', port_inventory_id,
        'device_id', device_id,
        'device_inventory_id', device_inventory_id,
        'device_name', device_name,
        'device_type_key', device_type_key,
        'port_index', port_index,
        'port_label', port_label,
        'customer_id', customer_id,
        'customer_inventory_id', customer_inventory_id,
        'customer_number', customer_number,
        'customer_name', customer_name,
        'status', status
      )
      order by customer_name, device_name, port_index
    ),
    '[]'::jsonb
  ) as updated_items
from tmp_customer_port_assignment_updated;

-- Rollback SQL for this run only. Copy only if manual rollback is required.
select
  case
    when count(*) = 0 then '-- No customer port assignment updated in this run.'
    else 'update public.device_ports set customer_id = null, status = ''idle'', occupied_at = null, updated_at = now() where id in (' ||
      string_agg(quote_literal(port_id::text), ', ' order by customer_name, device_name, port_index) ||
      ') and customer_id in (' ||
      string_agg(distinct quote_literal(customer_id::text), ', ') ||
      ');' || chr(10) ||
      'with affected_devices as (select distinct device_id from public.device_ports where id in (' ||
      string_agg(quote_literal(port_id::text), ', ' order by customer_name, device_name, port_index) ||
      ')), port_usage as (select ad.device_id, count(dp.id) filter (where dp.deleted_at is null and (dp.status = ''used'' or dp.customer_id is not null or dp.ont_device_id is not null))::int as used_ports from affected_devices ad left join public.device_ports dp on dp.device_id = ad.device_id group by ad.device_id) update public.devices d set used_ports = port_usage.used_ports, updated_at = now() from port_usage where d.id = port_usage.device_id;'
  end as rollback_updated_customer_port_assignments_sql
from tmp_customer_port_assignment_updated;

-- Verification summary.
with candidate_devices as (
  select
    c.id as customer_id,
    d.id as device_id
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
remaining_candidates as (
  select
    cd.customer_id,
    ccc.matching_device_count,
    count(dp.id) as idle_port_count
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
   and dp.occupied_at is null
  group by cd.customer_id, ccc.matching_device_count
)
select
  count(distinct customer_id)::int as customers_without_port_assignment_remaining,
  count(distinct customer_id) filter (
    where matching_device_count = 1 and idle_port_count = 1
  )::int as deterministic_candidates_remaining,
  count(distinct customer_id) filter (
    where matching_device_count <> 1 or idle_port_count <> 1
  )::int as manual_review_remaining
from remaining_candidates;

commit;
