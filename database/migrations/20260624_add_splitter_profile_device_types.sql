-- Migration: Add allowed_device_type_keys to splitter_profiles
-- Date: 2026-06-24
-- Tujuan: Memungkinkan setiap splitter profile menentukan device type mana yang bisa
-- menggunakan ratio tersebut (ODC, ODP, dan/atau OTB).
-- 
-- Cara pakai:
--   psql -h <host> -U <user> -d <database> -f 20260624_add_splitter_profile_device_types.sql
--   atau jalankan dari Hasura Console -> SQL

alter table public.splitter_profiles
add column if not exists allowed_device_type_keys text[]
not null default '{}';

comment on column public.splitter_profiles.allowed_device_type_keys is
'Device type keys yang diizinkan menggunakan splitter ratio ini. Contoh: {ODC, ODP} atau {ODP}. Array kosong = semua device type.';

-- Seed data: update existing splitter profiles dengan allowed_device_type_keys
-- Default mapping berdasarkan ratio yang umum dipakai di lapangan:
--   1:2, 1:4, 1:8 → ODC + ODP
--   1:16 → ODP
--   Lainnya → semua device type (array kosong)

update public.splitter_profiles
set allowed_device_type_keys = array['ODC', 'ODP']
where lower(trim(ratio_label)) in ('1:2', '1:4', '1:8')
  and is_active = true
  and allowed_device_type_keys = '{}';

update public.splitter_profiles
set allowed_device_type_keys = array['ODP']
where lower(trim(ratio_label)) = '1:16'
  and is_active = true
  and allowed_device_type_keys = '{}';
