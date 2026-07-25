-- Migration 20260725: Backfill existing device_ports.ont_device_id into port_connections
-- Purpose: Migrate legacy direct FK assignments into port_connections table
-- Target: Nhost/PostgreSQL

-- Backfill: for every device_ports row that has ont_device_id set,
-- create a port_connections record with connection_type='drop'
INSERT INTO public.port_connections (
  region_id,
  from_port_id,
  to_port_id,
  connection_type,
  status,
  notes,
  created_at
)
SELECT
  odp_port.region_id,
  odp_port.id           AS from_port_id,
  ont_port.id           AS to_port_id,
  'drop'                AS connection_type,
  'active'              AS status,
  'Backfilled from legacy ont_device_id assignment' AS notes,
  NOW()                 AS created_at
FROM public.device_ports odp_port
JOIN public.device_ports ont_port
  ON ont_port.id = odp_port.ont_device_id
WHERE odp_port.ont_device_id IS NOT NULL
  AND odp_port.deleted_at IS NULL
  AND ont_port.deleted_at IS NULL
  -- avoid duplicates if re-run
  AND NOT EXISTS (
    SELECT 1
    FROM public.port_connections pc
    WHERE pc.from_port_id = odp_port.id
      AND pc.to_port_id  = ont_port.id
      AND pc.connection_type = 'drop'
  );

-- Report count
SELECT COUNT(*) AS backfilled_count
FROM public.port_connections
WHERE connection_type = 'drop'
  AND notes LIKE 'Backfilled%';
