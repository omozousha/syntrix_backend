-- Master Data Synchronization Slice 4b
-- Enrich canonical cable_types with cable_role and core_count.
-- Includes ALTER TABLE in case 20260720 has not been run yet.

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

update public.cable_types
set
  cable_role = case upper(coalesce(cable_type_code, ''))
    when 'SM'     then coalesce(cable_role, 'feeder')
    when 'MM'     then coalesce(cable_role, 'distribution')
    when 'ADSS'   then coalesce(cable_role, 'feeder')
    when 'OPGW'   then coalesce(cable_role, 'feeder')
    when 'DIRECT' then coalesce(cable_role, 'distribution')
    when 'INDOOR' then coalesce(cable_role, 'branch')
    when 'DROP'   then coalesce(cable_role, 'drop')
    else cable_role
  end,
  core_count = case upper(coalesce(cable_type_code, ''))
    when 'SM'     then coalesce(core_count, 24)
    when 'MM'     then coalesce(core_count, 12)
    when 'ADSS'   then coalesce(core_count, 24)
    when 'OPGW'   then coalesce(core_count, 24)
    when 'DIRECT' then coalesce(core_count, 12)
    when 'INDOOR' then coalesce(core_count, 2)
    when 'DROP'   then coalesce(core_count, 1)
    else core_count
  end,
  attenuation_1310_db_per_km = coalesce(attenuation_1310_db_per_km, 0.35),
  attenuation_1490_db_per_km = coalesce(attenuation_1490_db_per_km, 0.25),
  attenuation_1550_db_per_km = coalesce(attenuation_1550_db_per_km, 0.25)
where deleted_at is null;
