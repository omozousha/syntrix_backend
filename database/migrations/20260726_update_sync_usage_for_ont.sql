-- Migration 20260726: Sync used_core for ODP when ONT is assigned via port_connections
-- Purpose: Keep devices.used_core in sync with ONT drop connections
-- Target: Nhost/PostgreSQL

-- 1. Function: count ONT assignments (via ont_device_id OR via drop port_connections)
CREATE OR REPLACE FUNCTION public.sync_device_core_usage(input_device_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  used_core_count integer;
BEGIN
  IF input_device_id IS NULL THEN
    RETURN;
  END IF;

  -- Count ports on this device that have an ONT assigned (legacy FK)
  -- OR that are the from_port of an active drop connection
  SELECT COUNT(*)::integer INTO used_core_count
  FROM public.device_ports p
  WHERE p.device_id = input_device_id
    AND p.deleted_at IS NULL
    AND (
      p.ont_device_id IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM public.port_connections pc
        WHERE pc.from_port_id = p.id
          AND pc.connection_type = 'drop'
          AND public.is_occupying_port_connection_status(pc.status)
      )
    );

  UPDATE public.devices d
  SET
    used_core = used_core_count,
    updated_at = now()
  WHERE d.id = input_device_id;
END;
$$;

-- 2. Extend sync_topology_connection_usage to also sync used_core
CREATE OR REPLACE FUNCTION public.sync_topology_connection_usage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_from_device_id uuid;
  old_to_device_id uuid;
  new_from_device_id uuid;
  new_to_device_id uuid;
BEGIN
  IF tg_op IN ('UPDATE', 'DELETE') THEN
    SELECT device_id INTO old_from_device_id FROM public.device_ports WHERE id = old.from_port_id;
    SELECT device_id INTO old_to_device_id FROM public.device_ports WHERE id = old.to_port_id;

    IF public.is_occupying_port_connection_status(old.status) THEN
      UPDATE public.device_ports p
      SET status = 'idle'
      WHERE p.id IN (old.from_port_id, old.to_port_id)
        AND p.status = 'used'
        AND p.customer_id IS NULL
        AND p.ont_device_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.port_connections pc
          WHERE pc.id <> old.id
            AND public.is_occupying_port_connection_status(pc.status)
            AND (pc.from_port_id = p.id OR pc.to_port_id = p.id)
        );
    END IF;
  END IF;

  IF tg_op IN ('INSERT', 'UPDATE') THEN
    SELECT device_id INTO new_from_device_id FROM public.device_ports WHERE id = new.from_port_id;
    SELECT device_id INTO new_to_device_id FROM public.device_ports WHERE id = new.to_port_id;

    IF public.is_occupying_port_connection_status(new.status) THEN
      UPDATE public.device_ports
      SET status = 'used'
      WHERE id IN (new.from_port_id, new.to_port_id)
        AND deleted_at IS NULL;
    END IF;
  END IF;

  -- Existing port usage sync
  PERFORM public.sync_device_port_usage_for_device(old_from_device_id);
  PERFORM public.sync_device_port_usage_for_device(old_to_device_id);
  PERFORM public.sync_device_port_usage_for_device(new_from_device_id);
  PERFORM public.sync_device_port_usage_for_device(new_to_device_id);

  -- NEW: core usage sync (for ODP used_core)
  PERFORM public.sync_device_core_usage(old_from_device_id);
  PERFORM public.sync_device_core_usage(old_to_device_id);
  PERFORM public.sync_device_core_usage(new_from_device_id);
  PERFORM public.sync_device_core_usage(new_to_device_id);

  RETURN COALESCE(new, old);
END;
$$;

-- 3. Re-create trigger (idempotent)
DROP TRIGGER IF EXISTS trg_port_connections_sync_usage ON public.port_connections;
CREATE TRIGGER trg_port_connections_sync_usage
AFTER INSERT OR UPDATE OF status, from_port_id, to_port_id OR DELETE ON public.port_connections
FOR EACH ROW
EXECUTE FUNCTION public.sync_topology_connection_usage();
