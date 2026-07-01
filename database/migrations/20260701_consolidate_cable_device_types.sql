-- Consolidate Cable Device Types
-- Dengan adanya cable_category (feeder, distribution, backbone, drop),
-- semua kabel cukup menggunakan 1 device type: CABLE
-- KABEL_BB, KABEL_AKSES_FEEDER, KABEL_DW dinonaktifkan

-- 1. Migrasi device existing: KABEL_BB -> CABLE (cable_category = 'backbone')
update public.devices
set
  device_type_key = 'CABLE',
  cable_category = 'backbone',
  updated_at = now()
where device_type_key = 'KABEL_BB';

-- 2. Migrasi device existing: KABEL_AKSES_FEEDER -> CABLE (cable_category = 'feeder')
update public.devices
set
  device_type_key = 'CABLE',
  cable_category = 'feeder',
  updated_at = now()
where device_type_key = 'KABEL_AKSES_FEEDER';

-- 3. Migrasi device existing: KABEL_DW -> CABLE (cable_category = 'drop')
update public.devices
set
  device_type_key = 'CABLE',
  cable_category = 'drop',
  updated_at = now()
where device_type_key = 'KABEL_DW';

-- 4. Nonaktifkan redundant device types di catalog
update public.device_type_catalog
set
  is_active = false,
  updated_at = now()
where device_type_key in ('KABEL_BB', 'KABEL_AKSES_FEEDER', 'KABEL_DW');

-- 5. Verifikasi: berapa device yang termigrasi?
-- select device_type_key, cable_category, count(*) as total
-- from public.devices
-- where device_type_key = 'CABLE'
-- group by device_type_key, cable_category
-- order by cable_category;
