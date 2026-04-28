-- Add image and support document attachments for project records.

alter table if exists public.projects
  add column if not exists image_attachment_id uuid,
  add column if not exists image_attachments jsonb not null default '[]'::jsonb,
  add column if not exists support_doc jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'projects_image_attachment_id_fkey'
  ) then
    alter table public.projects
      add constraint projects_image_attachment_id_fkey
      foreign key (image_attachment_id)
      references public.attachments(id)
      on update cascade
      on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_projects_image_attachments_json'
  ) then
    alter table public.projects
      add constraint chk_projects_image_attachments_json
      check (jsonb_typeof(image_attachments) = 'array');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_projects_image_attachments_max_10'
  ) then
    alter table public.projects
      add constraint chk_projects_image_attachments_max_10
      check (jsonb_array_length(image_attachments) <= 10);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_projects_support_doc_json'
  ) then
    alter table public.projects
      add constraint chk_projects_support_doc_json
      check (jsonb_typeof(support_doc) = 'object');
  end if;
end $$;

create index if not exists idx_projects_image_attachment_id
  on public.projects(image_attachment_id);
