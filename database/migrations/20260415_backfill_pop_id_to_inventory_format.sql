-- Backfill POP ID from legacy format (e.g. POP-000025) to INV format (INV-POP-XXXXXXX).
-- Safe behavior:
-- 1) rows already matching INV-POP-[A-Z0-9]{7} are skipped
-- 2) each generated id is checked against uniqueness before update

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

do $$
declare
  rec record;
  new_pop_id text;
  affected integer := 0;
begin
  for rec in
    select id, pop_id
    from public.pops
    where pop_id is null
      or pop_id !~ '^INV-POP-[A-Z0-9]{7}$'
    for update
  loop
    loop
      new_pop_id := public.generate_inventory_code('POP', 7);
      exit when not exists (
        select 1
        from public.pops p
        where p.pop_id = new_pop_id
      );
    end loop;

    update public.pops
    set pop_id = new_pop_id
    where id = rec.id;

    affected := affected + 1;
  end loop;

  raise notice 'Backfill completed. Updated rows: %', affected;
end
$$;

-- Optional verification query (run manually):
-- select id, pop_id, pop_name from public.pops order by created_at desc limit 20;
