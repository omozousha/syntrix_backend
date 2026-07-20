-- Master Data Synchronization Slice 1
-- Add Device Type Master topology/configuration fields so frontend/backend
-- behavior can start moving away from hardcoded rules.

alter table public.device_type_catalog
  add column if not exists topology_role text,
  add column if not exists is_passive boolean not null default false,
  add column if not exists is_active_device boolean not null default false,
  add column if not exists supports_ports boolean not null default false,
  add column if not exists supports_splitter boolean not null default false,
  add column if not exists supports_core_management boolean not null default false,
  add column if not exists supports_joint_closure boolean not null default false,
  add column if not exists layout_type text,
  add column if not exists default_front_label text,
  add column if not exists default_rear_label text,
  add column if not exists is_assignable boolean not null default false;

alter table public.device_type_catalog
  drop constraint if exists device_type_catalog_topology_role_check,
  add constraint device_type_catalog_topology_role_check check (
    topology_role is null or topology_role in (
      'source_active',
      'termination_panel',
      'distribution_point',
      'access_point',
      'splice_point',
      'physical_cable',
      'customer_endpoint',
      'network_active',
      'civil_structure'
    )
  );

alter table public.device_type_catalog
  drop constraint if exists device_type_catalog_layout_type_check,
  add constraint device_type_catalog_layout_type_check check (
    layout_type is null or layout_type in (
      'tray',
      'tube',
      'core_grid',
      'odp_operations',
      'olt_slot',
      'switch_grid',
      'summary_only'
    )
  );

comment on column public.device_type_catalog.topology_role is 'Master Data topology behavior role.';
comment on column public.device_type_catalog.is_passive is 'Boolean passive/active classification mirror for configuration logic.';
comment on column public.device_type_catalog.is_active_device is 'True for active devices such as OLT/SWITCH/ROUTER/ONT.';
comment on column public.device_type_catalog.supports_ports is 'Enable port management / port UI for this device type.';
comment on column public.device_type_catalog.supports_splitter is 'Enable splitter fields and planning logic.';
comment on column public.device_type_catalog.supports_core_management is 'Enable core/tube/tray management.';
comment on column public.device_type_catalog.supports_joint_closure is 'Enable JC-specific splice/pass-through behavior.';
comment on column public.device_type_catalog.layout_type is 'Frontend detail layout selector.';
comment on column public.device_type_catalog.default_front_label is 'Default UI wording for upstream/front relation.';
comment on column public.device_type_catalog.default_rear_label is 'Default UI wording for downstream/rear relation.';
comment on column public.device_type_catalog.is_assignable is 'Enables assignment drawer and topology interaction.';

-- Backfill existing canonical device types with sensible defaults.
update public.device_type_catalog
set
  topology_role = case upper(device_type_key)
    when 'OLT' then 'source_active'
    when 'OTB' then 'termination_panel'
    when 'ODC' then 'distribution_point'
    when 'ODP' then 'access_point'
    when 'JC' then 'splice_point'
    when 'CABLE' then 'physical_cable'
    when 'ONT' then 'customer_endpoint'
    when 'SWITCH' then 'network_active'
    when 'ROUTER' then 'network_active'
    when 'HH' then 'civil_structure'
    when 'MH' then 'civil_structure'
    else topology_role
  end,
  is_passive = case when asset_group = 'passive' then true else false end,
  is_active_device = case when upper(device_type_key) in ('OLT', 'SWITCH', 'ROUTER', 'ONT') then true else false end,
  supports_ports = case when upper(device_type_key) in ('OLT', 'OTB', 'ODC', 'ODP', 'SWITCH', 'ROUTER', 'ONT', 'JC', 'CABLE') then true else false end,
  supports_splitter = case when upper(device_type_key) in ('ODC', 'ODP') then true else false end,
  supports_core_management = case when upper(device_type_key) in ('OTB', 'ODC', 'JC', 'CABLE') then true else false end,
  supports_joint_closure = case when upper(device_type_key) = 'JC' then true else false end,
  layout_type = case upper(device_type_key)
    when 'OTB' then 'tray'
    when 'ODC' then 'tube'
    when 'JC' then 'tube'
    when 'CABLE' then 'core_grid'
    when 'ODP' then 'odp_operations'
    when 'OLT' then 'olt_slot'
    when 'SWITCH' then 'switch_grid'
    when 'HH' then 'summary_only'
    when 'MH' then 'summary_only'
    when 'ROUTER' then 'summary_only'
    else layout_type
  end,
  default_front_label = case upper(device_type_key)
    when 'ODC' then 'Hulu'
    when 'ODP' then 'Hulu'
    when 'OTB' then 'Hulu'
    when 'JC' then 'Hulu'
    when 'CABLE' then 'Hulu'
    else default_front_label
  end,
  default_rear_label = case upper(device_type_key)
    when 'ODC' then 'Hilir'
    when 'ODP' then 'Hilir'
    when 'OTB' then 'Hilir'
    when 'JC' then 'Hilir'
    when 'CABLE' then 'Hilir'
    else default_rear_label
  end,
  is_assignable = case when upper(device_type_key) in ('OTB', 'ODC', 'ODP', 'JC', 'CABLE') then true else false end
where deleted_at is null or deleted_at is null;
