-- Cleanup device validation status consistency.
-- Run this once on production after the UI fix is deployed.
-- The SELECT at the bottom is a verification summary after the cleanup.
--
-- Goal:
-- 1. Devices marked valid/validated with an approved validation request/history
--    receive missing validation dates.
-- 2. Devices marked valid/validated without final approval/history evidence
--    are reset to unvalidated.

begin;

with final_request as (
  select
    entity_id as device_id,
    max(coalesce(updated_at, created_at, now())) as final_at
  from public.validation_requests
  where entity_type = 'device'
    and current_status = 'validated'
  group by entity_id
),
final_history as (
  select
    entity_id as device_id,
    max(coalesce(validated_at, updated_at, created_at, now())) as final_at
  from public.validations
  where entity_type = 'device'
    and lower(coalesce(status, '')) in ('valid', 'validated')
  group by entity_id
),
final_evidence as (
  select
    d.id as device_id,
    coalesce(fr.final_at, fh.final_at) as final_at
  from public.devices d
  left join final_request fr on fr.device_id = d.id
  left join final_history fh on fh.device_id = d.id
  where coalesce(fr.final_at, fh.final_at) is not null
)
update public.devices d
set
  validation_status = 'valid',
  validation_date = coalesce(d.validation_date, fe.final_at::date),
  last_validation_at = coalesce(d.last_validation_at, fe.final_at),
  updated_at = now()
from final_evidence fe
where d.id = fe.device_id
  and lower(coalesce(d.validation_status, '')) in ('valid', 'validated', 'verified', 'ok')
  and (d.validation_date is null or d.last_validation_at is null);

with final_request as (
  select entity_id as device_id
  from public.validation_requests
  where entity_type = 'device'
    and current_status = 'validated'
  group by entity_id
),
final_history as (
  select entity_id as device_id
  from public.validations
  where entity_type = 'device'
    and lower(coalesce(status, '')) in ('valid', 'validated')
  group by entity_id
)
update public.devices d
set
  validation_status = 'unvalidated',
  validation_date = null,
  last_validation_at = null,
  updated_at = now()
where lower(coalesce(d.validation_status, '')) in ('valid', 'validated', 'verified', 'ok')
  and d.validation_date is null
  and d.last_validation_at is null
  and not exists (select 1 from final_request fr where fr.device_id = d.id)
  and not exists (select 1 from final_history fh where fh.device_id = d.id);

-- Verification summary.
select
  count(*) filter (
    where lower(coalesce(validation_status, '')) in ('valid', 'validated', 'verified', 'ok')
      and validation_date is null
      and last_validation_at is null
  ) as valid_without_final_date_remaining,
  count(*) filter (
    where lower(coalesce(validation_status, '')) = 'unvalidated'
  ) as unvalidated_total,
  count(*) filter (
    where lower(coalesce(validation_status, '')) = 'valid'
      and (validation_date is not null or last_validation_at is not null)
  ) as final_validated_total
from public.devices;

commit;
