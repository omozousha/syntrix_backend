-- Review helper for the device port and fiber core capacity backfill.
-- Safe to run more than once.
--
-- IMPORTANT:
-- This script does not delete or update production data.
-- It only produces:
-- 1. rollback-safe candidate counts,
-- 2. JSON backup snapshots for review,
-- 3. generated DELETE statements that can be copied only after manual review.
--
-- Because the original backfill did not write a batch marker, this helper is
-- intentionally conservative. It only considers rows that are still idle or
-- available and have no customer, ONT, connection, splice, or attenuation data.

begin;

create temp table tmp_backfill_safe_device_ports on commit drop as
with template_ports as (
  select
    d.id as device_id,
    d.device_id as inventory_id,
    d.device_name,
    d.device_type_key,
    dpt.start_port_index,
    case
      when d.total_ports is not null and d.total_ports > 0 then d.total_ports
      else dpt.total_ports
    end as desired_total_ports
  from public.devices d
  join public.device_port_templates dpt
    on dpt.device_type_key = d.device_type_key
   and dpt.profile_name = 'default'
   and dpt.is_active = true
  where d.deleted_at is null
)
select
  dp.id,
  dp.port_id,
  dp.device_id,
  tp.inventory_id,
  tp.device_name,
  tp.device_type_key,
  dp.port_index,
  dp.port_label,
  dp.port_type,
  dp.direction,
  dp.status,
  dp.created_at,
  dp.updated_at
from public.device_ports dp
join template_ports tp
  on tp.device_id = dp.device_id
 and dp.port_index between tp.start_port_index and (tp.start_port_index + tp.desired_total_ports - 1)
where dp.deleted_at is null
  and dp.status = 'idle'
  and dp.customer_id is null
  and dp.ont_device_id is null
  and coalesce(dp.core_used, 0) = 0
  and dp.occupied_at is null
  and dp.notes is null
  and not exists (
    select 1
    from public.port_connections pc
    where pc.from_port_id = dp.id
       or pc.to_port_id = dp.id
  )
  and not exists (
    select 1
    from public.fiber_cores fc
    where fc.from_port_id = dp.id
       or fc.to_port_id = dp.id
  );

create temp table tmp_backfill_safe_fiber_cores on commit drop as
select
  fc.id,
  fc.core_id,
  fc.cable_device_id,
  d.device_id as cable_inventory_id,
  d.device_name as cable_name,
  fc.core_no,
  fc.status,
  fc.color_name,
  fc.tube_no,
  fc.tube_color_name,
  fc.created_at,
  fc.updated_at
from public.fiber_cores fc
join public.devices d
  on d.id = fc.cable_device_id
where d.deleted_at is null
  and upper(coalesce(d.device_type_key, '')) = 'CABLE'
  and coalesce(d.capacity_core, 0) > 0
  and fc.core_no between 1 and d.capacity_core
  and fc.status = 'available'
  and fc.connection_id is null
  and fc.from_port_id is null
  and fc.to_port_id is null
  and fc.splice_label is null
  and fc.notes is null
  and fc.last_loss_db is null
  and fc.last_loss_measured_at is null
  and fc.last_loss_method is null;

-- Summary: review these counts first.
select
  (select count(*)::int from tmp_backfill_safe_device_ports) as rollback_safe_device_ports,
  (select count(*)::int from tmp_backfill_safe_fiber_cores) as rollback_safe_fiber_cores,
  (
    select count(*)::int
    from public.device_ports dp
    where dp.deleted_at is null
      and not exists (select 1 from tmp_backfill_safe_device_ports safe where safe.id = dp.id)
      and (
        dp.status <> 'idle'
        or dp.customer_id is not null
        or dp.ont_device_id is not null
        or exists (
          select 1
          from public.port_connections pc
          where pc.from_port_id = dp.id
             or pc.to_port_id = dp.id
        )
      )
  ) as protected_device_ports,
  (
    select count(*)::int
    from public.fiber_cores fc
    where not exists (select 1 from tmp_backfill_safe_fiber_cores safe where safe.id = fc.id)
      and (
        fc.status <> 'available'
        or fc.connection_id is not null
        or fc.from_port_id is not null
        or fc.to_port_id is not null
        or fc.last_loss_db is not null
      )
  ) as protected_fiber_cores;

-- Backup snapshot: save this result outside the SQL editor before rollback.
select
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'port_id', port_id,
        'device_id', device_id,
        'inventory_id', inventory_id,
        'device_name', device_name,
        'device_type_key', device_type_key,
        'port_index', port_index,
        'port_label', port_label,
        'port_type', port_type,
        'direction', direction,
        'status', status,
        'created_at', created_at,
        'updated_at', updated_at
      )
      order by inventory_id, port_index
    ),
    '[]'::jsonb
  ) as device_ports_backup_snapshot
from tmp_backfill_safe_device_ports;

select
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'core_id', core_id,
        'cable_device_id', cable_device_id,
        'cable_inventory_id', cable_inventory_id,
        'cable_name', cable_name,
        'core_no', core_no,
        'status', status,
        'color_name', color_name,
        'tube_no', tube_no,
        'tube_color_name', tube_color_name,
        'created_at', created_at,
        'updated_at', updated_at
      )
      order by cable_inventory_id, core_no
    ),
    '[]'::jsonb
  ) as fiber_cores_backup_snapshot
from tmp_backfill_safe_fiber_cores;

-- Generated rollback SQL: copy and run only after reviewing the snapshots.
select
  case
    when count(*) = 0 then '-- No rollback-safe device_ports candidates.'
    else 'delete from public.device_ports where id in (' ||
      string_agg(quote_literal(id::text), ', ' order by inventory_id, port_index) ||
      ');'
  end as rollback_device_ports_sql
from tmp_backfill_safe_device_ports;

select
  case
    when count(*) = 0 then '-- No rollback-safe fiber_cores candidates.'
    else 'delete from public.fiber_cores where id in (' ||
      string_agg(quote_literal(id::text), ', ' order by cable_inventory_id, core_no) ||
      ');'
  end as rollback_fiber_cores_sql
from tmp_backfill_safe_fiber_cores;

commit;
