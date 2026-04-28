-- Add configurable Lucide icon names for device type catalog rows.

alter table if exists public.device_type_catalog
  add column if not exists icon_name text;

update public.device_type_catalog
set icon_name = case device_type_key
  when 'OLT' then 'Server'
  when 'SWITCH' then 'Network'
  when 'ROUTER' then 'Router'
  when 'ONT' then 'Monitor'
  when 'OTB' then 'Box'
  when 'JC' then 'Split'
  when 'ODC' then 'Boxes'
  when 'ODP' then 'RadioTower'
  when 'CABLE' then 'Cable'
  else coalesce(icon_name, 'HardDrive')
end
where icon_name is null;
