-- Master Data Synchronization Slice 5
-- Add capacity_core and total_ports to asset_models so device create forms
-- can auto-fill capacity from asset model selection.

alter table public.asset_models
  add column if not exists capacity_core integer,
  add column if not exists total_ports integer;

alter table public.asset_models
  drop constraint if exists asset_models_capacity_core_check,
  add constraint asset_models_capacity_core_check check (
    capacity_core is null or capacity_core >= 0
  );

alter table public.asset_models
  drop constraint if exists asset_models_total_ports_check,
  add constraint asset_models_total_ports_check check (
    total_ports is null or total_ports >= 0
  );

comment on column public.asset_models.capacity_core is 'Default fiber core capacity for devices using this model.';
comment on column public.asset_models.total_ports is 'Default port count for devices using this model.';