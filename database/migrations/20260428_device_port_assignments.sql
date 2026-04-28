-- Add customer and ONT assignment fields for ODP/service-facing device ports.

alter table if exists public.device_ports
  add column if not exists customer_id uuid references public.customers(id) on update cascade on delete set null,
  add column if not exists ont_device_id uuid references public.devices(id) on update cascade on delete set null,
  add column if not exists service_number text,
  add column if not exists occupied_at date;

create index if not exists idx_device_ports_customer_id
  on public.device_ports(customer_id);

create index if not exists idx_device_ports_ont_device_id
  on public.device_ports(ont_device_id);
