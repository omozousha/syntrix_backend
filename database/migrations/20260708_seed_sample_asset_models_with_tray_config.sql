-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: Sample Asset Models + Default Tray Config
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Insert sample asset_models untuk OTB, ODC, JC (jika belum ada)
-- 2. Set default tray_config untuk masing-masing model
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_otb_id uuid;
  v_odc_id uuid;
  v_jc_id  uuid;
begin
  -- ── Cari asset_type_id ──
  select id into v_otb_id from public.asset_types where type_name = 'OTB';
  select id into v_odc_id from public.asset_types where type_name = 'ODC';
  select id into v_jc_id  from public.asset_types where type_name = 'JC';

  -- ── OTB Models ──
  -- OTB-48 (standard 48 port)
  insert into public.asset_models (model_name, asset_type_id, description, tray_config)
  select 'OTB-48', v_otb_id, 'OTB 48 port standard',
    '{"ports_per_tray": 12}'::jsonb
  where not exists (
    select 1 from public.asset_models
    where model_name = 'OTB-48' and asset_type_id = v_otb_id
  );

  -- OTB-24 (24 port)
  insert into public.asset_models (model_name, asset_type_id, description, tray_config)
  select 'OTB-24', v_otb_id, 'OTB 24 port compact',
    '{"ports_per_tray": 12}'::jsonb
  where not exists (
    select 1 from public.asset_models
    where model_name = 'OTB-24' and asset_type_id = v_otb_id
  );

  -- OTB-96 (96 port high density)
  insert into public.asset_models (model_name, asset_type_id, description, tray_config)
  select 'OTB-96', v_otb_id, 'OTB 96 port high density',
    '{"ports_per_tray": 12}'::jsonb
  where not exists (
    select 1 from public.asset_models
    where model_name = 'OTB-96' and asset_type_id = v_otb_id
  );

  -- ── ODC Models ──
  -- ODC-48 (standard 48 port, 4 tray)
  insert into public.asset_models (model_name, asset_type_id, description, tray_config)
  select 'ODC-48', v_odc_id, 'ODC 48 port standard dengan 4 tray',
    '{
      "trays": [
        {"id": "feeder", "label": "Feeder", "portRange": [1, 12]},
        {"id": "dist-a", "label": "Distribution A", "portRange": [13, 24]},
        {"id": "dist-b", "label": "Distribution B", "portRange": [25, 36]},
        {"id": "dist-c", "label": "Distribution C", "portRange": [37, 48]}
      ]
    }'::jsonb
  where not exists (
    select 1 from public.asset_models
    where model_name = 'ODC-48' and asset_type_id = v_odc_id
  );

  -- ODC-72 (72 port, 6 tray)
  insert into public.asset_models (model_name, asset_type_id, description, tray_config)
  select 'ODC-72', v_odc_id, 'ODC 72 port dengan 6 tray',
    '{
      "trays": [
        {"id": "feeder", "label": "Feeder", "portRange": [1, 12]},
        {"id": "dist-a", "label": "Distribution A", "portRange": [13, 24]},
        {"id": "dist-b", "label": "Distribution B", "portRange": [25, 36]},
        {"id": "dist-c", "label": "Distribution C", "portRange": [37, 48]},
        {"id": "dist-d", "label": "Distribution D", "portRange": [49, 60]},
        {"id": "dist-e", "label": "Distribution E", "portRange": [61, 72]}
      ]
    }'::jsonb
  where not exists (
    select 1 from public.asset_models
    where model_name = 'ODC-72' and asset_type_id = v_odc_id
  );

  -- ── JC Models ──
  -- JC-96 (standard 96 core)
  insert into public.asset_models (model_name, asset_type_id, description, tray_config)
  select 'JC-96', v_jc_id, 'Joint closure 96 core standard',
    '{
      "trays": [
        {"id": "main", "label": "Tray", "portRange": [1, 24]}
      ]
    }'::jsonb
  where not exists (
    select 1 from public.asset_models
    where model_name = 'JC-96' and asset_type_id = v_jc_id
  );

  -- JC-144 (144 core)
  insert into public.asset_models (model_name, asset_type_id, description, tray_config)
  select 'JC-144', v_jc_id, 'Joint closure 144 core',
    '{
      "trays": [
        {"id": "main", "label": "Tray", "portRange": [1, 24]}
      ]
    }'::jsonb
  where not exists (
    select 1 from public.asset_models
    where model_name = 'JC-144' and asset_type_id = v_jc_id
  );

  raise notice 'Sample asset_models inserted successfully';
end $$;

-- ── Verifikasi ──
select
  at.type_name,
  count(am.id) as total_models,
  count(am.tray_config) filter (where am.tray_config is not null and am.tray_config <> '{}'::jsonb) as with_tray_config
from public.asset_types at
left join public.asset_models am on am.asset_type_id = at.id
where at.type_name in ('OTB', 'ODC', 'JC')
group by at.type_name
order by at.type_name;

-- Detail model
select
  at.type_name,
  am.model_name,
  am.tray_config
from public.asset_types at
join public.asset_models am on am.asset_type_id = at.id
where at.type_name in ('OTB', 'ODC', 'JC')
order by at.type_name, am.model_name;
