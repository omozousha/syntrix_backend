-- Validation approval workflow foundation (ODP first).

create sequence if not exists public.validation_request_hid_seq start 1;

create table if not exists public.validation_requests (
  id uuid primary key default gen_random_uuid(),
  request_id text unique default public.generate_prefixed_code('VRQ', 'public.validation_request_hid_seq'),
  entity_type text not null check (entity_type in ('device')),
  entity_id uuid not null references public.devices(id) on update cascade on delete cascade,
  region_id uuid not null references public.regions(id) on update cascade on delete restrict,
  submitted_by_user_id uuid not null references public.app_users(id) on update cascade on delete restrict,
  current_status text not null check (
    current_status in (
      'unvalidated',
      'ongoing_validated',
      'pending_async',
      'validated',
      'rejected_by_adminregion',
      'rejected_by_superadmin'
    )
  ) default 'ongoing_validated',
  payload_snapshot jsonb not null default '{}'::jsonb,
  evidence_attachments jsonb not null default '[]'::jsonb,
  checklist jsonb not null default '{}'::jsonb,
  finding_note text,
  adminregion_review_note text,
  superadmin_review_note text,
  approved_by_user_id uuid references public.app_users(id) on update cascade on delete set null,
  approved_at timestamptz,
  rejected_by_user_id uuid references public.app_users(id) on update cascade on delete set null,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_validation_requests_payload_object check (jsonb_typeof(payload_snapshot) = 'object'),
  constraint chk_validation_requests_evidence_array check (jsonb_typeof(evidence_attachments) = 'array'),
  constraint chk_validation_requests_checklist_object check (jsonb_typeof(checklist) = 'object'),
  constraint chk_validation_requests_reject_note_adminregion check (
    current_status <> 'rejected_by_adminregion'
    or length(trim(coalesce(adminregion_review_note, ''))) >= 10
  ),
  constraint chk_validation_requests_reject_note_superadmin check (
    current_status <> 'rejected_by_superadmin'
    or length(trim(coalesce(superadmin_review_note, ''))) >= 10
  )
);

drop trigger if exists trg_validation_requests_updated_at on public.validation_requests;
create trigger trg_validation_requests_updated_at
before update on public.validation_requests
for each row execute function public.set_current_timestamp_updated_at();

create index if not exists idx_validation_requests_entity
  on public.validation_requests(entity_type, entity_id);

create index if not exists idx_validation_requests_region_status
  on public.validation_requests(region_id, current_status, updated_at desc);

create unique index if not exists uq_validation_requests_active_entity
  on public.validation_requests(entity_type, entity_id)
  where current_status in ('ongoing_validated', 'pending_async');

create table if not exists public.validation_request_logs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.validation_requests(id) on update cascade on delete cascade,
  action_type text not null check (
    action_type in (
      'submitted',
      'resubmitted_by_validator',
      'approved_by_adminregion',
      'rejected_by_adminregion',
      'approved_by_superadmin',
      'rejected_by_superadmin',
      'resubmitted_by_adminregion',
      'applied_to_asset'
    )
  ),
  actor_user_id uuid not null references public.app_users(id) on update cascade on delete restrict,
  actor_role text,
  before_status text,
  after_status text,
  note text,
  payload_patch jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint chk_validation_request_logs_payload_patch_object check (jsonb_typeof(payload_patch) = 'object'),
  constraint chk_validation_request_logs_note_required_reject check (
    action_type not in ('rejected_by_adminregion', 'rejected_by_superadmin')
    or length(trim(coalesce(note, ''))) >= 10
  )
);

create index if not exists idx_validation_request_logs_request_created
  on public.validation_request_logs(request_id, created_at desc);

create index if not exists idx_validation_request_logs_action
  on public.validation_request_logs(action_type, created_at desc);

