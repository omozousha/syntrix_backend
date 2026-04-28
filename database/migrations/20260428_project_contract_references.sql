-- Add optional project contract references used by delivery and as-built workflows.

alter table if exists public.projects
  add column if not exists bast_number text,
  add column if not exists spk_number text;

create index if not exists idx_projects_bast_number
  on public.projects(bast_number)
  where bast_number is not null;

create index if not exists idx_projects_spk_number
  on public.projects(spk_number)
  where spk_number is not null;
