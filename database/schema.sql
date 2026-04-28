create extension if not exists pgcrypto;

create or replace function public.set_current_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.generate_prefixed_code(prefix text, sequence_name text, padding integer default 6)
returns text
language plpgsql
as $$
declare
  next_number bigint;
begin
  execute format('select nextval(%L)', sequence_name) into next_number;
  return upper(prefix) || '-' || lpad(next_number::text, padding, '0');
end;
$$;

create or replace function public.generate_inventory_code(item_prefix text, code_length integer default 7)
returns text
language plpgsql
as $$
declare
  clean_prefix text;
  alphabet text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  random_part text := '';
  i integer;
begin
  clean_prefix := upper(regexp_replace(coalesce(item_prefix, ''), '[^A-Za-z0-9]', '', 'g'));
  if clean_prefix = '' then
    clean_prefix := 'DEV';
  end if;

  for i in 1..greatest(code_length, 4) loop
    random_part := random_part || substr(alphabet, (get_byte(gen_random_bytes(1), 0) % length(alphabet)) + 1, 1);
  end loop;

  return 'INV-' || clean_prefix || '-' || random_part;
end;
$$;

create sequence if not exists public.region_hid_seq start 1;
create sequence if not exists public.pop_hid_seq start 1;
create sequence if not exists public.project_hid_seq start 1;
create sequence if not exists public.pole_hid_seq start 1;
create sequence if not exists public.customer_hid_seq start 1;
create sequence if not exists public.device_hid_seq start 1;
create sequence if not exists public.route_hid_seq start 1;
create sequence if not exists public.device_port_hid_seq start 1;
create sequence if not exists public.port_connection_hid_seq start 1;
create sequence if not exists public.core_hid_seq start 1;
create sequence if not exists public.manufacturer_hid_seq start 1;
create sequence if not exists public.brand_hid_seq start 1;
create sequence if not exists public.asset_type_hid_seq start 1;
create sequence if not exists public.asset_model_hid_seq start 1;
create sequence if not exists public.attachment_hid_seq start 1;
create sequence if not exists public.import_job_hid_seq start 1;
create sequence if not exists public.validation_hid_seq start 1;
create sequence if not exists public.user_hid_seq start 1;

create table if not exists public.regions (
  id uuid primary key default gen_random_uuid(),
  region_id text unique,
  region_name text not null unique,
  region_color text not null default '#1D4ED8',
  description text,
  tags text[] not null default '{}',
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_region_codes()
returns trigger
language plpgsql
as $$
begin
  if new.region_id is null then
    new.region_id = public.generate_prefixed_code('REG', 'public.region_hid_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_regions_set_codes on public.regions;
create trigger trg_regions_set_codes
before insert on public.regions
for each row execute function public.set_region_codes();

drop trigger if exists trg_regions_updated_at on public.regions;
create trigger trg_regions_updated_at
before update on public.regions
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.manufacturers (
  id uuid primary key default gen_random_uuid(),
  manufacturer_code text unique,
  manufacturer_name text not null unique,
  description text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_manufacturer_codes()
returns trigger
language plpgsql
as $$
begin
  if new.manufacturer_code is null then
    new.manufacturer_code = public.generate_prefixed_code('MFR', 'public.manufacturer_hid_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_manufacturers_set_codes on public.manufacturers;
create trigger trg_manufacturers_set_codes
before insert on public.manufacturers
for each row execute function public.set_manufacturer_codes();

drop trigger if exists trg_manufacturers_updated_at on public.manufacturers;
create trigger trg_manufacturers_updated_at
before update on public.manufacturers
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  brand_code text unique,
  manufacturer_id uuid references public.manufacturers(id) on update cascade on delete set null,
  brand_name text not null,
  description text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (manufacturer_id, brand_name)
);

create or replace function public.set_brand_codes()
returns trigger
language plpgsql
as $$
begin
  if new.brand_code is null then
    new.brand_code = public.generate_prefixed_code('BRD', 'public.brand_hid_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_brands_set_codes on public.brands;
create trigger trg_brands_set_codes
before insert on public.brands
for each row execute function public.set_brand_codes();

drop trigger if exists trg_brands_updated_at on public.brands;
create trigger trg_brands_updated_at
before update on public.brands
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.asset_types (
  id uuid primary key default gen_random_uuid(),
  type_code text unique,
  type_name text not null unique,
  asset_group text not null check (asset_group in ('active', 'passive')),
  description text,
  specification_schema jsonb not null default '{}'::jsonb,
  default_tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_asset_type_codes()
returns trigger
language plpgsql
as $$
begin
  if new.type_code is null then
    new.type_code = public.generate_prefixed_code('TYP', 'public.asset_type_hid_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_asset_types_set_codes on public.asset_types;
create trigger trg_asset_types_set_codes
before insert on public.asset_types
for each row execute function public.set_asset_type_codes();

drop trigger if exists trg_asset_types_updated_at on public.asset_types;
create trigger trg_asset_types_updated_at
before update on public.asset_types
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.asset_models (
  id uuid primary key default gen_random_uuid(),
  model_code text unique,
  model_name text not null,
  asset_type_id uuid references public.asset_types(id) on update cascade on delete set null,
  brand_id uuid references public.brands(id) on update cascade on delete set null,
  manufacturer_id uuid references public.manufacturers(id) on update cascade on delete set null,
  description text,
  specification_template jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_asset_model_codes()
returns trigger
language plpgsql
as $$
begin
  if new.model_code is null then
    new.model_code = public.generate_prefixed_code('MOD', 'public.asset_model_hid_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_asset_models_set_codes on public.asset_models;
create trigger trg_asset_models_set_codes
before insert on public.asset_models
for each row execute function public.set_asset_model_codes();

drop trigger if exists trg_asset_models_updated_at on public.asset_models;
create trigger trg_asset_models_updated_at
before update on public.asset_models
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.pops (
  id uuid primary key default gen_random_uuid(),
  pop_id text unique,
  pop_name text not null,
  pop_code text not null unique check (pop_code ~ '^[A-Z]{3}$'),
  longitude numeric(10,7),
  latitude numeric(10,7),
  tags text[] not null default '{}',
  region_id uuid not null references public.regions(id) on update cascade on delete restrict,
  support_doc jsonb not null default '{}'::jsonb,
  address text,
  province text,
  city text,
  status_pop text not null default 'planning' check (status_pop in ('planning', 'active', 'inactive', 'maintenance')),
  validation_status text not null default 'unvalidated' check (validation_status in ('unvalidated', 'valid', 'warning', 'invalid')),
  validation_date date,
  tenant text,
  tanggal_pop_aktif date,
  image_attachment_id uuid,
  image_attachments jsonb not null default '[]'::jsonb,
  pln_cid_number text,
  pln_payment_method text,
  pln_phase text,
  pln_wattage integer,
  pop_type text,
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_pops_image_attachments_json check (jsonb_typeof(image_attachments) = 'array'),
  constraint chk_pops_image_attachments_max_10 check (jsonb_array_length(image_attachments) <= 10)
);

create or replace function public.set_pop_codes()
returns trigger
language plpgsql
as $$
declare
  candidate_pop_id text;
begin
  new.pop_code := upper(trim(coalesce(new.pop_code, '')));

  if new.pop_code = '' then
    raise exception 'pop_code is required (exactly 3 letters)';
  end if;

  if new.pop_code !~ '^[A-Z]{3}$' then
    raise exception 'pop_code must be exactly 3 letters (A-Z)';
  end if;

  if new.pop_id is null then
    loop
      candidate_pop_id := public.generate_inventory_code('POP', 7);
      exit when not exists (select 1 from public.pops p where p.pop_id = candidate_pop_id);
    end loop;
    new.pop_id := candidate_pop_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_pops_set_codes on public.pops;
create trigger trg_pops_set_codes
before insert on public.pops
for each row execute function public.set_pop_codes();

drop trigger if exists trg_pops_updated_at on public.pops;
create trigger trg_pops_updated_at
before update on public.pops
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  project_id text unique,
  project_code text unique,
  project_name text not null,
  description text,
  status text not null default 'planning' check (status in ('planning', 'running', 'done', 'hold', 'cancelled')),
  region_id uuid not null references public.regions(id) on update cascade on delete restrict,
  pop_id uuid references public.pops(id) on update cascade on delete set null,
  bast_number text,
  spk_number text,
  vendor_name text,
  start_date date,
  end_date date,
  budget_value numeric(16,2),
  tags text[] not null default '{}',
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_project_codes()
returns trigger
language plpgsql
as $$
begin
  if new.project_id is null then
    new.project_id = public.generate_prefixed_code('PRJ', 'public.project_hid_seq');
  end if;
  if new.project_code is null then
    new.project_code = public.generate_prefixed_code('PJC', 'public.project_hid_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_projects_set_codes on public.projects;
create trigger trg_projects_set_codes
before insert on public.projects
for each row execute function public.set_project_codes();

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at
before update on public.projects
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.poles (
  id uuid primary key default gen_random_uuid(),
  pole_id text unique,
  pole_code text unique,
  pole_number text not null,
  condition_status text not null default 'good' check (condition_status in ('good', 'warning', 'critical')),
  owner_name text,
  height_meters numeric(6,2),
  longitude numeric(10,7),
  latitude numeric(10,7),
  address text,
  region_id uuid not null references public.regions(id) on update cascade on delete restrict,
  pop_id uuid references public.pops(id) on update cascade on delete set null,
  project_id uuid references public.projects(id) on update cascade on delete set null,
  installation_date date,
  tags text[] not null default '{}',
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_pole_codes()
returns trigger
language plpgsql
as $$
begin
  if new.pole_id is null then
    new.pole_id = public.generate_prefixed_code('POL', 'public.pole_hid_seq');
  end if;
  if new.pole_code is null then
    new.pole_code = public.generate_prefixed_code('PLC', 'public.pole_hid_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_poles_set_codes on public.poles;
create trigger trg_poles_set_codes
before insert on public.poles
for each row execute function public.set_pole_codes();

drop trigger if exists trg_poles_updated_at on public.poles;
create trigger trg_poles_updated_at
before update on public.poles
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  customer_id text unique,
  customer_code text unique,
  customer_name text not null,
  customer_number text,
  service_type text,
  status text not null default 'prospect' check (status in ('prospect', 'active', 'suspend', 'inactive', 'terminated')),
  contact_name text,
  contact_phone text,
  email text,
  longitude numeric(10,7),
  latitude numeric(10,7),
  address text,
  region_id uuid not null references public.regions(id) on update cascade on delete restrict,
  pop_id uuid references public.pops(id) on update cascade on delete set null,
  project_id uuid references public.projects(id) on update cascade on delete set null,
  installation_date date,
  tags text[] not null default '{}',
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_customer_codes()
returns trigger
language plpgsql
as $$
begin
  if new.customer_id is null then
    new.customer_id = public.generate_prefixed_code('CUS', 'public.customer_hid_seq');
  end if;
  if new.customer_code is null then
    new.customer_code = public.generate_prefixed_code('CSC', 'public.customer_hid_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_customers_set_codes on public.customers;
create trigger trg_customers_set_codes
before insert on public.customers
for each row execute function public.set_customer_codes();

drop trigger if exists trg_customers_updated_at on public.customers;
create trigger trg_customers_updated_at
before update on public.customers
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  device_id text unique,
  device_code text unique,
  device_name text not null,
  asset_group text not null check (asset_group in ('active', 'passive')),
  device_type_key text not null,
  longitude numeric(10,7),
  latitude numeric(10,7),
  address text,
  region_id uuid not null references public.regions(id) on update cascade on delete restrict,
  pop_id uuid references public.pops(id) on update cascade on delete set null,
  project_id uuid references public.projects(id) on update cascade on delete set null,
  customer_id uuid references public.customers(id) on update cascade on delete set null,
  category_asset text,
  bast_id text,
  status text not null default 'draft' check (status in ('draft', 'installed', 'active', 'inactive', 'maintenance', 'retired')),
  manufacturer_id uuid references public.manufacturers(id) on update cascade on delete set null,
  brand_id uuid references public.brands(id) on update cascade on delete set null,
  model_id uuid references public.asset_models(id) on update cascade on delete set null,
  serial_number text,
  management_ip inet,
  vlan integer,
  capacity_core integer check (capacity_core is null or capacity_core >= 0),
  used_core integer check (used_core is null or used_core >= 0),
  total_ports integer check (total_ports is null or total_ports >= 0),
  used_ports integer check (used_ports is null or used_ports >= 0),
  splitter_ratio text,
  image_attachment_id uuid,
  image_attachments jsonb not null default '[]'::jsonb,
  installation_date date,
  last_seen_at timestamptz,
  validation_status text not null default 'unvalidated' check (validation_status in ('unvalidated', 'valid', 'warning', 'invalid')),
  validation_date date,
  last_validation_at timestamptz,
  monitoring_enabled boolean not null default true,
  notes text,
  tags text[] not null default '{}',
  specifications jsonb not null default '{}'::jsonb,
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_devices_image_attachments_json check (jsonb_typeof(image_attachments) = 'array'),
  constraint chk_devices_image_attachments_max_10 check (jsonb_array_length(image_attachments) <= 10),
  constraint chk_device_core_usage check (capacity_core is null or used_core is null or used_core <= capacity_core),
  constraint chk_device_port_usage check (total_ports is null or used_ports is null or used_ports <= total_ports)
);

create or replace function public.set_device_codes()
returns trigger
language plpgsql
as $$
declare
  prefix text;
  candidate_device_id text;
  candidate_device_code text;
begin
  prefix := upper(regexp_replace(coalesce(new.device_type_key, 'DEV'), '[^A-Za-z0-9]', '', 'g'));
  if prefix = '' then
    prefix := 'DEV';
  end if;
  if prefix in ('JOINTCLOSURE', 'JOINT', 'JCLOSURE') then
    prefix := 'JC';
  elsif prefix = 'SWITCH' then
    prefix := 'SWT';
  elsif prefix = 'ROUTER' then
    prefix := 'RTR';
  elsif prefix = 'CABLE' then
    prefix := 'CBL';
  elsif length(prefix) > 4 then
    prefix := left(prefix, 4);
  end if;

  if new.device_id is null then
    loop
      candidate_device_id := public.generate_inventory_code(prefix, 7);
      exit when not exists (select 1 from public.devices d where d.device_id = candidate_device_id);
    end loop;
    new.device_id := candidate_device_id;
  end if;

  if new.device_code is null then
    loop
      candidate_device_code := public.generate_inventory_code(prefix, 7);
      exit when not exists (select 1 from public.devices d where d.device_code = candidate_device_code);
    end loop;
    new.device_code := candidate_device_code;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_devices_set_codes on public.devices;
create trigger trg_devices_set_codes
before insert on public.devices
for each row execute function public.set_device_codes();

drop trigger if exists trg_devices_updated_at on public.devices;
create trigger trg_devices_updated_at
before update on public.devices
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.network_routes (
  id uuid primary key default gen_random_uuid(),
  route_id text unique,
  route_code text unique,
  route_name text not null,
  route_type text not null default 'distribution',
  status text not null default 'active' check (status in ('planning', 'active', 'maintenance', 'closed')),
  region_id uuid not null references public.regions(id) on update cascade on delete restrict,
  pop_id uuid references public.pops(id) on update cascade on delete set null,
  project_id uuid references public.projects(id) on update cascade on delete set null,
  start_asset_id uuid references public.devices(id) on update cascade on delete set null,
  end_asset_id uuid references public.devices(id) on update cascade on delete set null,
  distance_meters numeric(12,2),
  path_geojson jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}',
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_route_codes()
returns trigger
language plpgsql
as $$
begin
  if new.route_id is null then
    new.route_id = public.generate_prefixed_code('RTE', 'public.route_hid_seq');
  end if;
  if new.route_code is null then
    new.route_code = public.generate_prefixed_code('RTC', 'public.route_hid_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_routes_set_codes on public.network_routes;
create trigger trg_routes_set_codes
before insert on public.network_routes
for each row execute function public.set_route_codes();

drop trigger if exists trg_routes_updated_at on public.network_routes;
create trigger trg_routes_updated_at
before update on public.network_routes
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.device_links (
  id uuid primary key default gen_random_uuid(),
  link_id text unique default public.generate_prefixed_code('LNK', 'public.route_hid_seq'),
  region_id uuid not null references public.regions(id) on update cascade on delete restrict,
  from_device_id uuid not null references public.devices(id) on update cascade on delete cascade,
  to_device_id uuid not null references public.devices(id) on update cascade on delete cascade,
  link_type text not null default 'fiber',
  route_id uuid references public.network_routes(id) on update cascade on delete set null,
  cable_device_id uuid references public.devices(id) on update cascade on delete set null,
  core_start integer,
  core_end integer,
  fiber_count integer,
  status text not null default 'active' check (status in ('planning', 'active', 'inactive', 'cutover')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_device_links_updated_at on public.device_links;
create trigger trg_device_links_updated_at
before update on public.device_links
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.device_ports (
  id uuid primary key default gen_random_uuid(),
  port_id text unique default public.generate_prefixed_code('PRT', 'public.device_port_hid_seq'),
  region_id uuid not null references public.regions(id) on update cascade on delete restrict,
  device_id uuid not null references public.devices(id) on update cascade on delete cascade,
  port_index integer not null check (port_index > 0),
  port_label text,
  port_type text not null default 'ethernet' check (port_type in ('ethernet', 'pon', 'uplink', 'fiber', 'splitter', 'other')),
  direction text not null default 'bidirectional' check (direction in ('in', 'out', 'bidirectional')),
  status text not null default 'idle' check (status in ('idle', 'used', 'reserved', 'down', 'maintenance')),
  speed_profile text,
  core_capacity integer check (core_capacity is null or core_capacity >= 0),
  core_used integer check (core_used is null or core_used >= 0),
  splitter_ratio text,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, port_index),
  constraint chk_device_ports_core_usage check (core_capacity is null or core_used is null or core_used <= core_capacity)
);

drop trigger if exists trg_device_ports_updated_at on public.device_ports;
create trigger trg_device_ports_updated_at
before update on public.device_ports
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.port_connections (
  id uuid primary key default gen_random_uuid(),
  connection_id text unique default public.generate_prefixed_code('PCN', 'public.port_connection_hid_seq'),
  region_id uuid not null references public.regions(id) on update cascade on delete restrict,
  from_port_id uuid not null references public.device_ports(id) on update cascade on delete cascade,
  to_port_id uuid not null references public.device_ports(id) on update cascade on delete cascade,
  connection_type text not null default 'fiber' check (connection_type in ('fiber', 'patch', 'uplink', 'crossconnect', 'other')),
  status text not null default 'active' check (status in ('active', 'planned', 'inactive', 'cutover')),
  route_id uuid references public.network_routes(id) on update cascade on delete set null,
  cable_device_id uuid references public.devices(id) on update cascade on delete set null,
  core_start integer,
  core_end integer,
  fiber_count integer check (fiber_count is null or fiber_count >= 0),
  installed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_port_connections_not_same_port check (from_port_id <> to_port_id),
  constraint chk_port_connections_core_range check (
    (core_start is null and core_end is null)
    or (core_start is not null and core_end is not null and core_start > 0 and core_end >= core_start)
  )
);

drop trigger if exists trg_port_connections_updated_at on public.port_connections;
create trigger trg_port_connections_updated_at
before update on public.port_connections
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.core_management (
  id uuid primary key default gen_random_uuid(),
  core_id text unique,
  core_code text unique,
  cable_device_id uuid references public.devices(id) on update cascade on delete set null,
  route_id uuid references public.network_routes(id) on update cascade on delete set null,
  project_id uuid references public.projects(id) on update cascade on delete set null,
  region_id uuid not null references public.regions(id) on update cascade on delete restrict,
  pop_id uuid references public.pops(id) on update cascade on delete set null,
  from_device_id uuid references public.devices(id) on update cascade on delete set null,
  to_device_id uuid references public.devices(id) on update cascade on delete set null,
  tray_no integer,
  tube_no integer,
  core_no_start integer,
  core_no_end integer,
  core_count integer not null default 0,
  used_count integer not null default 0,
  reserved_count integer not null default 0,
  status text not null default 'available' check (status in ('available', 'partial', 'full', 'reserved', 'maintenance')),
  splice_info jsonb not null default '{}'::jsonb,
  notes text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_core_management_usage check (used_count + reserved_count <= core_count)
);

create or replace function public.set_core_codes()
returns trigger
language plpgsql
as $$
begin
  if new.core_id is null then
    new.core_id = public.generate_prefixed_code('COR', 'public.core_hid_seq');
  end if;
  if new.core_code is null then
    new.core_code = public.generate_prefixed_code('CRC', 'public.core_hid_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_core_management_set_codes on public.core_management;
create trigger trg_core_management_set_codes
before insert on public.core_management
for each row execute function public.set_core_codes();

drop trigger if exists trg_core_management_updated_at on public.core_management;
create trigger trg_core_management_updated_at
before update on public.core_management
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  attachment_id text unique default public.generate_prefixed_code('ATT', 'public.attachment_hid_seq'),
  bucket_id text not null,
  storage_file_id uuid,
  entity_type text,
  entity_id uuid,
  file_category text not null default 'document' check (file_category in ('image', 'kmz', 'kml', 'excel', 'document', 'evidence', 'map', 'other')),
  original_name text not null,
  stored_name text not null,
  mime_type text,
  extension text,
  size_bytes bigint,
  checksum text,
  is_public boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  uploaded_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_attachments_updated_at on public.attachments;
create trigger trg_attachments_updated_at
before update on public.attachments
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  import_job_id text unique default public.generate_prefixed_code('IMP', 'public.import_job_hid_seq'),
  entity_type text not null,
  source_format text not null check (source_format in ('kmz', 'kml', 'xlsx', 'xls', 'csv', 'json')),
  attachment_id uuid references public.attachments(id) on update cascade on delete set null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  total_rows integer not null default 0,
  success_rows integer not null default 0,
  failed_rows integer not null default 0,
  mapping_config jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_import_jobs_updated_at on public.import_jobs;
create trigger trg_import_jobs_updated_at
before update on public.import_jobs
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.import_rows (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references public.import_jobs(id) on update cascade on delete cascade,
  row_number integer not null,
  row_data jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'success', 'failed')),
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('region', 'pop', 'device', 'project', 'customer', 'route', 'pole')),
  region_id uuid references public.regions(id) on update cascade on delete set null,
  device_type_key text,
  pop_type text,
  field_key text not null,
  field_label text not null,
  field_type text not null check (field_type in ('text', 'textarea', 'number', 'boolean', 'date', 'datetime', 'select', 'multiselect', 'json')),
  options jsonb not null default '[]'::jsonb,
  is_required boolean not null default false,
  layout_span integer not null default 12 check (layout_span in (6, 12)),
  sort_order integer not null default 0,
  help_text text,
  default_value jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_type, region_id, device_type_key, pop_type, field_key)
);

drop trigger if exists trg_custom_field_definitions_updated_at on public.custom_field_definitions;
create trigger trg_custom_field_definitions_updated_at
before update on public.custom_field_definitions
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  user_code text unique default public.generate_prefixed_code('USR', 'public.user_hid_seq'),
  auth_user_id uuid not null unique references auth.users(id) on update cascade on delete cascade,
  full_name text not null,
  email text not null unique,
  role_name text not null check (role_name in ('admin', 'user_region', 'user_all_region')),
  default_region_id uuid references public.regions(id) on update cascade on delete set null,
  avatar_attachment_id uuid references public.attachments(id) on update cascade on delete set null,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_app_users_updated_at on public.app_users;
create trigger trg_app_users_updated_at
before update on public.app_users
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.user_region_scopes (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on update cascade on delete cascade,
  region_id uuid not null references public.regions(id) on update cascade on delete cascade,
  created_at timestamptz not null default now(),
  unique (app_user_id, region_id)
);

create table if not exists public.validation_records (
  id uuid primary key default gen_random_uuid(),
  validation_id text unique default public.generate_prefixed_code('VAL', 'public.validation_hid_seq'),
  entity_type text not null check (entity_type in ('device', 'pop', 'region', 'project', 'customer', 'route', 'pole', 'core_management')),
  entity_id uuid not null,
  validation_type text not null check (validation_type in ('field-audit', 'desk-review', 'photo-proof', 'geo-validation', 'commissioning')),
  status text not null check (status in ('valid', 'warning', 'invalid')),
  validated_at timestamptz not null default now(),
  validator_user_id uuid references public.app_users(id) on update cascade on delete set null,
  findings text,
  payload jsonb not null default '{}'::jsonb,
  evidence_attachment_id uuid references public.attachments(id) on update cascade on delete set null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_validation_records_updated_at on public.validation_records;
create trigger trg_validation_records_updated_at
before update on public.validation_records
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.monitoring_snapshots (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on update cascade on delete cascade,
  captured_at timestamptz not null default now(),
  status text not null check (status in ('online', 'offline', 'warning', 'critical')),
  cpu_usage numeric(5,2),
  memory_usage numeric(5,2),
  rx_power numeric(10,2),
  tx_power numeric(10,2),
  temperature numeric(10,2),
  latency_ms numeric(10,2),
  packet_loss numeric(5,2),
  uptime_seconds bigint,
  payload jsonb not null default '{}'::jsonb
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.app_users(id) on update cascade on delete set null,
  action_name text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_pops_region_id on public.pops(region_id);
create index if not exists idx_projects_region_id on public.projects(region_id);
create index if not exists idx_projects_pop_id on public.projects(pop_id);
create index if not exists idx_poles_region_id on public.poles(region_id);
create index if not exists idx_customers_region_id on public.customers(region_id);
create index if not exists idx_devices_region_id on public.devices(region_id);
create index if not exists idx_devices_pop_id on public.devices(pop_id);
create index if not exists idx_devices_project_id on public.devices(project_id);
create index if not exists idx_devices_customer_id on public.devices(customer_id);
create index if not exists idx_devices_type_key on public.devices(device_type_key);
create index if not exists idx_routes_region_id on public.network_routes(region_id);
create index if not exists idx_device_links_region_id on public.device_links(region_id);
create index if not exists idx_device_links_from_to on public.device_links(from_device_id, to_device_id);
create index if not exists idx_device_ports_region_id on public.device_ports(region_id);
create index if not exists idx_device_ports_device_id on public.device_ports(device_id);
create index if not exists idx_port_connections_region_id on public.port_connections(region_id);
create index if not exists idx_port_connections_from_to on public.port_connections(from_port_id, to_port_id);
create index if not exists idx_core_management_region_id on public.core_management(region_id);
create index if not exists idx_monitoring_snapshots_device_captured on public.monitoring_snapshots(device_id, captured_at desc);
create index if not exists idx_validation_records_entity on public.validation_records(entity_type, entity_id);
create index if not exists idx_import_rows_job_id on public.import_rows(import_job_id);
create index if not exists idx_custom_field_definitions_entity_scope on public.custom_field_definitions(entity_type, region_id, device_type_key, pop_type, is_active);
create index if not exists idx_app_users_avatar_attachment_id on public.app_users(avatar_attachment_id);
create index if not exists idx_regions_tags on public.regions using gin(tags);
create index if not exists idx_pops_tags on public.pops using gin(tags);
create index if not exists idx_devices_tags on public.devices using gin(tags);
create index if not exists idx_projects_tags on public.projects using gin(tags);
create index if not exists idx_core_management_tags on public.core_management using gin(tags);

insert into public.regions (region_name, region_color, description)
values
  ('Banten', '#0F766E', 'Default region seed'),
  ('Jabodebek', '#1D4ED8', 'Default region seed'),
  ('Jawa Barat', '#16A34A', 'Default region seed'),
  ('Jawa Tengah', '#CA8A04', 'Default region seed'),
  ('Jawa Timur', '#DC2626', 'Default region seed'),
  ('Sulawesi', '#7C3AED', 'Default region seed'),
  ('Bali', '#EA580C', 'Default region seed')
on conflict (region_name) do nothing;

insert into public.asset_types (type_name, asset_group, description, specification_schema)
values
  ('OLT', 'active', 'Optical Line Terminal', '{"fields":[{"key":"pon_ports","type":"number"},{"key":"uplink_ports","type":"number"}]}'::jsonb),
  ('SWITCH', 'active', 'Network switch', '{"fields":[{"key":"port_count","type":"number"},{"key":"uplink_type","type":"text"}]}'::jsonb),
  ('ROUTER', 'active', 'Core or edge router', '{"fields":[{"key":"throughput_gbps","type":"number"},{"key":"wan_count","type":"number"}]}'::jsonb),
  ('ONT', 'active', 'Optical network terminal', '{"fields":[{"key":"subscriber_ports","type":"number"}]}'::jsonb),
  ('OTB', 'passive', 'Optical termination box', '{"fields":[{"key":"tray_count","type":"number"},{"key":"capacity_core","type":"number"}]}'::jsonb),
  ('JC', 'passive', 'Joint closure', '{"fields":[{"key":"closure_type","type":"text"},{"key":"capacity_core","type":"number"}]}'::jsonb),
  ('ODC', 'passive', 'Optical distribution cabinet', '{"fields":[{"key":"splitter_slots","type":"number"},{"key":"port_capacity","type":"number"}]}'::jsonb),
  ('ODP', 'passive', 'Optical distribution point', '{"fields":[{"key":"splitter_ratio","type":"text"},{"key":"port_capacity","type":"number"}]}'::jsonb)
on conflict (type_name) do nothing;
