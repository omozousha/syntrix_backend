-- Master tenant catalog for device ownership / tenancy.

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  tenant_code text unique,
  tenant_name text not null unique,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  deleted_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_tenants_updated_at on public.tenants;
create trigger trg_tenants_updated_at
before update on public.tenants
for each row execute function public.set_current_timestamp_updated_at();

alter table if exists public.devices
  add column if not exists tenant_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'devices_tenant_id_fkey'
  ) then
    alter table public.devices
      add constraint devices_tenant_id_fkey
      foreign key (tenant_id) references public.tenants(id) on update cascade on delete set null;
  end if;
end
$$;

create index if not exists idx_tenants_active
  on public.tenants(is_active, sort_order, tenant_name);

create index if not exists idx_tenants_deleted_at
  on public.tenants(deleted_at);

create index if not exists idx_devices_tenant_id
  on public.devices(tenant_id);
