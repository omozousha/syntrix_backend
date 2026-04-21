-- Extend custom_field_definitions for scoped rendering and UI layout.

alter table if exists public.custom_field_definitions
  add column if not exists region_id uuid,
  add column if not exists device_type_key text,
  add column if not exists pop_type text,
  add column if not exists layout_span integer not null default 12,
  add column if not exists sort_order integer not null default 0,
  add column if not exists help_text text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'custom_field_definitions_region_id_fkey'
  ) then
    alter table public.custom_field_definitions
      add constraint custom_field_definitions_region_id_fkey
      foreign key (region_id) references public.regions(id) on update cascade on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_custom_field_layout_span'
  ) then
    alter table public.custom_field_definitions
      add constraint chk_custom_field_layout_span
      check (layout_span in (6, 12));
  end if;
end $$;

create index if not exists idx_custom_field_definitions_entity_scope
  on public.custom_field_definitions(entity_type, region_id, device_type_key, pop_type, is_active);

-- Ensure existing rows have valid default layout span.
update public.custom_field_definitions
set layout_span = 12
where layout_span is null or layout_span not in (6, 12);
