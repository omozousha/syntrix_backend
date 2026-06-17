-- Backfill device ports and cable fiber cores from approved device capacity.
-- Safe to run more than once.
--
-- Context:
-- Future create/update flows now provision device_ports and fiber_cores
-- automatically. This script catches up existing inventory data that already
-- has approved capacity but does not yet have the derived topology rows.
--
-- Safety rules:
-- - Inserts missing rows only.
-- - Does not delete, shrink, or overwrite used/reserved/connected rows.
-- - Leaves attenuation values null unless a real measurement exists.

begin;

with desired_device_ports as (
  select
    d.id as device_id,
    d.region_id,
    d.device_type_key,
    d.splitter_ratio,
    dpt.id as template_id,
    dpt.profile_name,
    dpt.default_port_type,
    dpt.default_direction,
    dpt.default_speed_profile,
    dpt.default_core_capacity,
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
    and d.region_id is not null
),
port_rows as (
  select
    ddp.region_id,
    ddp.device_id,
    ddp.start_port_index + gs.offset_no as port_index,
    '#' || (ddp.start_port_index + gs.offset_no)::text as port_label,
    coalesce(ddp.default_port_type, 'fiber') as port_type,
    coalesce(ddp.default_direction, 'bidirectional') as direction,
    'idle'::text as status,
    ddp.default_speed_profile as speed_profile,
    ddp.default_core_capacity as core_capacity,
    0 as core_used,
    case
      when upper(coalesce(ddp.device_type_key, '')) = 'ODP' then ddp.splitter_ratio
      else null
    end as splitter_ratio,
    true as is_active
  from desired_device_ports ddp
  cross join lateral generate_series(0, greatest(ddp.desired_total_ports, 0) - 1) as gs(offset_no)
  where ddp.desired_total_ports > 0
),
inserted_ports as (
  insert into public.device_ports (
    region_id,
    device_id,
    port_index,
    port_label,
    port_type,
    direction,
    status,
    speed_profile,
    core_capacity,
    core_used,
    splitter_ratio,
    is_active
  )
  select
    region_id,
    device_id,
    port_index,
    port_label,
    port_type,
    direction,
    status,
    speed_profile,
    core_capacity,
    core_used,
    splitter_ratio,
    is_active
  from port_rows
  on conflict (device_id, port_index) do nothing
  returning id, device_id
),
port_usage as (
  select
    d.id as device_id,
    count(dp.id)::int as total_ports,
    count(dp.id) filter (
      where dp.status = 'used'
        or dp.customer_id is not null
        or dp.ont_device_id is not null
    )::int as used_ports
  from public.devices d
  left join public.device_ports dp
    on dp.device_id = d.id
   and dp.deleted_at is null
  where d.deleted_at is null
  group by d.id
),
updated_device_usage as (
  update public.devices d
  set
    total_ports = pu.total_ports,
    used_ports = pu.used_ports,
    updated_at = now()
  from port_usage pu
  where d.id = pu.device_id
    and (
      d.total_ports is distinct from pu.total_ports
      or d.used_ports is distinct from pu.used_ports
    )
  returning d.id
),
profile as (
  select id
  from public.core_color_profiles
  where profile_name = 'ITU-T 12 Color'
  limit 1
),
cable_core_rows as (
  select
    d.region_id,
    d.id as cable_device_id,
    gs.core_no,
    12 as cores_per_tube,
    profile.id as color_profile_id,
    core_color.color_name as color_name,
    core_color.color_hex as color_hex,
    (floor((gs.core_no - 1)::numeric / 12)::integer + 1) as tube_no,
    tube_color.color_name as tube_color_name,
    tube_color.color_hex as tube_color_hex
  from public.devices d
  cross join profile
  cross join lateral generate_series(1, greatest(coalesce(d.capacity_core, 0), 0)) as gs(core_no)
  left join public.core_color_map core_color
    on core_color.profile_id = profile.id
   and core_color.core_no = (((gs.core_no - 1) % 12) + 1)
  left join public.core_color_map tube_color
    on tube_color.profile_id = profile.id
   and tube_color.core_no = ((((floor((gs.core_no - 1)::numeric / 12)::integer + 1) - 1) % 12) + 1)
  where upper(coalesce(d.device_type_key, '')) = 'CABLE'
    and d.deleted_at is null
    and coalesce(d.capacity_core, 0) > 0
),
inserted_fiber_cores as (
  insert into public.fiber_cores (
    region_id,
    cable_device_id,
    core_no,
    status,
    color_profile_id,
    color_name,
    color_hex,
    color_standard,
    cores_per_tube,
    tube_no,
    tube_color_name,
    tube_color_hex,
    last_loss_db,
    last_loss_measured_at,
    last_loss_method
  )
  select
    region_id,
    cable_device_id,
    core_no,
    'available'::text,
    color_profile_id,
    color_name,
    color_hex,
    'TIA_EIA_598_12_COLOR'::text,
    cores_per_tube,
    tube_no,
    tube_color_name,
    tube_color_hex,
    null::numeric,
    null::timestamptz,
    null::text
  from cable_core_rows
  on conflict (cable_device_id, core_no) do nothing
  returning id, cable_device_id
),
repair_fiber_core_colors as (
  update public.fiber_cores fc
  set
    color_profile_id = coalesce(fc.color_profile_id, ccr.color_profile_id),
    color_name = coalesce(fc.color_name, ccr.color_name),
    color_hex = coalesce(fc.color_hex, ccr.color_hex),
    color_standard = coalesce(nullif(fc.color_standard, ''), 'TIA_EIA_598_12_COLOR'),
    cores_per_tube = coalesce(fc.cores_per_tube, ccr.cores_per_tube),
    tube_no = coalesce(fc.tube_no, ccr.tube_no),
    tube_color_name = coalesce(fc.tube_color_name, ccr.tube_color_name),
    tube_color_hex = coalesce(fc.tube_color_hex, ccr.tube_color_hex),
    updated_at = now()
  from cable_core_rows ccr
  where fc.cable_device_id = ccr.cable_device_id
    and fc.core_no = ccr.core_no
    and (
      fc.color_profile_id is null
      or fc.color_name is null
      or fc.color_hex is null
      or fc.color_standard is null
      or fc.tube_no is null
      or fc.tube_color_name is null
      or fc.tube_color_hex is null
    )
  returning fc.id
)
select
  (select count(*)::int from inserted_ports) as inserted_device_ports,
  (select count(*)::int from updated_device_usage) as updated_device_usage,
  (select count(*)::int from inserted_fiber_cores) as inserted_fiber_cores,
  (select count(*)::int from repair_fiber_core_colors) as repaired_fiber_core_colors;

-- Verification summary.
with active_port_count as (
  select device_id, count(*)::int as actual_ports
  from public.device_ports
  where deleted_at is null
  group by device_id
),
cable_core_count as (
  select cable_device_id, count(*)::int as actual_cores
  from public.fiber_cores
  group by cable_device_id
)
select
  count(*) filter (
    where d.total_ports is not null
      and d.total_ports > 0
      and coalesce(apc.actual_ports, 0) = 0
  ) as devices_with_capacity_without_ports,
  count(*) filter (
    where upper(coalesce(d.device_type_key, '')) = 'CABLE'
      and coalesce(d.capacity_core, 0) > 0
      and coalesce(ccc.actual_cores, 0) = 0
  ) as cables_with_capacity_without_fiber_cores,
  count(*) filter (
    where upper(coalesce(d.device_type_key, '')) = 'CABLE'
      and coalesce(d.capacity_core, 0) > 0
      and coalesce(ccc.actual_cores, 0) <> d.capacity_core
  ) as cables_with_core_count_mismatch,
  (
    select count(*)::int
    from public.fiber_cores fc
    where fc.last_loss_db = 0
      and fc.last_loss_measured_at is null
      and fc.last_loss_method is null
  ) as fiber_cores_zero_loss_without_measurement
from public.devices d
left join active_port_count apc on apc.device_id = d.id
left join cable_core_count ccc on ccc.cable_device_id = d.id
where d.deleted_at is null;

commit;
