-- Master Data Synchronization — Seed Canonical Asset Models
-- Seed lengkap OTB, ODC, ODP, JC, OLT, SWITCH asset models
-- dengan tray_config, capacity_core, dan total_ports.
-- Idempotent: pakai WHERE NOT EXISTS per model_name + asset_type_id.

do $$
declare
  v_otb  uuid;
  v_odc  uuid;
  v_odp  uuid;
  v_jc   uuid;
  v_olt  uuid;
  v_sw   uuid;
begin
  select id into v_otb  from public.asset_types where type_name = 'OTB';
  select id into v_odc  from public.asset_types where type_name = 'ODC';
  select id into v_odp  from public.asset_types where type_name = 'ODP';
  select id into v_jc   from public.asset_types where type_name = 'JC';
  select id into v_olt  from public.asset_types where type_name = 'OLT';
  select id into v_sw   from public.asset_types where type_name = 'SWITCH';

  -- ── OTB ──────────────────────────────────────────────────────────────────
  insert into public.asset_models
    (model_name, asset_type_id, description, tray_config, capacity_core, total_ports)
  select 'OTB-24', v_otb, 'OTB 24 port compact',
    '{"ports_per_tray": 12}'::jsonb, 24, 24
  where not exists (
    select 1 from public.asset_models where model_name = 'OTB-24' and asset_type_id = v_otb
  );

  insert into public.asset_models
    (model_name, asset_type_id, description, tray_config, capacity_core, total_ports)
  select 'OTB-48', v_otb, 'OTB 48 port standard',
    '{"ports_per_tray": 12}'::jsonb, 48, 48
  where not exists (
    select 1 from public.asset_models where model_name = 'OTB-48' and asset_type_id = v_otb
  );

  insert into public.asset_models
    (model_name, asset_type_id, description, tray_config, capacity_core, total_ports)
  select 'OTB-96', v_otb, 'OTB 96 port high density',
    '{"ports_per_tray": 12}'::jsonb, 96, 96
  where not exists (
    select 1 from public.asset_models where model_name = 'OTB-96' and asset_type_id = v_otb
  );

  -- ── ODC ──────────────────────────────────────────────────────────────────
  insert into public.asset_models
    (model_name, asset_type_id, description, tray_config, capacity_core, total_ports)
  select 'ODC-48', v_odc, 'ODC 48 port — 1 feeder + 3 distribusi',
    '{"trays":[
      {"id":"feeder",  "label":"Feeder",          "portRange":[1,12]},
      {"id":"dist-a",  "label":"Distribution A",  "portRange":[13,24]},
      {"id":"dist-b",  "label":"Distribution B",  "portRange":[25,36]},
      {"id":"dist-c",  "label":"Distribution C",  "portRange":[37,48]}
    ]}'::jsonb, 48, 48
  where not exists (
    select 1 from public.asset_models where model_name = 'ODC-48' and asset_type_id = v_odc
  );

  insert into public.asset_models
    (model_name, asset_type_id, description, tray_config, capacity_core, total_ports)
  select 'ODC-72', v_odc, 'ODC 72 port — 1 feeder + 5 distribusi',
    '{"trays":[
      {"id":"feeder",  "label":"Feeder",          "portRange":[1,12]},
      {"id":"dist-a",  "label":"Distribution A",  "portRange":[13,24]},
      {"id":"dist-b",  "label":"Distribution B",  "portRange":[25,36]},
      {"id":"dist-c",  "label":"Distribution C",  "portRange":[37,48]},
      {"id":"dist-d",  "label":"Distribution D",  "portRange":[49,60]},
      {"id":"dist-e",  "label":"Distribution E",  "portRange":[61,72]}
    ]}'::jsonb, 72, 72
  where not exists (
    select 1 from public.asset_models where model_name = 'ODC-72' and asset_type_id = v_odc
  );

  insert into public.asset_models
    (model_name, asset_type_id, description, tray_config, capacity_core, total_ports)
  select 'ODC-96', v_odc, 'ODC 96 port — 1 feeder + 7 distribusi',
    '{"trays":[
      {"id":"feeder",  "label":"Feeder",          "portRange":[1,12]},
      {"id":"dist-a",  "label":"Distribution A",  "portRange":[13,24]},
      {"id":"dist-b",  "label":"Distribution B",  "portRange":[25,36]},
      {"id":"dist-c",  "label":"Distribution C",  "portRange":[37,48]},
      {"id":"dist-d",  "label":"Distribution D",  "portRange":[49,60]},
      {"id":"dist-e",  "label":"Distribution E",  "portRange":[61,72]},
      {"id":"dist-f",  "label":"Distribution F",  "portRange":[73,84]},
      {"id":"dist-g",  "label":"Distribution G",  "portRange":[85,96]}
    ]}'::jsonb, 96, 96
  where not exists (
    select 1 from public.asset_models where model_name = 'ODC-96' and asset_type_id = v_odc
  );

  -- ── ODP ──────────────────────────────────────────────────────────────────
  insert into public.asset_models
    (model_name, asset_type_id, description, capacity_core, total_ports)
  select 'ODP-8', v_odp, 'ODP 8 port splitter 1:8', 8, 8
  where not exists (
    select 1 from public.asset_models where model_name = 'ODP-8' and asset_type_id = v_odp
  );

  insert into public.asset_models
    (model_name, asset_type_id, description, capacity_core, total_ports)
  select 'ODP-16', v_odp, 'ODP 16 port splitter 1:16', 16, 16
  where not exists (
    select 1 from public.asset_models where model_name = 'ODP-16' and asset_type_id = v_odp
  );

  insert into public.asset_models
    (model_name, asset_type_id, description, capacity_core, total_ports)
  select 'ODP-32', v_odp, 'ODP 32 port splitter 1:32', 32, 32
  where not exists (
    select 1 from public.asset_models where model_name = 'ODP-32' and asset_type_id = v_odp
  );

  -- ── JC ───────────────────────────────────────────────────────────────────
  insert into public.asset_models
    (model_name, asset_type_id, description, tray_config, capacity_core, total_ports)
  select 'JC-24', v_jc, 'Joint Closure 24 core',
    '{"trays":[{"id":"main","label":"Tray","portRange":[1,24]}]}'::jsonb, 24, 24
  where not exists (
    select 1 from public.asset_models where model_name = 'JC-24' and asset_type_id = v_jc
  );

  insert into public.asset_models
    (model_name, asset_type_id, description, tray_config, capacity_core, total_ports)
  select 'JC-48', v_jc, 'Joint Closure 48 core',
    '{"trays":[
      {"id":"tray-1","label":"Tray 1","portRange":[1,24]},
      {"id":"tray-2","label":"Tray 2","portRange":[25,48]}
    ]}'::jsonb, 48, 48
  where not exists (
    select 1 from public.asset_models where model_name = 'JC-48' and asset_type_id = v_jc
  );

  insert into public.asset_models
    (model_name, asset_type_id, description, tray_config, capacity_core, total_ports)
  select 'JC-96', v_jc, 'Joint Closure 96 core',
    '{"trays":[
      {"id":"tray-1","label":"Tray 1","portRange":[1,24]},
      {"id":"tray-2","label":"Tray 2","portRange":[25,48]},
      {"id":"tray-3","label":"Tray 3","portRange":[49,72]},
      {"id":"tray-4","label":"Tray 4","portRange":[73,96]}
    ]}'::jsonb, 96, 96
  where not exists (
    select 1 from public.asset_models where model_name = 'JC-96' and asset_type_id = v_jc
  );

  insert into public.asset_models
    (model_name, asset_type_id, description, tray_config, capacity_core, total_ports)
  select 'JC-144', v_jc, 'Joint Closure 144 core',
    '{"trays":[
      {"id":"tray-1","label":"Tray 1","portRange":[1,24]},
      {"id":"tray-2","label":"Tray 2","portRange":[25,48]},
      {"id":"tray-3","label":"Tray 3","portRange":[49,72]},
      {"id":"tray-4","label":"Tray 4","portRange":[73,96]},
      {"id":"tray-5","label":"Tray 5","portRange":[97,120]},
      {"id":"tray-6","label":"Tray 6","portRange":[121,144]}
    ]}'::jsonb, 144, 144
  where not exists (
    select 1 from public.asset_models where model_name = 'JC-144' and asset_type_id = v_jc
  );

  -- ── OLT ──────────────────────────────────────────────────────────────────
  insert into public.asset_models
    (model_name, asset_type_id, description, total_ports)
  select 'OLT-16PON', v_olt, 'OLT 16 PON port', 16
  where not exists (
    select 1 from public.asset_models where model_name = 'OLT-16PON' and asset_type_id = v_olt
  );

  insert into public.asset_models
    (model_name, asset_type_id, description, total_ports)
  select 'OLT-32PON', v_olt, 'OLT 32 PON port', 32
  where not exists (
    select 1 from public.asset_models where model_name = 'OLT-32PON' and asset_type_id = v_olt
  );

  -- ── SWITCH ───────────────────────────────────────────────────────────────
  insert into public.asset_models
    (model_name, asset_type_id, description, total_ports)
  select 'SWITCH-24', v_sw, 'Switch 24 port', 24
  where not exists (
    select 1 from public.asset_models where model_name = 'SWITCH-24' and asset_type_id = v_sw
  );

  insert into public.asset_models
    (model_name, asset_type_id, description, total_ports)
  select 'SWITCH-48', v_sw, 'Switch 48 port', 48
  where not exists (
    select 1 from public.asset_models where model_name = 'SWITCH-48' and asset_type_id = v_sw
  );

  raise notice 'Canonical asset models seeded successfully';
end $$;

-- Backfill capacity_core + total_ports untuk model yang sudah ada tapi belum punya nilai
update public.asset_models am
set
  capacity_core = coalesce(am.capacity_core,
    case
      when am.model_name ilike '%144%' then 144
      when am.model_name ilike '%96%'  then 96
      when am.model_name ilike '%72%'  then 72
      when am.model_name ilike '%48%'  then 48
      when am.model_name ilike '%32%'  then 32
      when am.model_name ilike '%24%'  then 24
      when am.model_name ilike '%16%'  then 16
      when am.model_name ilike '%8%'   then 8
    end
  ),
  total_ports = coalesce(am.total_ports,
    case
      when am.model_name ilike '%144%' then 144
      when am.model_name ilike '%96%'  then 96
      when am.model_name ilike '%72%'  then 72
      when am.model_name ilike '%48%'  then 48
      when am.model_name ilike '%32%'  then 32
      when am.model_name ilike '%24%'  then 24
      when am.model_name ilike '%16%'  then 16
      when am.model_name ilike '%8%'   then 8
    end
  )
where am.deleted_at is null
  and (am.capacity_core is null or am.total_ports is null);
