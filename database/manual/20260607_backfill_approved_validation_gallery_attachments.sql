-- Backfill approved field-validation evidence into device mini gallery.
-- Safe to run more than once.
--
-- Context:
-- Validation evidence is stored on validation_requests.evidence_attachments and
-- payload_snapshot.field_inspection.*.attachment while the request is in review.
-- The inventory device gallery should only receive those images after the
-- superadmin final approval changes current_status to validated.

begin;

with approved_requests as (
  select
    id,
    entity_id as device_id,
    evidence_attachments,
    payload_snapshot,
    coalesce(updated_at, created_at, now()) as approved_at
  from public.validation_requests
  where entity_type = 'device'
    and current_status = 'validated'
    and (
      payload_snapshot ? 'field_validation'
      or payload_snapshot ? 'field_inspection'
      or payload_snapshot ? 'port_summary'
    )
),
request_evidence as (
  select
    ar.device_id,
    attachment.value as attachment,
    ar.approved_at
  from approved_requests ar
  cross join lateral jsonb_array_elements(coalesce(ar.evidence_attachments, '[]'::jsonb)) as attachment(value)
),
initial_photo_evidence as (
  select
    ar.device_id,
    item.value -> 'attachment' as attachment,
    ar.approved_at
  from approved_requests ar
  cross join lateral jsonb_each(coalesce(ar.payload_snapshot #> '{field_inspection,initial_photos}', '{}'::jsonb)) as item(key, value)
  where item.value ? 'attachment'
),
condition_check_evidence as (
  select
    ar.device_id,
    item.value -> 'attachment' as attachment,
    ar.approved_at
  from approved_requests ar
  cross join lateral jsonb_each(coalesce(ar.payload_snapshot #> '{field_inspection,condition_checks}', '{}'::jsonb)) as item(key, value)
  where item.value ? 'attachment'
),
existing_gallery as (
  select
    d.id as device_id,
    attachment.value as attachment,
    d.updated_at as approved_at
  from public.devices d
  cross join lateral jsonb_array_elements(coalesce(d.image_attachments, '[]'::jsonb)) as attachment(value)
),
all_gallery as (
  select * from existing_gallery
  union all
  select * from request_evidence
  union all
  select * from initial_photo_evidence
  union all
  select * from condition_check_evidence
),
deduped_gallery as (
  select distinct on (
    device_id,
    case
      when jsonb_typeof(attachment) = 'string' then trim(both '"' from attachment::text)
      else coalesce(attachment ->> 'id', attachment ->> 'attachment_id', attachment ->> 'file_id')
    end
  )
    device_id,
    attachment,
    approved_at
  from all_gallery
  where
    case
      when jsonb_typeof(attachment) = 'string' then trim(both '"' from attachment::text)
      else coalesce(attachment ->> 'id', attachment ->> 'attachment_id', attachment ->> 'file_id')
    end is not null
  order by
    device_id,
    case
      when jsonb_typeof(attachment) = 'string' then trim(both '"' from attachment::text)
      else coalesce(attachment ->> 'id', attachment ->> 'attachment_id', attachment ->> 'file_id')
    end,
    approved_at desc
),
merged_gallery as (
  select
    device_id,
    jsonb_agg(attachment order by approved_at desc) as image_attachments
  from deduped_gallery
  group by device_id
),
updated as (
  update public.devices d
  set
    image_attachments = mg.image_attachments,
    updated_at = now()
  from merged_gallery mg
  where d.id = mg.device_id
    and coalesce(d.image_attachments, '[]'::jsonb) is distinct from mg.image_attachments
  returning d.id, d.device_id, jsonb_array_length(d.image_attachments) as gallery_count
)
select
  count(*)::int as updated_device_total,
  coalesce(sum(gallery_count), 0)::int as updated_gallery_attachment_total
from updated;

commit;
