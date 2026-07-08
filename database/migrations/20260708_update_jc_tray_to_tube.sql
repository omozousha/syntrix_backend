-- ─────────────────────────────────────────────────────────────────────────────
-- Update: JC tray_config label 'Tray' → 'Tube'
-- ─────────────────────────────────────────────────────────────────────────────
-- JC (Joint Closure) menggunakan istilah "Tube" bukan "Tray"
-- karena secara fisik adalah tube splice closure.
-- ─────────────────────────────────────────────────────────────────────────────

update public.asset_models
set tray_config = jsonb_set(tray_config, '{trays}', (
  select jsonb_agg(
    case
      when tray->>'id' = 'main' then
        tray || '{"label": "Tube"}'::jsonb
      else
        tray
    end
  )
  from jsonb_array_elements(tray_config->'trays') as tray
))
where asset_type_id in (
  select id from public.asset_types where type_name = 'JC'
)
and tray_config ? 'trays';

-- ── Verifikasi ──
select
  at.type_name,
  am.model_name,
  am.tray_config->'trays' as trays
from public.asset_types at
join public.asset_models am on am.asset_type_id = at.id
where at.type_name = 'JC'
order by am.model_name;
