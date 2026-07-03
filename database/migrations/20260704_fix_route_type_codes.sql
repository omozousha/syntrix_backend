-- Fix route_type_code values to be consistent with allowed_route_type_keys in core_capacities
-- route_types are the canonical master data for cable categories.
-- Update codes: BB→BACKBONE, DIST→DISTRIBUTION, AC→ACCESS

-- 1. Update route_type_code values
update public.route_types set route_type_code = 'BACKBONE' where route_type_code = 'BB';
update public.route_types set route_type_code = 'DISTRIBUTION' where route_type_code = 'DIST';
update public.route_types set route_type_code = 'ACCESS' where route_type_code = 'AC';

-- 2. Ensure sort_order is consistent
update public.route_types set sort_order = 5 where route_type_code = 'FEEDER' and sort_order <> 5;
update public.route_types set sort_order = 10 where route_type_code = 'BACKBONE' and sort_order <> 10;
update public.route_types set sort_order = 20 where route_type_code = 'DISTRIBUTION' and sort_order <> 20;
update public.route_types set sort_order = 30 where route_type_code = 'ACCESS' and sort_order <> 30;
update public.route_types set sort_order = 40 where route_type_code = 'DROP' and sort_order <> 40;

-- 3. Update existing CABLE devices that have old route_type codes
update public.devices
set route_type = 'BACKBONE'
where device_type_key = 'CABLE'
  and route_type = 'BB';

update public.devices
set route_type = 'DISTRIBUTION'
where device_type_key = 'CABLE'
  and route_type = 'DIST';

update public.devices
set route_type = 'ACCESS'
where device_type_key = 'CABLE'
  and route_type = 'AC';
