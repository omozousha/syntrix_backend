-- Migration 20260724: Add 'drop' to port_connections.connection_type enum
-- Purpose: Enable ODP rear → ONT drop cable connections in port_connections table
-- Target: Nhost/PostgreSQL

-- 1. Drop existing check constraint
ALTER TABLE public.port_connections
  DROP CONSTRAINT IF EXISTS port_connections_connection_type_check;

-- 2. Re-add with 'drop' included
ALTER TABLE public.port_connections
  ADD CONSTRAINT port_connections_connection_type_check
    CHECK (connection_type IN ('fiber', 'patch', 'uplink', 'crossconnect', 'other', 'drop'));

-- 3. Verify
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.port_connections'::regclass
  AND conname = 'port_connections_connection_type_check';
