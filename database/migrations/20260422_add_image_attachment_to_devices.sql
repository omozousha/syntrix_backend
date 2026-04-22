-- Add image attachment reference for devices.
-- Used by create-device form for OLT, SWITCH, ROUTER, ONT, OTB, JC, ODC, ODP.

alter table if exists public.devices
  add column if not exists image_attachment_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'devices_image_attachment_id_fkey'
  ) then
    alter table public.devices
      add constraint devices_image_attachment_id_fkey
      foreign key (image_attachment_id)
      references public.attachments(id)
      on update cascade
      on delete set null;
  end if;
end $$;

create index if not exists idx_devices_image_attachment_id
  on public.devices(image_attachment_id);
