-- Add device_template_style and customer_patch_cord_style to qr_label_settings

alter table if exists public.qr_label_settings
  add column if not exists device_template_style text not null default 'default',
  add column if not exists customer_patch_cord_style text not null default 'plain';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_qr_label_settings_device_template_style'
  ) then
    alter table public.qr_label_settings
      add constraint chk_qr_label_settings_device_template_style
      check (device_template_style in ('default', 'hazard'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_qr_label_settings_customer_patch_cord_style'
  ) then
    alter table public.qr_label_settings
      add constraint chk_qr_label_settings_customer_patch_cord_style
      check (customer_patch_cord_style in ('plain', 'qr'));
  end if;
end $$;
