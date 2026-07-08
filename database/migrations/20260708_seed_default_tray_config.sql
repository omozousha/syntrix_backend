-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: Default tray_config untuk model OTB/ODC/JC
-- Description: Mengisi tray_config default ke asset_models yang sudah ada
--              berdasarkan tipe aset (asset_types.type_name).
-- Tanggal: 2026-07-08
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) OTB — Dynamic layout: 12 port per tray
-- Frontend akan auto-generate tray dari total_ports device.
update public.asset_models am
set tray_config = '{"ports_per_tray": 12}'::jsonb
from public.asset_types at
where am.asset_type_id = at.id
  and at.type_name = 'OTB'
  and (
    am.tray_config is null
    or am.tray_config = '{}'::jsonb
  );

-- 2) ODC — 4 tray static layout (feeder + dist A/B/C)
update public.asset_models am
set tray_config = '{
  "trays": [
    {"id": "feeder", "label": "Feeder", "portRange": [1, 12]},
    {"id": "dist-a", "label": "Distribution A", "portRange": [13, 24]},
    {"id": "dist-b", "label": "Distribution B", "portRange": [25, 36]},
    {"id": "dist-c", "label": "Distribution C", "portRange": [37, 48]}
  ]
}'::jsonb
from public.asset_types at
where am.asset_type_id = at.id
  and at.type_name = 'ODC'
  and (
    am.tray_config is null
    or am.tray_config = '{}'::jsonb
  );

-- 3) JC — 1 tray static layout
update public.asset_models am
set tray_config = '{
  "trays": [
    {"id": "main", "label": "Tray", "portRange": [1, 24]}
  ]
}'::jsonb
from public.asset_types at
where am.asset_type_id = at.id
  and at.type_name = 'JC'
  and (
    am.tray_config is null
    or am.tray_config = '{}'::jsonb
  );

-- 4) Verifikasi hasil seed
select
  at.type_name,
  count(am.id) as total_models,
  count(am.tray_config) filter (where am.tray_config is not null and am.tray_config <> '{}'::jsonb) as seeded
from public.asset_types at
left join public.asset_models am on am.asset_type_id = at.id
where at.type_name in ('OTB', 'ODC', 'JC')
group by at.type_name
order by at.type_name;
