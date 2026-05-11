-- Device inventory ID format:
-- INV-<recap year>/<regional code>/<device type code>/<sequence>
-- Example: INV-2026/01/001/0001

create table if not exists public.inventory_region_codes (
  region_id uuid primary key references public.regions(id) on update cascade on delete cascade,
  region_code text not null unique check (region_code ~ '^[0-9]{2}$'),
  region_name_snapshot text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_inventory_region_codes_updated_at on public.inventory_region_codes;
create trigger trg_inventory_region_codes_updated_at
before update on public.inventory_region_codes
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.device_inventory_counters (
  recap_year integer not null,
  region_code text not null check (region_code ~ '^[0-9]{2}$'),
  device_type_code text not null check (device_type_code ~ '^[0-9]{3}$'),
  last_number integer not null default 0 check (last_number >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (recap_year, region_code, device_type_code)
);

drop trigger if exists trg_device_inventory_counters_updated_at on public.device_inventory_counters;
create trigger trg_device_inventory_counters_updated_at
before update on public.device_inventory_counters
for each row execute function public.set_current_timestamp_updated_at();

create or replace function public.normalize_inventory_label(input text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(coalesce(input, '')), '[^a-z0-9]+', '', 'g');
$$;

alter table if exists public.device_type_catalog
  add column if not exists inventory_type_code text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'device_type_catalog_inventory_type_code_check'
      and conrelid = 'public.device_type_catalog'::regclass
  ) then
    alter table public.device_type_catalog
      add constraint device_type_catalog_inventory_type_code_check
      check (inventory_type_code is null or inventory_type_code ~ '^[0-9]{3}$');
  end if;
end $$;

update public.device_type_catalog
set inventory_type_code = case
  when public.normalize_inventory_label(device_type_key) = 'olt' then '001'
  when public.normalize_inventory_label(device_type_key) = 'otb' then '002'
  when public.normalize_inventory_label(device_type_key) = 'rack' then '003'
  when public.normalize_inventory_label(device_type_key) in ('switch', 'swt') then '004'
  when public.normalize_inventory_label(device_type_key) in ('kabelbb', 'cablebb', 'backbonecable', 'backbone') then '005'
  when public.normalize_inventory_label(device_type_key) in ('cable', 'kabelaksesfeeder', 'kabelakses', 'kabelfeeder', 'accessfeeder', 'accesscable', 'feedercable', 'feeder') then '006'
  when public.normalize_inventory_label(device_type_key) in ('kabeldw', 'cabledw', 'dropwire', 'dw') then '007'
  when public.normalize_inventory_label(device_type_key) = 'ont' then '008'
  when public.normalize_inventory_label(device_type_key) = 'odc' then '009'
  when public.normalize_inventory_label(device_type_key) = 'odp' then '010'
  when public.normalize_inventory_label(device_type_key) = 'hh' then '011'
  when public.normalize_inventory_label(device_type_key) = 'mh' then '012'
  when public.normalize_inventory_label(device_type_key) in ('jc', 'jointclosure', 'joint', 'jclosure') then '013'
  else inventory_type_code
end
where inventory_type_code is null;

insert into public.device_type_catalog
  (device_type_key, device_type_name, asset_group, inventory_type_code, description, sort_order, is_active)
values
  ('OLT', 'OLT', 'active', '001', 'Optical Line Terminal', 10, true),
  ('OTB', 'OTB', 'passive', '002', 'Optical Termination Box', 20, true),
  ('RACK', 'Rack', 'passive', '003', 'Rack perangkat', 30, true),
  ('SWITCH', 'Switch', 'active', '004', 'Network switch asset', 40, true),
  ('KABEL_BB', 'Kabel BB', 'passive', '005', 'Kabel backbone', 50, true),
  ('KABEL_AKSES_FEEDER', 'Kabel Akses/Feeder', 'passive', '006', 'Kabel akses atau feeder', 60, true),
  ('KABEL_DW', 'Kabel DW', 'passive', '007', 'Kabel drop wire', 70, true),
  ('ONT', 'ONT', 'active', '008', 'Optical Network Terminal', 80, true),
  ('ODC', 'ODC', 'passive', '009', 'Optical Distribution Cabinet', 90, true),
  ('ODP', 'ODP', 'passive', '010', 'Optical Distribution Point', 100, true),
  ('HH', 'HH', 'passive', '011', 'Handhole', 110, true),
  ('MH', 'MH', 'passive', '012', 'Manhole', 120, true),
  ('JC', 'JC', 'passive', '013', 'Joint Closure', 130, true)
on conflict (device_type_key) do update
set
  device_type_name = excluded.device_type_name,
  asset_group = excluded.asset_group,
  inventory_type_code = excluded.inventory_type_code,
  description = coalesce(public.device_type_catalog.description, excluded.description),
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

insert into public.inventory_region_codes (region_id, region_code, region_name_snapshot)
select r.id,
  case
    when public.normalize_inventory_label(r.region_name) in ('banten') then '01'
    when public.normalize_inventory_label(r.region_name) in ('jabo', 'jabodetabek') then '02'
    when public.normalize_inventory_label(r.region_name) in ('jabar', 'jawabarat') then '03'
    when public.normalize_inventory_label(r.region_name) in ('jateng', 'jawatengah') then '04'
    when public.normalize_inventory_label(r.region_name) in ('jatimkal', 'jawatimurkalimantan', 'jatimkalimantan') then '05'
    when public.normalize_inventory_label(r.region_name) in ('sulawesi') then '06'
  end as region_code,
  r.region_name
from public.regions r
where public.normalize_inventory_label(r.region_name) in (
  'banten',
  'jabo',
  'jabodetabek',
  'jabar',
  'jawabarat',
  'jateng',
  'jawatengah',
  'jatimkal',
  'jawatimurkalimantan',
  'jatimkalimantan',
  'sulawesi'
)
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
  select irc.region_code
  into mapped_code
  from public.inventory_region_codes irc
  where irc.region_id = input_region_id;

  if mapped_code is not null then
    return mapped_code;
  end if;

  select public.normalize_inventory_label(r.region_name)
  into normalized_name
  from public.regions r
  where r.id = input_region_id;

  return case
    when normalized_name = 'banten' then '01'
    when normalized_name in ('jabo', 'jabodetabek') then '02'
    when normalized_name in ('jabar', 'jawabarat') then '03'
    when normalized_name in ('jateng', 'jawatengah') then '04'
    when normalized_name in ('jatimkal', 'jawatimurkalimantan', 'jatimkalimantan') then '05'
    when normalized_name = 'sulawesi' then '06'
    else '00'
  end;
end;
$$;

create or replace function public.normalize_device_inventory_type_code(input_type text)
returns text
language plpgsql
stable
as $$
declare
  normalized_type text;
  mapped_code text;
begin
  normalized_type := public.normalize_inventory_label(input_type);

  select dt.inventory_type_code
  into mapped_code
  from public.device_type_catalog dt
  where dt.inventory_type_code is not null
    and (
      public.normalize_inventory_label(dt.device_type_key) = normalized_type
      or public.normalize_inventory_label(dt.device_type_name) = normalized_type
    )
  order by dt.sort_order asc, dt.device_type_name asc
  limit 1;

  if mapped_code is not null then
    return mapped_code;
  end if;

  return case
    when normalized_type = 'olt' then '001'
    when normalized_type = 'otb' then '002'
    when normalized_type = 'rack' then '003'
    when normalized_type in ('switch', 'swt') then '004'
    when normalized_type in ('kabelbb', 'cablebb', 'backbonecable', 'backbone') then '005'
    when normalized_type in ('cable', 'kabelaksesfeeder', 'kabelakses', 'kabelfeeder', 'accessfeeder', 'accesscable', 'feedercable', 'feeder') then '006'
    when normalized_type in ('kabeldw', 'cabledw', 'dropwire', 'dw') then '007'
    when normalized_type = 'ont' then '008'
    when normalized_type = 'odc' then '009'
    when normalized_type = 'odp' then '010'
    when normalized_type = 'hh' then '011'
    when normalized_type = 'mh' then '012'
    when normalized_type in ('jc', 'jointclosure', 'joint', 'jclosure') then '013'
    else '000'
  end;
end;
$$;

create or replace function public.format_device_inventory_id(
  recap_year integer,
  region_code text,
  device_type_code text,
  sequence_number integer
)
returns text
language sql
immutable
as $$
  select 'INV-'
    || lpad(recap_year::text, 4, '0')
    || '/'
    || lpad(region_code, 2, '0')
    || '/'
    || lpad(device_type_code, 3, '0')
    || '/'
    || lpad(sequence_number::text, 4, '0');
$$;

create or replace function public.next_device_inventory_id(
  input_region_id uuid,
  input_device_type text,
  input_recap_year integer default extract(year from now())::integer
)
returns text
language plpgsql
volatile
as $$
declare
  next_region_code text;
  next_type_code text;
  next_number integer;
begin
  next_region_code := public.get_inventory_region_code(input_region_id);
  next_type_code := public.normalize_device_inventory_type_code(input_device_type);

  insert into public.device_inventory_counters (recap_year, region_code, device_type_code, last_number)
  values (input_recap_year, next_region_code, next_type_code, 1)
  on conflict (recap_year, region_code, device_type_code)
  do update set
    last_number = public.device_inventory_counters.last_number + 1,
    updated_at = now()
  returning last_number into next_number;

  return public.format_device_inventory_id(input_recap_year, next_region_code, next_type_code, next_number);
end;
$$;

create or replace function public.set_device_codes()
returns trigger
language plpgsql
as $$
declare
  next_inventory_id text;
  recap_year integer;
begin
  if new.device_id is null or new.device_id !~ '^INV-[0-9]{4}/[0-9]{2}/[0-9]{3}/[0-9]{4}$' then
    recap_year := coalesce(extract(year from new.installation_date)::integer, extract(year from now())::integer);
    next_inventory_id := public.next_device_inventory_id(new.region_id, new.device_type_key, recap_year);
    new.device_id := next_inventory_id;
  end if;

  if new.device_code is null or new.device_code !~ '^INV-[0-9]{4}/[0-9]{2}/[0-9]{3}/[0-9]{4}$' then
    new.device_code := new.device_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_devices_set_codes on public.devices;
create trigger trg_devices_set_codes
before insert on public.devices
for each row execute function public.set_device_codes();

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
  last_number = greatest(public.device_inventory_counters.last_number, excluded.last_number),
  updated_at = now();

-- Audit helpers:
-- 1) Device rows that still do not match the requested inventory format.
-- select count(*) as invalid_device_inventory_id
-- from public.devices
-- where device_id !~ '^INV-[0-9]{4}/[0-9]{2}/[0-9]{3}/[0-9]{4}$'
--    or device_code !~ '^INV-[0-9]{4}/[0-9]{2}/[0-9]{3}/[0-9]{4}$';
--
-- 2) Regions that fell back to code 00 and should be assigned an official code.
-- select distinct r.region_name, public.get_inventory_region_code(r.id) as inventory_region_code
-- from public.devices d
-- join public.regions r on r.id = d.region_id
-- where public.get_inventory_region_code(r.id) = '00'
-- order by r.region_name;
