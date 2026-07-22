-- Master Data Synchronization — JC Closure Type FK on devices
-- Tambah closure_type_id ke tabel devices agar JC bisa referensikan closure type master.

alter table public.devices
  add column if not exists closure_type_id uuid references public.closure_types(id)
    on update cascade on delete set null;

comment on column public.devices.closure_type_id is 'FK ke closure_types — tipe joint closure yang digunakan perangkat JC.';

create index if not exists idx_devices_closure_type_id
  on public.devices(closure_type_id)
  where closure_type_id is not null;
