-- Persist read/unread state for validation request notifications per user.

create table if not exists public.validation_request_reads (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.validation_requests(id) on update cascade on delete cascade,
  user_id uuid not null references public.app_users(id) on update cascade on delete cascade,
  read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_validation_request_reads_request_user unique (request_id, user_id)
);

drop trigger if exists trg_validation_request_reads_updated_at on public.validation_request_reads;
create trigger trg_validation_request_reads_updated_at
before update on public.validation_request_reads
for each row execute function public.set_current_timestamp_updated_at();

create index if not exists idx_validation_request_reads_user
  on public.validation_request_reads(user_id, read_at desc);

create index if not exists idx_validation_request_reads_request
  on public.validation_request_reads(request_id);

