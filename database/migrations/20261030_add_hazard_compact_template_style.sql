-- Add 'hazard_compact' to device_template_style check constraint
-- Migration: extends 20261029_add_template_styles_to_qr_label_settings.sql

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'chk_qr_label_settings_device_template_style'
  ) then
    alter table public.qr_label_settings
      drop constraint chk_qr_label_settings_device_template_style;
  end if;

  alter table public.qr_label_settings
    add constraint chk_qr_label_settings_device_template_style
    check (device_template_style in ('default', 'hazard', 'hazard_compact'));
end $$;
