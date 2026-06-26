-- Migration: Register RECTIFIER device type in device_type_catalog
-- Tipe perangkat: active
-- Tipe code: 014 (berurutan setelah JC '013')

insert into public.device_type_catalog
  (device_type_key, device_type_name, asset_group, inventory_type_code, description, sort_order, is_active)
values
  ('RECTIFIER', 'Rectifier', 'active', '014', 'Sistem Power Supply DC / Charger Battery', 140, true)
on conflict (device_type_key) do update
set
  device_type_name = excluded.device_type_name,
  asset_group = excluded.asset_group,
  inventory_type_code = excluded.inventory_type_code,
  description = coalesce(public.device_type_catalog.description, excluded.description),
  sort_order = excluded.sort_order,
  is_active = true;
