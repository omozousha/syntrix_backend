-- Consolidate cable_category into route_type
-- cable_categories (feeder/distribution/backbone/drop) overlap with route_types
-- We use route_types as the canonical master data for cable categories.

-- 1. Add feeder and drop to route_types if not already present
insert into public.route_types (route_type_code, route_type_name, description, sort_order)
values
  ('FEEDER', 'Feeder', 'Kabel penghubung OTB/POP ke ODC', 5),
  ('DROP', 'Drop', 'Kabel penghubung ODP ke ONT pelanggan', 40)
on conflict (route_type_name) do nothing;

-- 2. Update existing route_type sort orders for consistency
update public.route_types set sort_order = 10 where route_type_code = 'BACKBONE' and sort_order <> 10;
update public.route_types set sort_order = 20 where route_type_code = 'DISTRIBUTION' and sort_order <> 20;
update public.route_types set sort_order = 30 where route_type_code = 'ACCESS' and sort_order <> 30;

-- 3. Migrate cable_category values to route_type for existing CABLE devices
--    cable_category mapping: feeder→FEEDER, distribution→DISTRIBUTION, backbone→BACKBONE, drop→DROP
update public.devices
set route_type = upper(cable_category)
where device_type_key = 'CABLE'
  and cable_category is not null
  and cable_category in ('feeder', 'distribution', 'backbone', 'drop')
  and (route_type is null or route_type = '');

-- 4. Drop cable_category column from devices
alter table public.devices drop column if exists cable_category;

-- 5. Drop cable_categories table
drop table if exists public.cable_categories;
