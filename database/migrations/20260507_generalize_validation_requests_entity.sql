-- Generalize request queue entity targets beyond devices.

alter table if exists public.validation_requests
  drop constraint if exists validation_requests_entity_id_fkey;

alter table if exists public.validation_requests
  drop constraint if exists validation_requests_entity_type_check;

alter table if exists public.validation_requests
  add constraint validation_requests_entity_type_check
  check (entity_type in ('device', 'pop', 'route', 'project'));
