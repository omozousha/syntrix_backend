-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Add tray_config to asset_models table
-- Description: Menambahkan kolom tray_config (jsonb) untuk menyimpan konfigurasi
--              layout tray port perangkat (OTB, ODC, JC) dari master data.
--              Digunakan oleh Fase 2d — Visual Port Tray layout rules.
-- Tanggal: 2026-07-08
-- ─────────────────────────────────────────────────────────────────────────────

alter table if exists public.asset_models
  add column if not exists tray_config jsonb not null default '{}'::jsonb;

comment on column public.asset_models.tray_config is
  'Konfigurasi layout tray port untuk visual port tray.
   Format JSON:
   {
     "ports_per_tray": 12,          -- Jumlah port per tray (dynamic layout)
     "trays": [                     -- Atau: static layout (override default)
       { "id": "A", "label": "Tray A", "portRange": [1, 12] },
       { "id": "B", "label": "Tray B", "portRange": [13, 24] }
     ]
   }
   Jika kosong ({}), sistem akan menggunakan layout default per device type:
   - OTB: generateTrayLayout(total_ports, 12) — dinamis 12 port/tray
   - ODC: 4 tray (feeder + dist A/B/C)
   - JC: 1 tray';

-- Update schema.sql reference for fresh installs
-- Note: This column is also reflected in backend validations and frontend
-- port-tray-types.ts -> parseTrayConfigFromPayload() -> resolveTrayLayout()
