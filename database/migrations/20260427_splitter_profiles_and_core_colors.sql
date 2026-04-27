-- Stage 1 SoT foundation:
-- 1) Splitter profiles (structured ratio model)
-- 2) Core color profiles + color map
-- 3) Extend device_ports and fiber_cores to reference the new catalogs

create sequence if not exists public.splitter_profile_hid_seq start 1;
create sequence if not exists public.core_color_profile_hid_seq start 1;

create table if not exists public.splitter_profiles (
  id uuid primary key default gen_random_uuid(),
  splitter_profile_id text unique default public.generate_prefixed_code('SPR', 'public.splitter_profile_hid_seq'),
  ratio_label text not null unique,
  input_port_count integer not null default 1 check (input_port_count > 0),
  output_port_count integer not null check (output_port_count > 0),
  expected_loss_db numeric(6,2),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_splitter_profiles_updated_at on public.splitter_profiles;
create trigger trg_splitter_profiles_updated_at
before update on public.splitter_profiles
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.core_color_profiles (
  id uuid primary key default gen_random_uuid(),
  color_profile_id text unique default public.generate_prefixed_code('CCP', 'public.core_color_profile_hid_seq'),
  profile_name text not null unique,
  description text,
  cycle_size integer not null default 12 check (cycle_size > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_core_color_profiles_updated_at on public.core_color_profiles;
create trigger trg_core_color_profiles_updated_at
before update on public.core_color_profiles
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.core_color_map (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.core_color_profiles(id) on update cascade on delete cascade,
  core_no integer not null check (core_no > 0),
  color_name text not null,
  color_hex text not null,
  sequence_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, core_no)
);

drop trigger if exists trg_core_color_map_updated_at on public.core_color_map;
create trigger trg_core_color_map_updated_at
before update on public.core_color_map
for each row execute function public.set_current_timestamp_updated_at();

alter table if exists public.device_ports
  add column if not exists splitter_profile_id uuid,
  add column if not exists splitter_role text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'device_ports_splitter_profile_id_fkey'
  ) then
    alter table public.device_ports
      add constraint device_ports_splitter_profile_id_fkey
      foreign key (splitter_profile_id) references public.splitter_profiles(id) on update cascade on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_device_ports_splitter_role'
  ) then
    alter table public.device_ports
      add constraint chk_device_ports_splitter_role
      check (splitter_role is null or splitter_role in ('input', 'output', 'bidirectional'));
  end if;
end $$;

alter table if exists public.fiber_cores
  add column if not exists color_profile_id uuid,
  add column if not exists color_name text,
  add column if not exists color_hex text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fiber_cores_color_profile_id_fkey'
  ) then
    alter table public.fiber_cores
      add constraint fiber_cores_color_profile_id_fkey
      foreign key (color_profile_id) references public.core_color_profiles(id) on update cascade on delete set null;
  end if;
end $$;

create index if not exists idx_splitter_profiles_active
  on public.splitter_profiles(is_active, output_port_count, ratio_label);
create index if not exists idx_core_color_profiles_active
  on public.core_color_profiles(is_active, profile_name);
create index if not exists idx_core_color_map_profile_core
  on public.core_color_map(profile_id, core_no);
create index if not exists idx_device_ports_splitter_profile
  on public.device_ports(splitter_profile_id, splitter_role);
create index if not exists idx_fiber_cores_color_profile
  on public.fiber_cores(color_profile_id, core_no);

-- Seed splitter profiles (idempotent).
insert into public.splitter_profiles (ratio_label, input_port_count, output_port_count, expected_loss_db, notes)
values
  ('1:2', 1, 2, 3.50, 'Passive optical splitter 1 to 2'),
  ('1:4', 1, 4, 7.20, 'Passive optical splitter 1 to 4'),
  ('1:8', 1, 8, 10.50, 'Passive optical splitter 1 to 8'),
  ('1:16', 1, 16, 13.80, 'Passive optical splitter 1 to 16'),
  ('1:32', 1, 32, 17.10, 'Passive optical splitter 1 to 32'),
  ('1:64', 1, 64, 20.50, 'Passive optical splitter 1 to 64')
on conflict (ratio_label) do update
set
  input_port_count = excluded.input_port_count,
  output_port_count = excluded.output_port_count,
  expected_loss_db = excluded.expected_loss_db,
  notes = excluded.notes,
  is_active = true,
  updated_at = now();

-- Seed default ITU-T style 12-color cycle profile.
insert into public.core_color_profiles (profile_name, description, cycle_size, is_active)
values
  ('ITU-T 12 Color', 'Default 12-color cycle for FO core identification', 12, true)
on conflict (profile_name) do update
set
  description = excluded.description,
  cycle_size = excluded.cycle_size,
  is_active = excluded.is_active,
  updated_at = now();

with profile as (
  select id
  from public.core_color_profiles
  where profile_name = 'ITU-T 12 Color'
  limit 1
)
insert into public.core_color_map (profile_id, core_no, color_name, color_hex, sequence_order)
select
  profile.id,
  data.core_no,
  data.color_name,
  data.color_hex,
  data.core_no
from profile
cross join (
  values
    (1, 'Blue', '#2563EB'),
    (2, 'Orange', '#F97316'),
    (3, 'Green', '#16A34A'),
    (4, 'Brown', '#92400E'),
    (5, 'Slate', '#475569'),
    (6, 'White', '#F8FAFC'),
    (7, 'Red', '#DC2626'),
    (8, 'Black', '#111827'),
    (9, 'Yellow', '#EAB308'),
    (10, 'Violet', '#7C3AED'),
    (11, 'Rose', '#E11D48'),
    (12, 'Aqua', '#06B6D4')
) as data(core_no, color_name, color_hex)
on conflict (profile_id, core_no) do update
set
  color_name = excluded.color_name,
  color_hex = excluded.color_hex,
  sequence_order = excluded.sequence_order,
  updated_at = now();

-- Backfill existing fiber_cores with default color profile and cyclic core colors.
with profile as (
  select id
  from public.core_color_profiles
  where profile_name = 'ITU-T 12 Color'
  limit 1
),
mapped as (
  select
    fc.id,
    profile.id as profile_id,
    cm.color_name,
    cm.color_hex
  from public.fiber_cores fc
  cross join profile
  join public.core_color_map cm
    on cm.profile_id = profile.id
   and cm.core_no = (((fc.core_no - 1) % 12) + 1)
)
update public.fiber_cores fc
set
  color_profile_id = coalesce(fc.color_profile_id, mapped.profile_id),
  color_name = coalesce(fc.color_name, mapped.color_name),
  color_hex = coalesce(fc.color_hex, mapped.color_hex),
  updated_at = now()
from mapped
where fc.id = mapped.id;

