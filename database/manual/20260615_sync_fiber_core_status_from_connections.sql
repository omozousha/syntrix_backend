-- Sync fiber core occupancy status from approved port_connections.
-- Safe to run more than once.
--
-- Context:
-- Syntrix is inventory-driven, not live monitoring. This script aligns
-- fiber_cores with approved topology inventory:
-- - active/cutover connections mark covered cores as used.
-- - planned connections mark available covered cores as reserved.
-- - used cores without active/cutover connection are released to available.
--
-- The script does not override damaged or inactive cores.

begin;

with active_connection_cores as (
  select
    pc.id as connection_id,
    pc.region_id,
    pc.cable_device_id,
    pc.from_port_id,
    pc.to_port_id,
    gs.core_no
  from public.port_connections pc
  cross join lateral generate_series(pc.core_start, pc.core_end) as gs(core_no)
  where pc.status in ('active', 'cutover')
    and pc.cable_device_id is not null
    and pc.core_start is not null
    and pc.core_end is not null
),
updated_used as (
  update public.fiber_cores fc
  set
    status = 'used',
    connection_id = acc.connection_id,
    from_port_id = acc.from_port_id,
    to_port_id = acc.to_port_id,
    updated_at = now()
  from active_connection_cores acc
  where fc.cable_device_id = acc.cable_device_id
    and fc.core_no = acc.core_no
    and fc.status not in ('damaged', 'inactive')
    and (
      fc.status <> 'used'
      or fc.connection_id is distinct from acc.connection_id
      or fc.from_port_id is distinct from acc.from_port_id
      or fc.to_port_id is distinct from acc.to_port_id
    )
  returning fc.id
),
planned_connection_cores as (
  select
    pc.id as connection_id,
    pc.cable_device_id,
    gs.core_no
  from public.port_connections pc
  cross join lateral generate_series(pc.core_start, pc.core_end) as gs(core_no)
  where pc.status = 'planned'
    and pc.cable_device_id is not null
    and pc.core_start is not null
    and pc.core_end is not null
),
updated_reserved as (
  update public.fiber_cores fc
  set
    status = 'reserved',
    connection_id = pcc.connection_id,
    updated_at = now()
  from planned_connection_cores pcc
  where fc.cable_device_id = pcc.cable_device_id
    and fc.core_no = pcc.core_no
    and fc.status = 'available'
  returning fc.id
),
released_available as (
  update public.fiber_cores fc
  set
    status = 'available',
    connection_id = null,
    from_port_id = null,
    to_port_id = null,
    updated_at = now()
  where fc.status = 'used'
    and not exists (
      select 1
      from public.port_connections pc
      where pc.id = fc.connection_id
        and pc.status in ('active', 'cutover')
        and pc.cable_device_id = fc.cable_device_id
        and fc.core_no between pc.core_start and pc.core_end
    )
  returning fc.id
)
select
  (select count(*)::int from updated_used) as marked_used_total,
  (select count(*)::int from updated_reserved) as marked_reserved_total,
  (select count(*)::int from released_available) as released_available_total;

-- Verification summary.
with active_connection_cores as (
  select
    pc.id as connection_id,
    pc.cable_device_id,
    pc.from_port_id,
    pc.to_port_id,
    gs.core_no
  from public.port_connections pc
  cross join lateral generate_series(pc.core_start, pc.core_end) as gs(core_no)
  where pc.status in ('active', 'cutover')
    and pc.cable_device_id is not null
    and pc.core_start is not null
    and pc.core_end is not null
)
select
  count(*) filter (
    where fc.id is null
  ) as active_connection_missing_fiber_core_total,
  count(*) filter (
    where fc.id is not null
      and (
        fc.status <> 'used'
        or fc.connection_id is distinct from acc.connection_id
        or fc.from_port_id is distinct from acc.from_port_id
        or fc.to_port_id is distinct from acc.to_port_id
      )
  ) as active_connection_core_status_mismatch_total,
  (
    select count(*)::int
    from public.fiber_cores fc2
    where fc2.status = 'used'
      and not exists (
        select 1
        from public.port_connections pc
        where pc.id = fc2.connection_id
          and pc.status in ('active', 'cutover')
          and pc.cable_device_id = fc2.cable_device_id
          and fc2.core_no between pc.core_start and pc.core_end
      )
  ) as used_core_without_active_connection_total
from active_connection_cores acc
left join public.fiber_cores fc
  on fc.cable_device_id = acc.cable_device_id
 and fc.core_no = acc.core_no;

commit;
