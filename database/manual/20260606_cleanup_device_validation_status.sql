-- Cleanup device validation status consistency.
-- Run this once on production after the UI fix is deployed.
-- The SELECT at the bottom is a verification summary after the cleanup.
--
-- Source of truth:
-- A device is final validated only when it has a validation request with
-- current_status = 'validated' and a field-validation payload marker:
-- field_validation, field_inspection, or port_summary.
-- Create/update approval requests are not treated as field validation evidence.
--
-- Goal:
-- 1. Devices with approved field-validation requests receive missing validation dates.
-- 2. Devices marked valid/validated without approved field-validation requests
--    are reset to unvalidated, even if a previous cleanup/import filled dates.

begin;

with final_request as (
  select
    entity_id as device_id,
    max(coalesce(updated_at, created_at, now())) as final_at
  from public.validation_requests
  where entity_type = 'device'
    and current_status = 'validated'
    and (
      payload_snapshot ? 'field_validation'
      or payload_snapshot ? 'field_inspection'
      or payload_snapshot ? 'port_summary'
    )
  group by entity_id
)
update public.devices d
set
  validation_status = 'valid',
  validation_date = coalesce(d.validation_date, fr.final_at::date),
  last_validation_at = coalesce(d.last_validation_at, fr.final_at),
  updated_at = now()
from final_request fr
where d.id = fr.device_id
  and (
    lower(coalesce(d.validation_status, '')) <> 'valid'
    or d.validation_date is null
    or d.last_validation_at is null
  );

with final_request as (
  select entity_id as device_id
  from public.validation_requests
  where entity_type = 'device'
    and current_status = 'validated'
    and (
      payload_snapshot ? 'field_validation'
      or payload_snapshot ? 'field_inspection'
      or payload_snapshot ? 'port_summary'
    )
  group by entity_id
)
update public.devices d
set
  validation_status = 'unvalidated',
  validation_date = null,
  last_validation_at = null,
  updated_at = now()
where lower(coalesce(d.validation_status, '')) in ('valid', 'validated', 'verified', 'ok')
  and not exists (select 1 from final_request fr where fr.device_id = d.id);

-- Verification summary.
select
  count(*) filter (
    where lower(coalesce(d.validation_status, '')) in ('valid', 'validated', 'verified', 'ok')
      and not exists (
        select 1
        from public.validation_requests vr
        where vr.entity_type = 'device'
          and vr.current_status = 'validated'
          and vr.entity_id = d.id
          and (
            vr.payload_snapshot ? 'field_validation'
            or vr.payload_snapshot ? 'field_inspection'
            or vr.payload_snapshot ? 'port_summary'
          )
      )
  ) as valid_without_approved_field_validation_remaining,
  count(*) filter (
    where lower(coalesce(d.validation_status, '')) = 'unvalidated'
  ) as unvalidated_total,
  count(*) filter (
    where lower(coalesce(d.validation_status, '')) = 'valid'
      and exists (
        select 1
        from public.validation_requests vr
        where vr.entity_type = 'device'
          and vr.current_status = 'validated'
          and vr.entity_id = d.id
          and (
            vr.payload_snapshot ? 'field_validation'
            or vr.payload_snapshot ? 'field_inspection'
            or vr.payload_snapshot ? 'port_summary'
          )
      )
  ) as final_validated_total
from public.devices d;

commit;
