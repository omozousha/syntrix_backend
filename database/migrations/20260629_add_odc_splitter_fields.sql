-- Add ODC splitter fields (feeder & distribution port counts)
alter table if exists public.devices
  add column if not exists feeder_port_count integer
    check (feeder_port_count is null or feeder_port_count >= 0),
  add column if not exists distribution_port_count integer
    check (distribution_port_count is null or distribution_port_count >= 0);

comment on column public.devices.feeder_port_count is 'Jumlah port untuk koneksi feeder dari OTB/POP ke ODC';
comment on column public.devices.distribution_port_count is 'Jumlah port untuk koneksi distribusi downstream dari ODC ke ODP';
