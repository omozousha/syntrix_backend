-- Link budget foundation for fiber topology Phase 4.
--
-- Master data tables:
--   link_budget_parameters    — global defaults (GPON B+/C+ budget, engineering margin defaults)
--   link_budget_estimates     — per-device calculated + measured optical loss (one row per device)
--
-- Storage fields are intentionally narrow so the API and the future
-- Master Data page can read and write them without breaking other modules.
--
-- Idempotent: safe to re-run.

create sequence if not exists public.link_budget_parameter_hid_seq start 1;

create table if not exists public.link_budget_parameters (
  id uuid primary key default gen_random_uuid(),
  parameter_id text unique default public.generate_prefixed_code('LBP', 'public.link_budget_parameter_hid_seq'),
  parameter_key text not null unique,
  parameter_label text not null,
  parameter_value numeric(8,3) not null,
  unit text not null default 'dB',
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_link_budget_parameter_value_non_negative check (parameter_value >= 0)
);

drop trigger if exists trg_link_budget_parameters_updated_at on public.link_budget_parameters;
create trigger trg_link_budget_parameters_updated_at
before update on public.link_budget_parameters
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.link_budget_estimates (
  id uuid primary key default gen_random_uuid(),
  estimate_id text unique default public.generate_prefixed_code('LBE', 'public.link_budget_parameter_hid_seq'),
  device_id uuid not null unique references public.devices(id) on update cascade on delete cascade,
  region_id uuid not null references public.regions(id) on update cascade on delete restrict,
  calculated_loss_db numeric(8,3),
  measured_loss_db numeric(8,3),
  ont_rx_power_dbm numeric(8,3),
  olt_tx_power_dbm numeric(8,3),
  engineering_margin_db numeric(8,3) not null default 3.0,
  measurement_date date,
  measurement_method text check (measurement_method is null or measurement_method in ('otdr', 'power_meter', 'manual', 'estimate')),
  evidence_attachment_id uuid references public.attachments(id) on update cascade on delete set null,
  gpon_class text check (gpon_class is null or gpon_class in ('B_plus', 'C_plus')),
  gpon_budget_db numeric(8,3),
  warnings jsonb not null default '[]'::jsonb,
  notes text,
  updated_by_user_id uuid references public.app_users(id) on update cascade on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_link_budget_loss_non_negative check (
    calculated_loss_db is null
    or measured_loss_db is null
    or (calculated_loss_db >= 0 and measured_loss_db >= 0)
  )
);

drop trigger if exists trg_link_budget_estimates_updated_at on public.link_budget_estimates;
create trigger trg_link_budget_estimates_updated_at
before update on public.link_budget_estimates
for each row execute function public.set_current_timestamp_updated_at();

create index if not exists idx_link_budget_estimates_region_id
  on public.link_budget_estimates(region_id);

create index if not exists idx_link_budget_estimates_gpon_class
  on public.link_budget_estimates(gpon_class)
  where gpon_class is not null;

-- Idempotent default parameter seeds.
insert into public.link_budget_parameters (parameter_key, parameter_label, parameter_value, unit, description, sort_order)
values
  ('gpon_class_b_plus_budget', 'GPON Class B+ budget', 28.0, 'dB', 'Maximum optical loss for GPON Class B+ ONTs', 10),
  ('gpon_class_c_plus_budget', 'GPON Class C+ budget', 32.0, 'dB', 'Maximum optical loss for GPON Class C+ ONTs', 20),
  ('engineering_margin', 'Default engineering margin', 3.0, 'dB', 'Safety margin added to calculated loss', 30),
  ('fusion_splice_loss', 'Default fusion splice loss', 0.10, 'dB', 'Loss per fusion splice on a path', 40),
  ('connector_pair_loss', 'Default connector pair loss', 0.30, 'dB', 'Loss per connector/adaptor pair on a path', 50),
  ('fiber_attenuation_1310', 'Fiber attenuation 1310 nm', 0.35, 'dB/km', 'Attenuation at 1310 nm wavelength', 60),
  ('fiber_attenuation_1490', 'Fiber attenuation 1490 nm', 0.25, 'dB/km', 'Attenuation at 1490 nm wavelength', 70),
  ('fiber_attenuation_1550', 'Fiber attenuation 1550 nm', 0.25, 'dB/km', 'Attenuation at 1550 nm wavelength', 80)
on conflict (parameter_key) do update
set
  parameter_label = excluded.parameter_label,
  parameter_value = excluded.parameter_value,
  unit = excluded.unit,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();
