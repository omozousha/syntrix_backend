-- Master Data Synchronization — Splitter Profile allowed_device_type_keys enrichment
-- Update 1:32 dan 1:64 yang sebelumnya tidak punya allowed_device_type_keys.

update public.splitter_profiles
set allowed_device_type_keys = array['ODC']
where lower(trim(ratio_label)) = '1:32'
  and is_active = true
  and (allowed_device_type_keys = '{}' or allowed_device_type_keys is null);

update public.splitter_profiles
set allowed_device_type_keys = array['ODC']
where lower(trim(ratio_label)) = '1:64'
  and is_active = true
  and (allowed_device_type_keys = '{}' or allowed_device_type_keys is null);
