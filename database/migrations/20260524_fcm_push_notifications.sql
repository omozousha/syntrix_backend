-- FCM push tokens and durable notification inbox.

create table if not exists public.user_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on update cascade on delete cascade,
  token text not null,
  platform text not null default 'android',
  device_id text,
  app_version text,
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_user_push_tokens_token unique (token),
  constraint chk_user_push_tokens_platform check (platform in ('android', 'ios', 'web'))
);

drop trigger if exists trg_user_push_tokens_updated_at on public.user_push_tokens;
create trigger trg_user_push_tokens_updated_at
before update on public.user_push_tokens
for each row execute function public.set_current_timestamp_updated_at();

create index if not exists idx_user_push_tokens_user_active
  on public.user_push_tokens(user_id, is_active, last_seen_at desc);

create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.app_users(id) on update cascade on delete cascade,
  notification_type text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  entity_type text,
  entity_id uuid,
  request_id uuid references public.validation_requests(id) on update cascade on delete set null,
  region_id uuid references public.regions(id) on update cascade on delete set null,
  read_at timestamptz,
  pushed_at timestamptz,
  push_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_app_notifications_updated_at on public.app_notifications;
create trigger trg_app_notifications_updated_at
before update on public.app_notifications
for each row execute function public.set_current_timestamp_updated_at();

create index if not exists idx_app_notifications_recipient_created
  on public.app_notifications(recipient_user_id, created_at desc);

create index if not exists idx_app_notifications_unread
  on public.app_notifications(recipient_user_id, read_at)
  where read_at is null;

create index if not exists idx_app_notifications_region_type
  on public.app_notifications(region_id, notification_type, created_at desc);
