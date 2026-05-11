-- Ensure new device types always receive an automatic inventory type code.

alter table if exists public.device_type_catalog
  add column if not exists inventory_type_code text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'device_type_catalog_inventory_type_code_check'
      and conrelid = 'public.device_type_catalog'::regclass
  ) then
    alter table public.device_type_catalog
      add constraint device_type_catalog_inventory_type_code_check
      check (inventory_type_code is null or inventory_type_code ~ '^[0-9]{3}$');
  end if;
end $$;

create or replace function public.next_available_device_inventory_type_code()
returns text
language plpgsql
volatile
as $$
declare
  number_candidate integer;
  code_candidate text;
begin
  for number_candidate in 1..999 loop
    code_candidate := lpad(number_candidate::text, 3, '0');
    if not exists (
      select 1
      from public.device_type_catalog dt
      where dt.inventory_type_code = code_candidate
    ) then
      return code_candidate;
    end if;
  end loop;

  raise exception 'No available 3-digit device inventory type code remains';
end;
$$;

create or replace function public.set_device_type_inventory_code()
returns trigger
language plpgsql
as $$
begin
  if new.inventory_type_code is null or trim(new.inventory_type_code) = '' then
    new.inventory_type_code := public.next_available_device_inventory_type_code();
  else
    new.inventory_type_code := lpad(regexp_replace(new.inventory_type_code, '[^0-9]', '', 'g'), 3, '0');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_device_type_catalog_set_inventory_code on public.device_type_catalog;
create trigger trg_device_type_catalog_set_inventory_code
before insert or update of inventory_type_code on public.device_type_catalog
for each row execute function public.set_device_type_inventory_code();

do $$
declare
  rec record;
begin
  for rec in
    select id
    from public.device_type_catalog
    where inventory_type_code is null
    order by sort_order asc, device_type_name asc, id asc
  loop
    update public.device_type_catalog
    set inventory_type_code = public.next_available_device_inventory_type_code()
    where id = rec.id;
  end loop;
end $$;
