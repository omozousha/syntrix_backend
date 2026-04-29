-- Remove service_number from device_ports.

alter table if exists public.device_ports
  drop column if exists service_number;
