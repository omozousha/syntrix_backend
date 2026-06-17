-- Backfill device.project_id from deterministic POP project relation.
-- Safe to run more than once.
--
-- Rule:
-- A device without project_id is updated only when its POP has exactly one
-- project candidate in the same region with status planning/running/done.
--
-- This script intentionally skips ambiguous POP/project relations.

begin;

create temp table tmp_device_project_backfill_candidates on commit drop as
with pop_project_candidates as (
  select
    p.region_id,
    p.pop_id,
    count(*) filter (where p.status in ('planning', 'running', 'done'))::int as candidate_count,
    (array_agg(p.id order by p.updated_at desc, p.created_at desc) filter (where p.status in ('planning', 'running', 'done')))[1] as candidate_project_id,
    (array_agg(p.project_id order by p.updated_at desc, p.created_at desc) filter (where p.status in ('planning', 'running', 'done')))[1] as candidate_project_code,
    (array_agg(p.project_name order by p.updated_at desc, p.created_at desc) filter (where p.status in ('planning', 'running', 'done')))[1] as candidate_project_name
  from public.projects p
  where p.pop_id is not null
  group by p.region_id, p.pop_id
)
select
  d.id,
  d.device_id,
  d.device_name,
  d.device_type_key,
  d.region_id,
  d.pop_id,
  d.project_id as old_project_id,
  ppc.candidate_project_id as new_project_id,
  ppc.candidate_project_code,
  ppc.candidate_project_name,
  ppc.candidate_count
from public.devices d
join pop_project_candidates ppc
  on ppc.region_id = d.region_id
 and ppc.pop_id = d.pop_id
where d.deleted_at is null
  and d.project_id is null
  and ppc.candidate_count = 1
  and ppc.candidate_project_id is not null;

-- Backup/review snapshot. Save this result before applying the update.
select
  count(*)::int as deterministic_backfill_candidate_total,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'device_db_id', id,
        'inventory_id', device_id,
        'device_name', device_name,
        'device_type_key', device_type_key,
        'region_id', region_id,
        'pop_id', pop_id,
        'old_project_id', old_project_id,
        'new_project_id', new_project_id,
        'candidate_project_code', candidate_project_code,
        'candidate_project_name', candidate_project_name
      )
      order by device_type_key, device_name
    ),
    '[]'::jsonb
  ) as backup_snapshot
from tmp_device_project_backfill_candidates;

create temp table tmp_device_project_backfill_updated on commit drop as
with updated as (
  update public.devices d
  set
    project_id = c.new_project_id,
    updated_at = now()
  from tmp_device_project_backfill_candidates c
  where d.id = c.id
    and d.project_id is null
  returning
    d.id,
    d.device_id,
    d.device_name,
    d.device_type_key,
    c.old_project_id,
    d.project_id as new_project_id,
    c.candidate_project_code,
    c.candidate_project_name
)
select * from updated;

select
  count(*)::int as updated_device_total,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'device_db_id', id,
        'inventory_id', device_id,
        'device_name', device_name,
        'device_type_key', device_type_key,
        'old_project_id', old_project_id,
        'new_project_id', new_project_id,
        'candidate_project_code', candidate_project_code,
        'candidate_project_name', candidate_project_name
      )
      order by device_type_key, device_name
    ),
    '[]'::jsonb
  ) as updated_items
from tmp_device_project_backfill_updated;

-- Rollback SQL for this run only. Copy only if manual rollback is required.
select
  case
    when count(*) = 0 then '-- No device project relation updated in this run.'
    else 'update public.devices set project_id = null, updated_at = now() where id in (' ||
      string_agg(quote_literal(id::text), ', ' order by device_type_key, device_name) ||
      ') and project_id in (' ||
      string_agg(distinct quote_literal(new_project_id::text), ', ') ||
      ');'
  end as rollback_updated_devices_sql
from tmp_device_project_backfill_updated;

-- Verification summary.
with pop_project_candidates as (
  select
    p.region_id,
    p.pop_id,
    count(*) filter (where p.status in ('planning', 'running', 'done'))::int as candidate_count
  from public.projects p
  where p.pop_id is not null
  group by p.region_id, p.pop_id
)
select
  count(*) filter (where d.project_id is null)::int as devices_without_project_remaining,
  count(*) filter (
    where d.project_id is null
      and coalesce(ppc.candidate_count, 0) = 1
  )::int as deterministic_candidates_remaining,
  count(*) filter (
    where d.project_id is null
      and coalesce(ppc.candidate_count, 0) <> 1
  )::int as manual_review_remaining
from public.devices d
left join pop_project_candidates ppc
  on ppc.region_id = d.region_id
 and ppc.pop_id = d.pop_id
where d.deleted_at is null;

commit;
