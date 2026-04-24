-- Soft delete columns for master data tables.
-- Purpose: allow safe "delete" (archive) without physical row removal.

alter table if exists public.regions
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user_id uuid;

alter table if exists public.device_type_catalog
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user_id uuid;

alter table if exists public.pop_types
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user_id uuid;

alter table if exists public.manufacturers
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user_id uuid;

alter table if exists public.brands
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user_id uuid;

alter table if exists public.asset_models
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user_id uuid;

alter table if exists public.provinces
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user_id uuid;

alter table if exists public.cities
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user_id uuid;

create index if not exists idx_regions_deleted_at on public.regions(deleted_at);
create index if not exists idx_device_type_catalog_deleted_at on public.device_type_catalog(deleted_at);
create index if not exists idx_pop_types_deleted_at on public.pop_types(deleted_at);
create index if not exists idx_manufacturers_deleted_at on public.manufacturers(deleted_at);
create index if not exists idx_brands_deleted_at on public.brands(deleted_at);
create index if not exists idx_asset_models_deleted_at on public.asset_models(deleted_at);
create index if not exists idx_provinces_deleted_at on public.provinces(deleted_at);
create index if not exists idx_cities_deleted_at on public.cities(deleted_at);
