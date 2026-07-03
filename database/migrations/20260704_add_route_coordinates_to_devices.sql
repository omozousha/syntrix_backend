-- Add route_coordinates and route_file_url columns to devices table
-- route_coordinates: JSONB array of [lng, lat] coordinate pairs for cable polyline
-- route_file_url: URL/path to uploaded KML/KMZ file

alter table if exists public.devices
  add column if not exists route_coordinates jsonb,
  add column if not exists route_file_url text;

comment on column public.devices.route_coordinates is 'Array of [longitude, latitude] coordinate pairs representing the cable route polyline. Parsed from uploaded KML/KMZ file.';
comment on column public.devices.route_file_url is 'URL or storage path to the uploaded KML/KMZ route file.';
