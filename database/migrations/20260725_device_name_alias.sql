-- Migration: Add device_name_alias column to devices
-- Purpose: Optional alias/alternate name for devices (nama_device_baru)
-- Target: Nhost/PostgreSQL

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS device_name_alias text;

COMMENT ON COLUMN public.devices.device_name_alias IS 'Optional alias or alternate name for the device (nama_device_baru)';
