-- Final ID audit for main entities.
-- Run in Hasura SQL Console to verify there is no legacy/non-standard ID left.

-- 1) Summary count per table
select 'pops.pop_id' as target, count(*) as invalid_count
from public.pops
where pop_id is null or pop_id !~ '^INV-POP-[A-Z0-9]{7}$'

union all

select 'devices.device_id' as target, count(*) as invalid_count
from public.devices
where device_id is null or device_id !~ '^INV-[A-Z0-9]{2,4}-[A-Z0-9]{7}$'

union all

select 'devices.device_code' as target, count(*) as invalid_count
from public.devices
where device_code is null or device_code !~ '^INV-[A-Z0-9]{2,4}-[A-Z0-9]{7}$'

union all

select 'projects.project_id' as target, count(*) as invalid_count
from public.projects
where project_id is null or project_id !~ '^PRJ-[0-9]+$'

union all

select 'customers.customer_id' as target, count(*) as invalid_count
from public.customers
where customer_id is null or customer_id !~ '^CUS-[0-9]+$'

union all

select 'poles.pole_id' as target, count(*) as invalid_count
from public.poles
where pole_id is null or pole_id !~ '^POL-[0-9]+$'

union all

select 'network_routes.route_id' as target, count(*) as invalid_count
from public.network_routes
where route_id is null or route_id !~ '^RTE-[0-9]+$'

union all

select 'core_management.core_id' as target, count(*) as invalid_count
from public.core_management
where core_id is null or core_id !~ '^COR-[0-9]+$';

-- 2) Detail rows (sample) for troubleshooting if any count > 0.
-- POP
select id, pop_id, pop_name
from public.pops
where pop_id is null or pop_id !~ '^INV-POP-[A-Z0-9]{7}$'
order by created_at desc
limit 50;

-- Devices
select id, device_type_key, device_id, device_code, device_name
from public.devices
where device_id is null
   or device_code is null
   or device_id !~ '^INV-[A-Z0-9]{2,4}-[A-Z0-9]{7}$'
   or device_code !~ '^INV-[A-Z0-9]{2,4}-[A-Z0-9]{7}$'
order by created_at desc
limit 50;

-- Projects
select id, project_id, project_name
from public.projects
where project_id is null or project_id !~ '^PRJ-[0-9]+$'
order by created_at desc
limit 50;

-- Customers
select id, customer_id, customer_name
from public.customers
where customer_id is null or customer_id !~ '^CUS-[0-9]+$'
order by created_at desc
limit 50;

-- Poles
select id, pole_id, pole_number
from public.poles
where pole_id is null or pole_id !~ '^POL-[0-9]+$'
order by created_at desc
limit 50;

-- Routes
select id, route_id, route_name
from public.network_routes
where route_id is null or route_id !~ '^RTE-[0-9]+$'
order by created_at desc
limit 50;

-- Core management
select id, core_id, core_code
from public.core_management
where core_id is null or core_id !~ '^COR-[0-9]+$'
order by created_at desc
limit 50;
