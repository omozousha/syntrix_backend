-- Master service type catalog and customer location fields.

create table if not exists public.service_types (
  id uuid primary key default gen_random_uuid(),
  service_type_code text unique,
  service_type_name text not null unique,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  deleted_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_service_types_updated_at on public.service_types;
create trigger trg_service_types_updated_at
before update on public.service_types
for each row execute function public.set_current_timestamp_updated_at();

insert into public.service_types (service_type_code, service_type_name, description, sort_order)
values
  ('INTERNET', 'Internet', 'Broadband or dedicated internet service', 10),
  ('METRO', 'Metro Ethernet', 'Metro ethernet or L2 connectivity service', 20),
  ('DEDICATED', 'Dedicated Link', 'Dedicated point-to-point service', 30),
  ('VPN', 'VPN', 'Private network service', 40)
on conflict (service_type_name) do nothing;

alter table if exists public.customers
  add column if not exists service_type_id uuid,
  add column if not exists province text,
  add column if not exists province_id uuid,
  add column if not exists city text,
  add column if not exists city_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'customers_service_type_id_fkey'
  ) then
    alter table public.customers
      add constraint customers_service_type_id_fkey
      foreign key (service_type_id) references public.service_types(id) on update cascade on delete set null;
  end if;
end
$$;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'provinces')
     and not exists (select 1 from pg_constraint where conname = 'customers_province_id_fkey') then
    alter table public.customers
      add constraint customers_province_id_fkey
      foreign key (province_id) references public.provinces(id) on update cascade on delete set null;
  end if;
end
$$;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'cities')
     and not exists (select 1 from pg_constraint where conname = 'customers_city_id_fkey') then
    alter table public.customers
      add constraint customers_city_id_fkey
      foreign key (city_id) references public.cities(id) on update cascade on delete set null;
  end if;
end
$$;

update public.customers c
set service_type_id = st.id
from public.service_types st
where c.service_type_id is null
  and c.service_type is not null
  and trim(c.service_type) <> ''
  and (
    lower(trim(c.service_type)) = lower(st.service_type_name)
    or lower(trim(c.service_type)) = lower(st.service_type_code)
  );

create index if not exists idx_customers_service_type_id on public.customers(service_type_id);
create index if not exists idx_customers_province_id on public.customers(province_id);
create index if not exists idx_customers_city_id on public.customers(city_id);
create index if not exists idx_service_types_active on public.service_types(is_active, sort_order, service_type_name);
