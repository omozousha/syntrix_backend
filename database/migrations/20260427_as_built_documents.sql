-- As-Built documents registry for persisted drawing exports and revisions.
-- Purpose:
-- 1) Keep metadata and revision history for generated as-built documents.
-- 2) Link exported file attachment (SVG/PNG/PDF) into a searchable table.
-- 3) Support audit trail through generic resource create/update actions.

create sequence if not exists public.as_built_document_hid_seq start 1;

create table if not exists public.as_built_documents (
  id uuid primary key default gen_random_uuid(),
  document_id text unique default public.generate_prefixed_code('ABD', 'public.as_built_document_hid_seq'),
  region_id uuid references public.regions(id) on update cascade on delete set null,
  project_id uuid references public.projects(id) on update cascade on delete set null,
  route_id uuid references public.network_routes(id) on update cascade on delete set null,
  start_device_id uuid references public.devices(id) on update cascade on delete set null,
  end_device_id uuid references public.devices(id) on update cascade on delete set null,
  title text not null,
  revision_code text not null default 'v1',
  status text not null default 'draft'
    check (status in ('draft', 'published', 'superseded', 'archived')),
  primary_format text not null default 'svg'
    check (primary_format in ('svg', 'png', 'pdf', 'json')),
  generated_at timestamptz not null default now(),
  prepared_by_name text,
  checked_by_name text,
  approved_by_name text,
  created_by_user_id uuid references public.app_users(id) on update cascade on delete set null,
  attachment_id uuid references public.attachments(id) on update cascade on delete set null,
  trace_request jsonb not null default '{}'::jsonb,
  trace_summary jsonb not null default '{}'::jsonb,
  export_metadata jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_as_built_documents_updated_at on public.as_built_documents;
create trigger trg_as_built_documents_updated_at
before update on public.as_built_documents
for each row execute function public.set_current_timestamp_updated_at();

create index if not exists idx_as_built_documents_region on public.as_built_documents(region_id, generated_at desc);
create index if not exists idx_as_built_documents_route on public.as_built_documents(route_id);
create index if not exists idx_as_built_documents_project on public.as_built_documents(project_id);
create index if not exists idx_as_built_documents_start_device on public.as_built_documents(start_device_id);
create index if not exists idx_as_built_documents_status on public.as_built_documents(status, generated_at desc);
create index if not exists idx_as_built_documents_created_by on public.as_built_documents(created_by_user_id, created_at desc);
