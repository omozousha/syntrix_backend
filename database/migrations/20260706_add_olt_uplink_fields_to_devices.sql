-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Add OLT uplink fields to devices table
-- Description: Menambahkan kolom relasi upstream untuk perangkat OLT
-- Tanggal: 2026-07-06
-- ─────────────────────────────────────────────────────────────────────────────

alter table if exists public.devices
  add column if not exists uplink_switch_id uuid
    references public.devices(id)
    on update cascade on delete set null,
  add column if not exists uplink_router_id uuid
    references public.devices(id)
    on update cascade on delete set null;

comment on column public.devices.uplink_switch_id is 'Referensi ke device OLT upstream (switch) - relasi uplink OLT';
comment on column public.devices.uplink_router_id is 'Referensi ke device OLT upstream (router) - relasi uplink OLT';

create index if not exists idx_devices_uplink_switch_id
  on public.devices(uplink_switch_id)
  where uplink_switch_id is not null;

create index if not exists idx_devices_uplink_router_id
  on public.devices(uplink_router_id)
  where uplink_router_id is not null;
