-- Repair inventory region code resolution after auto reference-number migrations.
-- Bali must resolve to 07, and devices that were generated with region code 00
-- should be moved into their actual region sequence.

update public.regions
set inventory_region_code = '07'
where regexp_replace(lower(coalesce(region_name, '')), '[^a-z0-9]+', '', 'g') = 'bali'
  and (inventory_region_code is null or inventory_region_code = '00');

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
    and r.inventory_region_code is not null
    and r.inventory_region_code <> '00';

  if mapped_code is not null then
    return mapped_code;
  end if;

  select irc.region_code
  into mapped_code
  from public.inventory_region_codes irc
  where irc.region_id = input_region_id
    and irc.region_code <> '00';

  if mapped_code is not null then
    return mapped_code;
  end if;

  select public.normalize_inventory_label(r.region_name)
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

with parsed_devices as (
  select
    d.id,
    regexp_match(d.device_id, '^INV-([0-9]{4})/([0-9]{2})/([0-9]{3})/([0-9]{4})$') as parts
  from public.devices d
),
bad_devices as (
  select
    pd.id,
    (pd.parts)[1]::integer as recap_year,
    public.get_inventory_region_code(d.region_id) as region_code,
    public.normalize_device_inventory_type_code(d.device_type_key) as device_type_code,
    row_number() over (
      partition by
        (pd.parts)[1]::integer,
        public.get_inventory_region_code(d.region_id),
        public.normalize_device_inventory_type_code(d.device_type_key)
      order by d.created_at asc, d.id asc
    ) as offset_number
  from parsed_devices pd
  join public.devices d on d.id = pd.id
  where pd.parts is not null
    and (pd.parts)[2] = '00'
    and public.get_inventory_region_code(d.region_id) <> '00'
),
existing_max as (
  select
    (parts)[1]::integer as recap_year,
    (parts)[2] as region_code,
    (parts)[3] as device_type_code,
    max((parts)[4]::integer) as max_number
  from (
    select regexp_match(device_id, '^INV-([0-9]{4})/([0-9]{2})/([0-9]{3})/([0-9]{4})$') as parts
    from public.devices
  ) matches
  where parts is not null
    and (parts)[2] <> '00'
  group by (parts)[1]::integer, (parts)[2], (parts)[3]
),
next_codes as (
  select
    bd.id,
    public.format_device_inventory_id(
      bd.recap_year,
      bd.region_code,
      bd.device_type_code,
      coalesce(em.max_number, 0) + bd.offset_number::integer
    ) as inventory_id
  from bad_devices bd
  left join existing_max em
    on em.recap_year = bd.recap_year
   and em.region_code = bd.region_code
   and em.device_type_code = bd.device_type_code
)
update public.devices d
set
  device_id = next_codes.inventory_id,
  device_code = next_codes.inventory_id
from next_codes
where d.id = next_codes.id;

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
  last_number = excluded.last_number,
  updated_at = now();
