-- Master Data Synchronization — Route Type Seed Enrichment
-- Tambah route types sesuai Section 11 master-data-topology-synchronization-plan.md

insert into public.route_types (route_type_code, route_type_name, description, sort_order)
values
  ('FEEDER', 'Feeder', 'OTB/POP to ODC', 20),
  ('BRANCH', 'Branch', 'JC to ODP', 40),
  ('DROP', 'Drop', 'ODP to customer ONT', 50),
  ('UPLINK', 'Uplink', 'Active device upstream relation', 60),
  ('PATCH', 'Patch', 'Short local patch relation', 70)
on conflict (route_type_code) do update
set
  route_type_name = excluded.route_type_name,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

-- Backfill route_type_code untuk records yang pakai route_type_name sebagai code
update public.route_types
set route_type_code = upper(route_type_name)
where route_type_code is null or route_type_code = '';
