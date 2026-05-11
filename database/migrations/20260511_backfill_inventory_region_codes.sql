-- Backfill and harden inventory region codes for existing master regions.
-- This complements the auto-fill migration and covers seeded names such as
-- Jabodebek, Jawa Timur, and Bali.

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

update public.regions
set inventory_region_code = case
  when regexp_replace(lower(coalesce(region_name, '')), '[^a-z0-9]+', '', 'g') = 'banten' then '01'
  when regexp_replace(lower(coalesce(region_name, '')), '[^a-z0-9]+', '', 'g') in ('jabo', 'jabodebek', 'jabodetabek') then '02'
  when regexp_replace(lower(coalesce(region_name, '')), '[^a-z0-9]+', '', 'g') in ('jabar', 'jawabarat') then '03'
  when regexp_replace(lower(coalesce(region_name, '')), '[^a-z0-9]+', '', 'g') in ('jateng', 'jawatengah') then '04'
  when regexp_replace(lower(coalesce(region_name, '')), '[^a-z0-9]+', '', 'g') in ('jatim', 'jawatimur', 'jatimkal', 'jawatimurkalimantan', 'jatimkalimantan') then '05'
  when regexp_replace(lower(coalesce(region_name, '')), '[^a-z0-9]+', '', 'g') = 'sulawesi' then '06'
  when regexp_replace(lower(coalesce(region_name, '')), '[^a-z0-9]+', '', 'g') = 'bali' then '07'
  else inventory_region_code
end
where inventory_region_code is null;

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

insert into public.inventory_region_codes (region_id, region_code, region_name_snapshot)
select id, inventory_region_code, region_name
from public.regions
where inventory_region_code is not null
on conflict (region_id) do update
set
  region_code = excluded.region_code,
  region_name_snapshot = excluded.region_name_snapshot,
  updated_at = now();

create or replace function public.get_inventory_region_code(input_region_id uuid)
returns text
language plpgsql
stable
as $$
declare
  mapped_code text;
  normalized_name text;
begin
  select r.inventory_region_code
  into mapped_code
  from public.regions r
  where r.id = input_region_id
    and r.inventory_region_code is not null;

  if mapped_code is not null then
    return mapped_code;
  end if;

  select irc.region_code
  into mapped_code
  from public.inventory_region_codes irc
  where irc.region_id = input_region_id;

  if mapped_code is not null then
    return mapped_code;
  end if;

  select regexp_replace(lower(coalesce(r.region_name, '')), '[^a-z0-9]+', '', 'g')
  into normalized_name
  from public.regions r
  where r.id = input_region_id;

  return case
    when normalized_name = 'banten' then '01'
    when normalized_name in ('jabo', 'jabodebek', 'jabodetabek') then '02'
    when normalized_name in ('jabar', 'jawabarat') then '03'
    when normalized_name in ('jateng', 'jawatengah') then '04'
    when normalized_name in ('jatim', 'jawatimur', 'jatimkal', 'jawatimurkalimantan', 'jatimkalimantan') then '05'
    when normalized_name = 'sulawesi' then '06'
    when normalized_name = 'bali' then '07'
    else '00'
  end;
end;
$$;

with ranked_devices as (
  select
    d.id,
    coalesce(extract(year from d.installation_date)::integer, extract(year from d.created_at)::integer, extract(year from now())::integer) as recap_year,
    public.get_inventory_region_code(d.region_id) as region_code,
    public.normalize_device_inventory_type_code(d.device_type_key) as device_type_code,
    row_number() over (
      partition by
        coalesce(extract(year from d.installation_date)::integer, extract(year from d.created_at)::integer, extract(year from now())::integer),
        public.get_inventory_region_code(d.region_id),
        public.normalize_device_inventory_type_code(d.device_type_key)
      order by d.created_at asc, d.id asc
    ) as sequence_number
  from public.devices d
),
next_codes as (
  select
    id,
    public.format_device_inventory_id(recap_year, region_code, device_type_code, sequence_number::integer) as inventory_id
  from ranked_devices
)
update public.devices d
set
  device_id = next_codes.inventory_id,
  device_code = next_codes.inventory_id
from next_codes
where d.id = next_codes.id
  and (d.device_id is distinct from next_codes.inventory_id or d.device_code is distinct from next_codes.inventory_id);

truncate table public.device_inventory_counters;

with parsed as (
  select
    (parts)[1]::integer as recap_year,
    (parts)[2] as region_code,
    (parts)[3] as device_type_code,
    (parts)[4]::integer as sequence_number
  from (
    select regexp_match(device_id, '^INV-([0-9]{4})/([0-9]{2})/([0-9]{3})/([0-9]{4})$') as parts
    from public.devices
  ) matches
  where parts is not null
),
max_numbers as (
  select recap_year, region_code, device_type_code, max(sequence_number) as last_number
  from parsed
  group by recap_year, region_code, device_type_code
)
insert into public.device_inventory_counters (recap_year, region_code, device_type_code, last_number)
select recap_year, region_code, device_type_code, last_number
from max_numbers
on conflict (recap_year, region_code, device_type_code)
do update set
  last_number = greatest(public.device_inventory_counters.last_number, excluded.last_number),
  updated_at = now();
