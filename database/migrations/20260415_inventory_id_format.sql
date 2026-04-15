create extension if not exists pgcrypto;

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

create or replace function public.generate_unique_pop_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  candidate text;
begin
  loop
    candidate :=
      substr(alphabet, (get_byte(gen_random_bytes(1), 0) % 26) + 1, 1) ||
      substr(alphabet, (get_byte(gen_random_bytes(1), 0) % 26) + 1, 1) ||
      substr(alphabet, (get_byte(gen_random_bytes(1), 0) % 26) + 1, 1);

    exit when not exists (select 1 from public.pops p where p.pop_code = candidate);
  end loop;

  return candidate;
end;
$$;

update public.pops
set pop_code = upper(trim(pop_code))
where pop_code is not null;

update public.pops
set pop_code = public.generate_unique_pop_code()
where pop_code is null
  or pop_code !~ '^[A-Z]{3}$';

alter table public.pops
  alter column pop_code set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pops_pop_code_3_letters_chk'
      and conrelid = 'public.pops'::regclass
  ) then
    alter table public.pops
      add constraint pops_pop_code_3_letters_chk
      check (pop_code ~ '^[A-Z]{3}$');
  end if;
end
$$;

create or replace function public.set_pop_codes()
returns trigger
language plpgsql
as $$
declare
  candidate_pop_id text;
begin
  new.pop_code := upper(trim(coalesce(new.pop_code, '')));

  if new.pop_code = '' then
    raise exception 'pop_code is required (exactly 3 letters)';
  end if;

  if new.pop_code !~ '^[A-Z]{3}$' then
    raise exception 'pop_code must be exactly 3 letters (A-Z)';
  end if;

  if new.pop_id is null then
    loop
      candidate_pop_id := public.generate_inventory_code('POP', 7);
      exit when not exists (select 1 from public.pops p where p.pop_id = candidate_pop_id);
    end loop;
    new.pop_id := candidate_pop_id;
  end if;

  return new;
end;
$$;

create or replace function public.set_device_codes()
returns trigger
language plpgsql
as $$
declare
  prefix text;
  candidate_device_id text;
  candidate_device_code text;
begin
  prefix := upper(regexp_replace(coalesce(new.device_type_key, 'DEV'), '[^A-Za-z0-9]', '', 'g'));
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
