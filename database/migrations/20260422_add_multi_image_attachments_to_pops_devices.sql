-- Add multi-image support for POP and Device.
-- Keep image_attachment_id as primary image for backward compatibility.

alter table if exists public.pops
  add column if not exists image_attachments jsonb not null default '[]'::jsonb;

alter table if exists public.devices
  add column if not exists image_attachments jsonb not null default '[]'::jsonb;

update public.pops
set image_attachments = jsonb_build_array(jsonb_build_object('id', image_attachment_id))
where image_attachment_id is not null
  and (image_attachments is null or image_attachments = '[]'::jsonb);

update public.devices
set image_attachments = jsonb_build_array(jsonb_build_object('id', image_attachment_id))
where image_attachment_id is not null
  and (image_attachments is null or image_attachments = '[]'::jsonb);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_pops_image_attachments_json'
  ) then
    alter table public.pops
      add constraint chk_pops_image_attachments_json
      check (jsonb_typeof(image_attachments) = 'array');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_pops_image_attachments_max_10'
  ) then
    alter table public.pops
      add constraint chk_pops_image_attachments_max_10
      check (jsonb_array_length(image_attachments) <= 10);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_devices_image_attachments_json'
  ) then
    alter table public.devices
      add constraint chk_devices_image_attachments_json
      check (jsonb_typeof(image_attachments) = 'array');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_devices_image_attachments_max_10'
  ) then
    alter table public.devices
      add constraint chk_devices_image_attachments_max_10
      check (jsonb_array_length(image_attachments) <= 10);
  end if;
end $$;
