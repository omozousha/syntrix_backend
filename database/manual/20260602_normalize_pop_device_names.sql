-- Normalize existing POP and device names.
-- Safe to run more than once.
--
-- POP name format:
--   "parung" -> "Parung"
--   "parung utara" -> "Parung Utara"
--
-- Device name format:
--   "prg-01-01" -> "PRG-01-01"

with normalized_pops as (
  select
    id,
    pop_name as before_name,
    initcap(lower(regexp_replace(trim(pop_name), '\s+', ' ', 'g'))) as after_name
  from public.pops
  where pop_name is not null
),
updated_pops as (
  update public.pops target
  set
    pop_name = normalized_pops.after_name,
    updated_at = now()
  from normalized_pops
  where target.id = normalized_pops.id
    and target.pop_name is distinct from normalized_pops.after_name
  returning target.id, normalized_pops.before_name, target.pop_name as after_name
),
normalized_devices as (
  select
    id,
    device_name as before_name,
    upper(regexp_replace(trim(device_name), '\s+', ' ', 'g')) as after_name
  from public.devices
  where device_name is not null
),
updated_devices as (
  update public.devices target
  set
    device_name = normalized_devices.after_name,
    updated_at = now()
  from normalized_devices
  where target.id = normalized_devices.id
    and target.device_name is distinct from normalized_devices.after_name
  returning target.id, normalized_devices.before_name, target.device_name as after_name
)
select
  (select count(*)::int from updated_pops) as updated_pop_count,
  (select count(*)::int from updated_devices) as updated_device_count;

-- Optional spot check after running:
-- select pop_name from public.pops order by updated_at desc limit 20;
-- select device_type_key, device_name from public.devices order by updated_at desc limit 20;
