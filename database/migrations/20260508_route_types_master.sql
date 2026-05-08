-- Master route types for route creation.

create sequence if not exists public.route_type_hid_seq start 1;

create table if not exists public.route_types (
  id uuid primary key default gen_random_uuid(),
  route_type_id text unique default public.generate_prefixed_code('RTY', 'public.route_type_hid_seq'),
  route_type_code text unique,
  route_type_name text not null unique,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  deleted_by_user_id uuid references public.app_users(id) on update cascade on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_route_types_updated_at on public.route_types;
create trigger trg_route_types_updated_at
before update on public.route_types
for each row execute function public.set_current_timestamp_updated_at();

create index if not exists idx_route_types_active
  on public.route_types(is_active, sort_order, route_type_name);

insert into public.route_types (route_type_code, route_type_name, sort_order)
values
  ('BACKBONE', 'Backbone', 10),
  ('DISTRIBUTION', 'Distribution', 20),
  ('ACCESS', 'Access', 30)
on conflict (route_type_name) do nothing;
