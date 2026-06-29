-- Add Incoming Cable columns to devices table for ODP topology
-- These columns store the upstream connection info for an ODP device:
--  - source_odc_id: upstream ODC device that feeds this ODP
--  - source_odc_port_id: specific port on the source ODC
--  - feeder_cable_id: CABLE device carrying the feeder cores
--  - feeder_core_start / feeder_core_end: core range on the feeder cable

alter table if exists public.devices
  add column if not exists source_odc_id uuid
    references public.devices(id) on update cascade on delete set null,
  add column if not exists source_odc_port_id uuid
    references public.device_ports(id) on update cascade on delete set null,
  add column if not exists feeder_cable_id uuid
    references public.devices(id) on update cascade on delete set null,
  add column if not exists feeder_core_start integer
    check (feeder_core_start is null or feeder_core_start > 0),
  add column if not exists feeder_core_end integer
    check (feeder_core_end is null or feeder_core_end > 0);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_devices_feeder_core_range'
      and conrelid = 'public.devices'::regclass
  ) then
    alter table public.devices add constraint chk_devices_feeder_core_range
      check (
        (feeder_core_start is null and feeder_core_end is null)
        or (feeder_core_start is not null and feeder_core_end is not null and feeder_core_end >= feeder_core_start)
      );
  end if;
end;
$$;

create index if not exists idx_devices_source_odc_id
  on public.devices(source_odc_id)
  where source_odc_id is not null;

create index if not exists idx_devices_feeder_cable_id
  on public.devices(feeder_cable_id)
  where feeder_cable_id is not null;
