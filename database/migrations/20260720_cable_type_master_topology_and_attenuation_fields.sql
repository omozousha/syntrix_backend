-- Master Data Synchronization Slice 4
-- Extend Cable Type Master with role, core count, and attenuation overrides

alter table public.cable_types
  add column if not exists cable_role text,
  add column if not exists core_count integer,
  add column if not exists attenuation_1310_db_per_km numeric(8,3),
  add column if not exists attenuation_1490_db_per_km numeric(8,3),
  add column if not exists attenuation_1550_db_per_km numeric(8,3);

alter table public.cable_types
  drop constraint if exists cable_types_cable_role_check,
  add constraint cable_types_cable_role_check check (
    cable_role is null or cable_role in ('feeder', 'distribution', 'branch', 'drop')
  );

alter table public.cable_types
  drop constraint if exists cable_types_core_count_check,
  add constraint cable_types_core_count_check check (
    core_count is null or core_count >= 0
  );

alter table public.cable_types
  drop constraint if exists cable_types_att_1310_check,
  add constraint cable_types_att_1310_check check (
    attenuation_1310_db_per_km is null or attenuation_1310_db_per_km >= 0
  );

alter table public.cable_types
  drop constraint if exists cable_types_att_1490_check,
  add constraint cable_types_att_1490_check check (
    attenuation_1490_db_per_km is null or attenuation_1490_db_per_km >= 0
  );

alter table public.cable_types
  drop constraint if exists cable_types_att_1550_check,
  add constraint cable_types_att_1550_check check (
    attenuation_1550_db_per_km is null or attenuation_1550_db_per_km >= 0
  );

comment on column public.cable_types.cable_role is 'Topology role for this cable type: feeder/distribution/branch/drop.';
comment on column public.cable_types.core_count is 'Default fiber core count suggested by this cable type.';
comment on column public.cable_types.attenuation_1310_db_per_km is 'Link budget attenuation override at 1310 nm.';
comment on column public.cable_types.attenuation_1490_db_per_km is 'Link budget attenuation override at 1490 nm.';
comment on column public.cable_types.attenuation_1550_db_per_km is 'Link budget attenuation override at 1550 nm.';

-- Conservative backfill: preserve semantics where obvious, leave uncertain values null.
update public.cable_types
set
  cable_role = case upper(coalesce(cable_type_code, ''))
    when 'DROP' then 'drop'
    else cable_role
  end,
  core_count = case upper(coalesce(cable_type_code, ''))
    when 'DROP' then coalesce(core_count, 1)
    else core_count
  end,
  attenuation_1310_db_per_km = coalesce(attenuation_1310_db_per_km, 0.35),
  attenuation_1490_db_per_km = coalesce(attenuation_1490_db_per_km, 0.25),
  attenuation_1550_db_per_km = coalesce(attenuation_1550_db_per_km, 0.25)
where deleted_at is null or deleted_at is null;
