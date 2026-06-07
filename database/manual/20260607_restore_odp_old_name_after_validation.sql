-- Restore ODP primary name after field validation.
-- Safe to run more than once.
--
-- Context:
-- Field validation stores the corrected/new ODP name in
-- payload_snapshot.field_validation.new_device_name. The primary
-- devices.device_name must remain the old/existing ODP name.
--
-- This only restores rows where the current device name matches the submitted
-- new ODP name after trim/lowercase normalization, so unrelated manual renames
-- are not touched.

begin;

with latest_field_validation as (
  select distinct on (vr.entity_id)
    vr.entity_id as device_id,
    nullif(trim(vr.payload_snapshot #>> '{field_validation,old_device_name}'), '') as old_device_name,
    nullif(trim(vr.payload_snapshot #>> '{field_validation,new_device_name}'), '') as new_device_name,
    coalesce(vr.updated_at, vr.created_at, now()) as validation_at
  from public.validation_requests vr
  where vr.entity_type = 'device'
    and vr.current_status = 'validated'
    and (
      vr.payload_snapshot ? 'field_validation'
      or vr.payload_snapshot ? 'field_inspection'
      or vr.payload_snapshot ? 'port_summary'
    )
  order by vr.entity_id, coalesce(vr.updated_at, vr.created_at, now()) desc
),
restored as (
  update public.devices d
  set
    device_name = lfv.old_device_name,
    updated_at = now()
  from latest_field_validation lfv
  where d.id = lfv.device_id
    and lower(coalesce(d.device_type_key, '')) = 'odp'
    and lfv.old_device_name is not null
    and lfv.new_device_name is not null
    and lower(trim(d.device_name)) = lower(trim(lfv.new_device_name))
    and lower(trim(lfv.old_device_name)) <> lower(trim(lfv.new_device_name))
  returning
    d.id,
    d.device_id,
    lfv.new_device_name as before_name,
    d.device_name as restored_name,
    lfv.validation_at
)
select
  count(*)::int as restored_total,
  jsonb_agg(
    jsonb_build_object(
      'id', id,
      'inventory_id', device_id,
      'before_name', before_name,
      'restored_name', restored_name,
      'validation_at', validation_at
    )
    order by validation_at desc
  ) as restored_items
from restored;

commit;
