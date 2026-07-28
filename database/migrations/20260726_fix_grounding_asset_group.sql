-- Fix: GROUNDING asset_group should be 'passive' not 'active'
-- Grounding is passive infrastructure, not an active device

UPDATE public.device_type_catalog
SET
  asset_group = 'passive',
  is_passive = true,
  is_active_device = false,
  updated_at = now()
WHERE device_type_key = 'GROUNDING'
  AND asset_group = 'active';

-- Verify
SELECT device_type_key, device_type_name, asset_group, is_passive, is_active_device
FROM public.device_type_catalog
WHERE device_type_key = 'GROUNDING';
