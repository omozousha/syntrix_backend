-- Cable Types Master Data
-- Master table untuk tipe-tipe kabel fiber optik yang sebelumnya hardcoded di frontend

create sequence if not exists public.cable_type_hid_seq start 1;

create table if not exists public.cable_types (
  id uuid primary key default gen_random_uuid(),
  cable_type_id text unique default public.generate_prefixed_code('CTYP', 'public.cable_type_hid_seq'),
  cable_type_code text unique,
  cable_type_name text not null unique,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  deleted_by_user_id uuid references public.app_users(id) on update cascade on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_cable_types_updated_at on public.cable_types;
create trigger trg_cable_types_updated_at
before update on public.cable_types
for each row execute function public.set_current_timestamp_updated_at();

create index if not exists idx_cable_types_active
  on public.cable_types(is_active, sort_order, cable_type_name);

-- Seed data: standard fiber optic cable types
insert into public.cable_types (cable_type_code, cable_type_name, description, sort_order)
values
  ('SM',        'Single-mode (SM)',     'Single-mode fiber optic cable (G.652D) — standar untuk backbone dan feeder.', 1),
  ('MM',        'Multi-mode (MM)',      'Multi-mode fiber optic cable — jarak pendek, biasanya indoor.', 2),
  ('ADSS',      'ADSS',                 'All-Dielectric Self-Supporting — kabel aerial tanpa metal, tahan petir.', 3),
  ('OPGW',      'OPGW',                 'Optical Ground Wire — kabel ground dengan serat optik di dalamnya.', 4),
  ('DIRECT',    'Direct Buried',        'Kabel yang ditanam langsung di tanah tanpa duct.', 5),
  ('INDOOR',    'Indoor / Patch Cord',  'Kabel untuk penggunaan indoor atau patch cord.', 6),
  ('DROP',      'Drop Cable',           'Kabel drop untuk koneksi last mile ke pelanggan (ODP ke ONT).', 7)
on conflict (cable_type_name) do nothing;
