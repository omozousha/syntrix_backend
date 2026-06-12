-- Add default port template for cable devices.
-- Safe to run more than once.

insert into public.device_port_templates
  (device_type_key, profile_name, total_ports, start_port_index, default_port_type, default_direction, default_core_capacity, metadata)
values
  ('CABLE', 'default', 12, 1, 'fiber', 'bidirectional', 1, '{"hint":"Default cable core endpoint profile"}'::jsonb)
on conflict (device_type_key, profile_name) do update
set
  total_ports = excluded.total_ports,
  start_port_index = excluded.start_port_index,
  default_port_type = excluded.default_port_type,
  default_direction = excluded.default_direction,
  default_core_capacity = excluded.default_core_capacity,
  metadata = excluded.metadata,
  is_active = true,
  updated_at = now();
