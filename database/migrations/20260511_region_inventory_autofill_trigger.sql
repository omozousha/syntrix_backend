-- Ensure new regions always receive an automatic inventory code.

alter table if exists public.regions
  add column if not exists inventory_region_code text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'regions_inventory_region_code_check'
      and conrelid = 'public.regions'::regclass
  ) then
    alter table public.regions
      add constraint regions_inventory_region_code_check
      check (inventory_region_code is null or inventory_region_code ~ '^[0-9]{2}$');
  end if;
end $$;

create unique index if not exists uq_regions_inventory_region_code
  on public.regions(inventory_region_code)
  where inventory_region_code is not null;

create or replace function public.next_available_inventory_region_code()
returns text
language plpgsql
volatile
as $$
declare
  number_candidate integer;
  code_candidate text;
begin
  for number_candidate in 1..99 loop
    code_candidate := lpad(number_candidate::text, 2, '0');
    if not exists (
      select 1
      from public.regions r
      where r.inventory_region_code = code_candidate
    ) and not exists (
      select 1
      from public.inventory_region_codes irc
      where irc.region_code = code_candidate
    ) then
      return code_candidate;
    end if;
  end loop;

  raise exception 'No available 2-digit inventory region code remains';
end;
$$;

create or replace function public.set_region_inventory_code()
returns trigger
language plpgsql
as $$
begin
  if new.inventory_region_code is null or trim(new.inventory_region_code) = '' then
    new.inventory_region_code := public.next_available_inventory_region_code();
  else
    new.inventory_region_code := lpad(regexp_replace(new.inventory_region_code, '[^0-9]', '', 'g'), 2, '0');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_regions_set_inventory_code on public.regions;
create trigger trg_regions_set_inventory_code
before insert or update of inventory_region_code on public.regions
for each row execute function public.set_region_inventory_code();

create or replace function public.sync_inventory_region_code()
returns trigger
language plpgsql
as $$
begin
  insert into public.inventory_region_codes (region_id, region_code, region_name_snapshot)
  values (new.id, new.inventory_region_code, new.region_name)
  on conflict (region_id) do update
  set
    region_code = excluded.region_code,
    region_name_snapshot = excluded.region_name_snapshot,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_regions_sync_inventory_code on public.regions;
create trigger trg_regions_sync_inventory_code
after insert or update of inventory_region_code, region_name on public.regions
for each row
when (new.inventory_region_code is not null)
execute function public.sync_inventory_region_code();

do $$
declare
  rec record;
begin
  for rec in
    select id
    from public.regions
    where inventory_region_code is null
    order by created_at asc, id asc
  loop
    update public.regions
    set inventory_region_code = public.next_available_inventory_region_code()
    where id = rec.id;
  end loop;
end $$;
