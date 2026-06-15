-- Manual apply script for fiber core tray/tube/color foundation.
-- Use this file when production has not received the migration yet.
-- Safe to run more than once.

alter table if exists public.fiber_cores
  add column if not exists tray_no integer,
  add column if not exists tube_no integer,
  add column if not exists tube_color_name text,
  add column if not exists tube_color_hex text,
  add column if not exists color_standard text not null default 'TIA_EIA_598_12_COLOR',
  add column if not exists cores_per_tube integer not null default 12,
  add column if not exists last_loss_db numeric(8,3),
  add column if not exists last_loss_measured_at timestamptz,
  add column if not exists last_loss_method text,
  add column if not exists health_notes text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_fiber_cores_tray_no_positive'
  ) then
    alter table public.fiber_cores
      add constraint chk_fiber_cores_tray_no_positive
      check (tray_no is null or tray_no > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'chk_fiber_cores_tube_no_positive'
  ) then
    alter table public.fiber_cores
      add constraint chk_fiber_cores_tube_no_positive
      check (tube_no is null or tube_no > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'chk_fiber_cores_cores_per_tube_positive'
  ) then
    alter table public.fiber_cores
      add constraint chk_fiber_cores_cores_per_tube_positive
      check (cores_per_tube > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'chk_fiber_cores_last_loss_db_non_negative'
  ) then
    alter table public.fiber_cores
      add constraint chk_fiber_cores_last_loss_db_non_negative
      check (last_loss_db is null or last_loss_db >= 0);
  end if;
end
$$;

create index if not exists idx_fiber_cores_cable_tube_core
  on public.fiber_cores(cable_device_id, tube_no, core_no);

create index if not exists idx_fiber_cores_health
  on public.fiber_cores(status, last_loss_db);

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
    core_color.color_name as core_color_name,
    core_color.color_hex as core_color_hex,
    (floor((fc.core_no - 1)::numeric / greatest(coalesce(fc.cores_per_tube, 12), 1))::integer + 1) as derived_tube_no,
    tube_color.color_name as tube_color_name,
    tube_color.color_hex as tube_color_hex
  from public.fiber_cores fc
  cross join profile
  join public.core_color_map core_color
    on core_color.profile_id = profile.id
   and core_color.core_no = (((fc.core_no - 1) % 12) + 1)
  join public.core_color_map tube_color
    on tube_color.profile_id = profile.id
   and tube_color.core_no = ((((floor((fc.core_no - 1)::numeric / greatest(coalesce(fc.cores_per_tube, 12), 1))::integer + 1) - 1) % 12) + 1)
)
update public.fiber_cores fc
set
  cores_per_tube = coalesce(fc.cores_per_tube, 12),
  color_standard = coalesce(nullif(fc.color_standard, ''), 'TIA_EIA_598_12_COLOR'),
  color_profile_id = coalesce(fc.color_profile_id, mapped.profile_id),
  color_name = coalesce(fc.color_name, mapped.core_color_name),
  color_hex = coalesce(fc.color_hex, mapped.core_color_hex),
  tube_no = coalesce(fc.tube_no, mapped.derived_tube_no),
  tube_color_name = coalesce(fc.tube_color_name, mapped.tube_color_name),
  tube_color_hex = coalesce(fc.tube_color_hex, mapped.tube_color_hex),
  updated_at = now()
from mapped
where fc.id = mapped.id;

select
  count(*) filter (where tube_no is null) as fiber_cores_without_tube_no,
  count(*) filter (where tube_color_name is null or tube_color_hex is null) as fiber_cores_without_tube_color,
  count(*) filter (where color_name is null or color_hex is null) as fiber_cores_without_core_color,
  count(*) filter (where last_loss_db is not null and last_loss_db > 0.2) as fiber_cores_loss_warning_total
from public.fiber_cores;
