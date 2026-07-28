-- Migration: ODC Distribution Cables table
-- Purpose: Store distribution cable metadata per ODC device
-- Target: Nhost/PostgreSQL

CREATE TABLE IF NOT EXISTS public.odc_distribution_cables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  odc_device_id uuid NOT NULL REFERENCES public.devices(id) ON UPDATE CASCADE ON DELETE CASCADE,
  region_id uuid NOT NULL REFERENCES public.regions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  route_type text,
  cable_type text,
  cable_length_m numeric(10,2),
  route_name text,
  sort_order integer NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  deleted_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_odc_dist_cables_odc
  ON public.odc_distribution_cables(odc_device_id)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.odc_distribution_cables IS 'Distribution cables originating from an ODC device';
COMMENT ON COLUMN public.odc_distribution_cables.odc_device_id IS 'ODC device ID this cable belongs to';
COMMENT ON COLUMN public.odc_distribution_cables.route_type IS 'Route type (feeder, distribution, branch, drop)';
COMMENT ON COLUMN public.odc_distribution_cables.cable_type IS 'Cable type code or name';
COMMENT ON COLUMN public.odc_distribution_cables.cable_length_m IS 'Cable length in meters';
COMMENT ON COLUMN public.odc_distribution_cables.route_name IS 'Human-readable route name';
COMMENT ON COLUMN public.odc_distribution_cables.sort_order IS 'Display order within ODC';
