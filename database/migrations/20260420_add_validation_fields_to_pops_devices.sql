-- Add validation status/date to POP and Device schemas.

alter table if exists public.pops
  add column if not exists validation_status text not null default 'unvalidated',
  add column if not exists validation_date date;

alter table if exists public.devices
  add column if not exists validation_status text not null default 'unvalidated',
  add column if not exists validation_date date;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chk_pops_validation_status'
  ) then
    alter table public.pops
      add constraint chk_pops_validation_status
      check (validation_status in ('unvalidated', 'valid', 'warning', 'invalid'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chk_devices_validation_status'
  ) then
    alter table public.devices
      add constraint chk_devices_validation_status
      check (validation_status in ('unvalidated', 'valid', 'warning', 'invalid'));
  end if;
end $$;

-- Backfill business validation_date from last_validation_at when available.
update public.devices
set validation_date = (last_validation_at at time zone 'UTC')::date
where validation_date is null
  and last_validation_at is not null;
