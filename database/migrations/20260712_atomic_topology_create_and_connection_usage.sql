-- Atomic topology-create foundation.
--
-- Hasura executes all mutation fields that target this PostgreSQL source in a
-- single transaction. These triggers provide the database-level endpoint lock,
-- race-safe availability check, endpoint status transition, and usage counter
-- synchronization required by the topology-aware create mutation.

create or replace function public.is_occupying_port_connection_status(input_status text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(input_status, '')) in ('active', 'planned', 'cutover');
$$;

create or replace function public.sync_device_port_usage_for_device(input_device_id uuid)
returns void
language plpgsql
as $$
begin
  if input_device_id is null then
    return;
  end if;

  update public.devices d
  set
    total_ports = usage.total_ports,
    used_ports = usage.used_ports,
    updated_at = now()
  from (
    select
      count(*)::integer as total_ports,
      count(*) filter (
        where p.status = 'used'
          or p.customer_id is not null
          or p.ont_device_id is not null
      )::integer as used_ports
    from public.device_ports p
    where p.device_id = input_device_id
      and p.deleted_at is null
  ) usage
  where d.id = input_device_id;
end;
$$;

create or replace function public.assert_topology_connection_endpoints_available()
returns trigger
language plpgsql
as $$
declare
  endpoint record;
begin
  if not public.is_occupying_port_connection_status(new.status) then
    return new;
  end if;

  if new.from_port_id = new.to_port_id then
    raise exception using
      errcode = '23514',
      message = 'TOPOLOGY_PORT_INVALID: a port cannot connect to itself';
  end if;

  -- Lock endpoint rows in stable UUID order. A concurrent assignment waits,
  -- then observes the first transaction's committed connection/status.
  for endpoint in
    select p.id, p.status, p.deleted_at
    from public.device_ports p
    where p.id in (new.from_port_id, new.to_port_id)
    order by p.id
    for update
  loop
    if endpoint.deleted_at is not null then
      raise exception using
        errcode = '23503',
        message = 'TOPOLOGY_PORT_INVALID: endpoint port is deleted';
    end if;

    if endpoint.status <> 'idle' then
      raise exception using
        errcode = 'P0001',
        message = 'TOPOLOGY_PORT_UNAVAILABLE: endpoint port is not idle';
    end if;
  end loop;

  if (select count(*) from public.device_ports where id in (new.from_port_id, new.to_port_id)) <> 2 then
    raise exception using
      errcode = '23503',
      message = 'TOPOLOGY_PORT_INVALID: endpoint port not found';
  end if;

  if exists (
    select 1
    from public.port_connections pc
    where public.is_occupying_port_connection_status(pc.status)
      and (pc.from_port_id in (new.from_port_id, new.to_port_id)
        or pc.to_port_id in (new.from_port_id, new.to_port_id))
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'TOPOLOGY_PORT_UNAVAILABLE: endpoint port already has an active connection';
  end if;

  return new;
end;
$$;

create or replace function public.sync_topology_connection_usage()
returns trigger
language plpgsql
as $$
declare
  old_from_device_id uuid;
  old_to_device_id uuid;
  new_from_device_id uuid;
  new_to_device_id uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select device_id into old_from_device_id from public.device_ports where id = old.from_port_id;
    select device_id into old_to_device_id from public.device_ports where id = old.to_port_id;

    if public.is_occupying_port_connection_status(old.status) then
      update public.device_ports p
      set status = 'idle'
      where p.id in (old.from_port_id, old.to_port_id)
        and p.status = 'used'
        and p.customer_id is null
        and p.ont_device_id is null
        and not exists (
          select 1
          from public.port_connections pc
          where pc.id <> old.id
            and public.is_occupying_port_connection_status(pc.status)
            and (pc.from_port_id = p.id or pc.to_port_id = p.id)
        );
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select device_id into new_from_device_id from public.device_ports where id = new.from_port_id;
    select device_id into new_to_device_id from public.device_ports where id = new.to_port_id;

    if public.is_occupying_port_connection_status(new.status) then
      update public.device_ports
      set status = 'used'
      where id in (new.from_port_id, new.to_port_id)
        and deleted_at is null;
    end if;
  end if;

  perform public.sync_device_port_usage_for_device(old_from_device_id);
  perform public.sync_device_port_usage_for_device(old_to_device_id);
  perform public.sync_device_port_usage_for_device(new_from_device_id);
  perform public.sync_device_port_usage_for_device(new_to_device_id);

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_port_connections_assert_endpoint_available on public.port_connections;
create trigger trg_port_connections_assert_endpoint_available
before insert on public.port_connections
for each row
execute function public.assert_topology_connection_endpoints_available();

drop trigger if exists trg_port_connections_sync_usage on public.port_connections;
create trigger trg_port_connections_sync_usage
after insert or update of status, from_port_id, to_port_id or delete on public.port_connections
for each row
execute function public.sync_topology_connection_usage();
