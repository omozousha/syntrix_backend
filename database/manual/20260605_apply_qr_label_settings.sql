-- Manual QR label settings apply script.
-- Use this file when production database has not received the migration yet.
-- Safe to run more than once.

create table if not exists public.qr_label_settings (
  id uuid primary key default gen_random_uuid(),
  setting_key text not null unique default 'default',
  qr_logo_attachment_id uuid references public.attachments(id) on update cascade on delete set null,
  footer_text text not null default 'Scan QR untuk membuka detail/validasi Device',
  is_active boolean not null default true,
  updated_by_user_id uuid references public.app_users(id) on update cascade on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_qr_label_settings_key check (setting_key = 'default')
);

drop trigger if exists trg_qr_label_settings_updated_at on public.qr_label_settings;
create trigger trg_qr_label_settings_updated_at
before update on public.qr_label_settings
for each row execute function public.set_current_timestamp_updated_at();

create index if not exists idx_qr_label_settings_active
  on public.qr_label_settings(setting_key, is_active);

insert into public.qr_label_settings (setting_key, footer_text, is_active)
values ('default', 'Scan QR untuk membuka detail/validasi Device', true)
on conflict (setting_key) do nothing;

-- Verification result should show:
-- qr_label_settings_table = qr_label_settings
-- default_setting_exists = true
select
  to_regclass('public.qr_label_settings') as qr_label_settings_table,
  exists (
    select 1
    from public.qr_label_settings
    where setting_key = 'default'
  ) as default_setting_exists;
