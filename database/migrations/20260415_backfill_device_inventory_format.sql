-- Backfill device_id and device_code from legacy format to INV format.
-- Target format: INV-<TYPE>-<7 ALNUM>, examples:
-- INV-OLT-A7RA7WG, INV-OTB-L41FWDH, INV-JC-V8LC7YX, INV-ODC-05H4PTF

create extension if not exists pgcrypto;

-- Ensure generator exists (idempotent).
create or replace function public.generate_inventory_code(item_prefix text, code_length integer default 7)
returns text
language plpgsql
as $$
declare
  clean_prefix text;
  alphabet text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  random_part text := '';
  i integer;
begin
  clean_prefix := upper(regexp_replace(coalesce(item_prefix, ''), '[^A-Za-z0-9]', '', 'g'));
  if clean_prefix = '' then
    clean_prefix := 'DEV';
  end if;

  for i in 1..greatest(code_length, 4) loop
    random_part := random_part || substr(alphabet, (get_byte(gen_random_bytes(1), 0) % length(alphabet)) + 1, 1);
  end loop;

  return 'INV-' || clean_prefix || '-' || random_part;
end;
$$;

-- Normalize device prefix from device_type_key.
create or replace function public.normalize_device_prefix(input_key text)
returns text
language plpgsql
as $$
declare
  prefix text;
begin
  prefix := upper(regexp_replace(coalesce(input_key, 'DEV'), '[^A-Za-z0-9]', '', 'g'));

  if prefix = '' then
    prefix := 'DEV';
  end if;

  if prefix in ('JOINTCLOSURE', 'JOINT', 'JCLOSURE') then
    prefix := 'JC';
  elsif prefix = 'SWITCH' then
    prefix := 'SWT';
  elsif prefix = 'ROUTER' then
    prefix := 'RTR';
  elsif prefix = 'CABLE' then
    prefix := 'CBL';
  elsif length(prefix) > 4 then
    prefix := left(prefix, 4);
  end if;

  return prefix;
end;
$$;

-- Ensure trigger generator is aligned to the same format for new rows.
create or replace function public.set_device_codes()
returns trigger
language plpgsql
as $$
declare
  prefix text;
  candidate_device_id text;
  candidate_device_code text;
begin
  prefix := public.normalize_device_prefix(new.device_type_key);

  if new.device_id is null then
    loop
      candidate_device_id := public.generate_inventory_code(prefix, 7);
      exit when not exists (select 1 from public.devices d where d.device_id = candidate_device_id);
    end loop;
    new.device_id := candidate_device_id;
  end if;

  if new.device_code is null then
    loop
      candidate_device_code := public.generate_inventory_code(prefix, 7);
      exit when not exists (select 1 from public.devices d where d.device_code = candidate_device_code);
    end loop;
    new.device_code := candidate_device_code;
  end if;

  return new;
end;
$$;

do $$
declare
  rec record;
  prefix text;
  next_device_id text;
  next_device_code text;
  affected integer := 0;
begin
  for rec in
    select id, device_type_key, device_id, device_code
    from public.devices
    where device_id is null
      or device_code is null
      or device_id !~ '^INV-[A-Z0-9]{2,4}-[A-Z0-9]{7}$'
      or device_code !~ '^INV-[A-Z0-9]{2,4}-[A-Z0-9]{7}$'
    for update
  loop
    prefix := public.normalize_device_prefix(rec.device_type_key);
    next_device_id := rec.device_id;
    next_device_code := rec.device_code;

    if rec.device_id is null or rec.device_id !~ '^INV-[A-Z0-9]{2,4}-[A-Z0-9]{7}$' then
      loop
        next_device_id := public.generate_inventory_code(prefix, 7);
        exit when not exists (select 1 from public.devices d where d.device_id = next_device_id);
      end loop;
    end if;

    if rec.device_code is null or rec.device_code !~ '^INV-[A-Z0-9]{2,4}-[A-Z0-9]{7}$' then
      loop
        next_device_code := public.generate_inventory_code(prefix, 7);
        exit when not exists (select 1 from public.devices d where d.device_code = next_device_code);
      end loop;
    end if;

    update public.devices
    set
      device_id = next_device_id,
      device_code = next_device_code
    where id = rec.id;

    affected := affected + 1;
  end loop;

  raise notice 'Backfill completed. Updated rows: %', affected;
end
$$;

-- Optional verification query (run manually):
-- select id, device_type_key, device_id, device_code, device_name
-- from public.devices
-- order by created_at desc
-- limit 30;
