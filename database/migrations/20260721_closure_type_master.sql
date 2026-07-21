-- Master Data Synchronization — JC Closure Type Master
-- Section 10 dari master-data-topology-synchronization-plan.md

create sequence if not exists public.closure_type_hid_seq start 1;

create table if not exists public.closure_types (
  id uuid primary key default gen_random_uuid(),
  closure_type_id text unique default public.generate_prefixed_code('CLT', 'public.closure_type_hid_seq'),
  closure_type_name text not null unique,
  closure_type_code text unique,
  max_core_capacity integer not null check (max_core_capacity > 0),
  max_splice_capacity integer not null check (max_splice_capacity > 0),
  tray_count integer not null default 1 check (tray_count > 0),
  supports_pass_through boolean not null default true,
  supports_branching boolean not null default true,
  supports_splitter boolean not null default false,
  environment_rating text not null default 'outdoor',
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  deleted_by_user_id uuid references public.app_users(id) on update cascade on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.closure_types
  drop constraint if exists closure_types_environment_rating_check,
  add constraint closure_types_environment_rating_check check (
    environment_rating in ('indoor', 'outdoor', 'underground', 'aerial')
  );

drop trigger if exists trg_closure_types_updated_at on public.closure_types;
create trigger trg_closure_types_updated_at
before update on public.closure_types
for each row execute function public.set_current_timestamp_updated_at();

create index if not exists idx_closure_types_active
  on public.closure_types(is_active, sort_order, closure_type_name);

comment on table public.closure_types is 'Joint Closure Type Master — defines capacity and capabilities per closure model.';
comment on column public.closure_types.max_core_capacity is 'Maximum fiber core count this closure can accommodate.';
comment on column public.closure_types.max_splice_capacity is 'Maximum splice count (tray slots) this closure supports.';
comment on column public.closure_types.supports_pass_through is 'Allows straight-through cable routing without splicing.';
comment on column public.closure_types.supports_branching is 'Allows branch connections from a single cable.';
comment on column public.closure_types.supports_splitter is 'Closure has integrated splitter support.';

-- Seed canonical closure types
insert into public.closure_types
  (closure_type_name, closure_type_code, max_core_capacity, max_splice_capacity, tray_count, supports_pass_through, supports_branching, supports_splitter, environment_rating, description, sort_order)
values
  ('Dome Closure 24 Core',   'DOME-24',   24,  48, 2, true,  true,  false, 'outdoor',     'Dome-type closure untuk 24 core, 2 tray splice',      10),
  ('Dome Closure 48 Core',   'DOME-48',   48,  96, 4, true,  true,  false, 'outdoor',     'Dome-type closure untuk 48 core, 4 tray splice',      20),
  ('Dome Closure 96 Core',   'DOME-96',   96, 192, 8, true,  true,  false, 'outdoor',     'Dome-type closure untuk 96 core, 8 tray splice',      30),
  ('Dome Closure 144 Core',  'DOME-144', 144, 288, 12, true, true,  false, 'outdoor',     'Dome-type closure untuk 144 core, 12 tray splice',    40),
  ('Inline Closure 24 Core', 'INLINE-24', 24,  48, 2, true,  false, false, 'underground', 'Inline/horizontal closure untuk underground, 24 core', 50),
  ('Inline Closure 48 Core', 'INLINE-48', 48,  96, 4, true,  false, false, 'underground', 'Inline/horizontal closure untuk underground, 48 core', 60)
on conflict (closure_type_name) do nothing;
