-- ─────────────────────────────────────────────────────────────────────────────
-- Test Data: Topologi Jaringan Serat Optik — Jawa Tengah
-- ─────────────────────────────────────────────────────────────────────────────
-- Topologi:
--   OTB Semarang (96c)
--     └── Feeder Cable (48c, 1km)
--          └── ODC Semarang (96c, 48 feeder + 36 distribution)
--               ├── Distribusi-1 (12c, 3km) → ODP-01, ODP-02, ODP-03 (1:8)
--               ├── Distribusi-2 (12c, 3km) → ODP-04, ODP-05, ODP-06 (1:8)
--               └── Distribusi-3 (12c, 3km) → ODP-07, ODP-08, ODP-09 (1:8)
--
-- Note: Aman dijalankan berulang kali (pakai if not exists guard).
--
-- Cara pakai: Hasura Console → tab SQL → Paste → Run
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  -- === REGION ===
  v_region_id uuid;

  -- === POP & PROJECT ===
  v_pop_id uuid;
  v_project_id uuid;

  -- === DEVICES ===
  v_otb_id uuid;
  v_feeder_cable_id uuid;
  v_odc_id uuid;
  v_dist_cable_id_1 uuid;
  v_dist_cable_id_2 uuid;
  v_dist_cable_id_3 uuid;
  v_odp_id uuid;

  -- === ROUTES ===
  v_route_feeder_id uuid;
  v_route_dist_1_id uuid;
  v_route_dist_2_id uuid;
  v_route_dist_3_id uuid;

begin
  -- ==========================================================================
  -- 1. REGION — Jawa Tengah
  -- ==========================================================================
  select id into v_region_id
  from public.regions
  where region_name = 'Jawa Tengah';

  if v_region_id is null then
    raise exception 'Region "Jawa Tengah" not found. Jalankan schema.sql seed data terlebih dahulu.';
  end if;

  raise notice '[1/8] Region: %', v_region_id;

  -- ==========================================================================
  -- 2. POP — Semarang
  -- ==========================================================================
  insert into public.pops (
    pop_code, pop_name, region_id,
    address, province, city,
    longitude, latitude,
    status_pop, pop_type
  )
  values (
    'SMG', 'POP Semarang', v_region_id,
    'Jl. Pahlawan No. 1, Semarang', 'Jawa Tengah', 'Semarang',
    110.4098, -6.9667,
    'active', 'metro'
  )
  on conflict (pop_code) do update set
    pop_name = excluded.pop_name,
    region_id = excluded.region_id
  returning id into v_pop_id;

  raise notice '[2/8] POP: %', v_pop_id;

  -- ==========================================================================
  -- 3. PROJECT — Pembangunan Jaringan Semarang
  -- ==========================================================================
  if not exists (select 1 from public.projects where project_name = 'Proyek Jaringan Serat Optik Semarang') then
    insert into public.projects (
      project_name, region_id, pop_id,
      status, description,
      start_date, end_date
    )
    values (
      'Proyek Jaringan Serat Optik Semarang', v_region_id, v_pop_id,
      'running',
      'Pembangunan infrastruktur FTTH Semarang — 1 OTB, 1 ODC, 9 ODP',
      '2026-01-01', '2026-12-31'
    )
    returning id into v_project_id;
  else
    select id into v_project_id
    from public.projects
    where project_name = 'Proyek Jaringan Serat Optik Semarang';
  end if;

  raise notice '[3/8] Project: %', v_project_id;

  -- ==========================================================================
  -- 4. OTB — Optical Termination Box (96 core)
  -- ==========================================================================
  if not exists (select 1 from public.devices where device_name = 'OTB Semarang') then
    insert into public.devices (
      device_name, asset_group, device_type_key,
      region_id, pop_id, project_id,
      capacity_core, used_core,
      total_ports, used_ports,
      status, address, province, city,
      longitude, latitude,
      notes
    )
    values (
      'OTB Semarang', 'passive', 'OTB',
      v_region_id, v_pop_id, v_project_id,
      96, 48,  -- 96 core capacity, 48 used (terpakai feeder)
      null, null,
      'active', 'Jl. Pahlawan No. 1, Semarang', 'Jawa Tengah', 'Semarang',
      110.4098, -6.9667,
      'OTB utama untuk terminasi kabel backbone — 96 core, 48 core terpakai feeder'
    )
    returning id into v_otb_id;
  else
    select id into v_otb_id from public.devices where device_name = 'OTB Semarang';
  end if;

  raise notice '[4/8] OTB: % (96c, used 48)', v_otb_id;

  -- ==========================================================================
  -- 5. FEEDER CABLE (48 core, 1km) — OTB → ODC
  -- ==========================================================================
  if not exists (select 1 from public.devices where device_name = 'Feeder OTB-ODC Semarang') then
    insert into public.devices (
      device_name, asset_group, device_type_key,
      region_id, pop_id, project_id,
      capacity_core, used_core,
      route_name, route_type, cable_type, cable_length_m,
      status, notes
    )
    values (
      'Feeder OTB-ODC Semarang', 'passive', 'CABLE',
      v_region_id, v_pop_id, v_project_id,
      48, 48,
      'Rute Feeder OTB-ODC Semarang', 'feeder', 'fiber_loose_tube', 1000,
      'active', 'Kabel feeder 48 core, 1 km — menghubungkan OTB ke ODC'
    )
    returning id into v_feeder_cable_id;
  else
    select id into v_feeder_cable_id from public.devices where device_name = 'Feeder OTB-ODC Semarang';
  end if;

  raise notice '[5/8] Feeder: % (48c, 1km)', v_feeder_cable_id;

  -- ==========================================================================
  -- 6. ODC — Optical Distribution Cabinet (96 core)
  -- ==========================================================================
  if not exists (select 1 from public.devices where device_name = 'ODC Semarang') then
    insert into public.devices (
      device_name, asset_group, device_type_key,
      region_id, pop_id, project_id,
      capacity_core, used_core,
      total_ports, used_ports,
      feeder_port_count, distribution_port_count,
      status, address, province, city,
      longitude, latitude,
      notes
    )
    values (
      'ODC Semarang', 'passive', 'ODC',
      v_region_id, v_pop_id, v_project_id,
      96, 9,  -- 96 core capacity, 9 used (1 core per ODP)
      null, null,
      48, 36,
      'active', 'Jl. Pemuda No. 25, Semarang', 'Jawa Tengah', 'Semarang',
      110.4178, -6.9732,
      'ODC distribusi — 48 feeder ports (dari OTB), 36 distribution ports (ke ODP)'
    )
    returning id into v_odc_id;
  else
    select id into v_odc_id from public.devices where device_name = 'ODC Semarang';
  end if;

  raise notice '[6/8] ODC: % (96c, 48F+36D)', v_odc_id;

  -- ==========================================================================
  -- 7. ROUTE FISIK (network_routes)
  -- ==========================================================================

  -- 7a. Route Feeder (OTB → ODC)
  if not exists (select 1 from public.network_routes where route_name = 'Rute Feeder OTB-ODC') then
    insert into public.network_routes (
      route_name, route_type, region_id, pop_id, project_id,
      start_asset_id, end_asset_id, distance_meters,
      status
    )
    values (
      'Rute Feeder OTB-ODC', 'feeder', v_region_id, v_pop_id, v_project_id,
      v_otb_id, v_odc_id, 1000,
      'active'
    )
    returning id into v_route_feeder_id;
  else
    select id into v_route_feeder_id from public.network_routes where route_name = 'Rute Feeder OTB-ODC';
  end if;

  raise notice '[7/8] Route Feeder: % (OTB ↔ ODC, 1km)', v_route_feeder_id;

  -- 7b. Route Distribusi 1 (ODC → ODP-01..03)
  if not exists (select 1 from public.network_routes where route_name = 'Rute Distribusi-1 ODC ke ODP 1-3') then
    insert into public.network_routes (
      route_name, route_type, region_id, pop_id, project_id,
      start_asset_id, distance_meters,
      status
    )
    values (
      'Rute Distribusi-1 ODC ke ODP 1-3', 'distribution', v_region_id, v_pop_id, v_project_id,
      v_odc_id, 3000,
      'active'
    )
    returning id into v_route_dist_1_id;
  else
    select id into v_route_dist_1_id from public.network_routes where route_name = 'Rute Distribusi-1 ODC ke ODP 1-3';
  end if;

  -- 7c. Route Distribusi 2 (ODC → ODP-04..06)
  if not exists (select 1 from public.network_routes where route_name = 'Rute Distribusi-2 ODC ke ODP 4-6') then
    insert into public.network_routes (
      route_name, route_type, region_id, pop_id, project_id,
      start_asset_id, distance_meters,
      status
    )
    values (
      'Rute Distribusi-2 ODC ke ODP 4-6', 'distribution', v_region_id, v_pop_id, v_project_id,
      v_odc_id, 3000,
      'active'
    )
    returning id into v_route_dist_2_id;
  else
    select id into v_route_dist_2_id from public.network_routes where route_name = 'Rute Distribusi-2 ODC ke ODP 4-6';
  end if;

  -- 7d. Route Distribusi 3 (ODC → ODP-07..09)
  if not exists (select 1 from public.network_routes where route_name = 'Rute Distribusi-3 ODC ke ODP 7-9') then
    insert into public.network_routes (
      route_name, route_type, region_id, pop_id, project_id,
      start_asset_id, distance_meters,
      status
    )
    values (
      'Rute Distribusi-3 ODC ke ODP 7-9', 'distribution', v_region_id, v_pop_id, v_project_id,
      v_odc_id, 3000,
      'active'
    )
    returning id into v_route_dist_3_id;
  else
    select id into v_route_dist_3_id from public.network_routes where route_name = 'Rute Distribusi-3 ODC ke ODP 7-9';
  end if;

  -- ==========================================================================
  -- 8. DISTRIBUTION CABLES + ODPs + LINKS + PORTS
  -- ==========================================================================

  -- --------------------------------------------------------------------------
  -- DISTRIBUSI-1 (12c, 3km) → ODP-01, ODP-02, ODP-03
  -- --------------------------------------------------------------------------
  if not exists (select 1 from public.devices where device_name = 'Kabel Distribusi-1 ODC ke ODP 1-3') then
    insert into public.devices (
      device_name, asset_group, device_type_key,
      region_id, pop_id, project_id,
      capacity_core, used_core,
      route_name, route_type, cable_type, cable_length_m,
      status, notes
    )
    values (
      'Kabel Distribusi-1 ODC ke ODP 1-3', 'passive', 'CABLE',
      v_region_id, v_pop_id, v_project_id,
      12, 3,  -- 12 core, 3 used (1 per ODP)
      'Rute Distribusi-1', 'distribution', 'fiber_loose_tube', 3000,
      'active', 'Kabel distribusi 12 core, 3 km — melayani ODP-01 s.d. ODP-03'
    )
    returning id into v_dist_cable_id_1;
  else
    select id into v_dist_cable_id_1 from public.devices where device_name = 'Kabel Distribusi-1 ODC ke ODP 1-3';
  end if;

  -- ODP-01
  if not exists (select 1 from public.devices where device_name = 'ODP-01 Semarang') then
    insert into public.devices (
      device_name, asset_group, device_type_key,
      region_id, pop_id, project_id,
      splitter_ratio, total_ports, used_ports,
      source_odc_id, feeder_cable_id, feeder_core_start, feeder_core_end,
      status, address, province, city,
      longitude, latitude, notes
    )
    values (
      'ODP-01 Semarang', 'passive', 'ODP',
      v_region_id, v_pop_id, v_project_id,
      '1:8', 8, 0,
      v_odc_id, v_dist_cable_id_1, 1, 1,
      'active', 'Jl. Gajahmada No. 10, Semarang', 'Jawa Tengah', 'Semarang',
      110.4212, -6.9781, 'ODP-01 — Distribusi-1 core 1, splitter 1:8'
    );
  end if;

  -- ODP-02
  if not exists (select 1 from public.devices where device_name = 'ODP-02 Semarang') then
    insert into public.devices (
      device_name, asset_group, device_type_key,
      region_id, pop_id, project_id,
      splitter_ratio, total_ports, used_ports,
      source_odc_id, feeder_cable_id, feeder_core_start, feeder_core_end,
      status, address, province, city,
      longitude, latitude, notes
    )
    values (
      'ODP-02 Semarang', 'passive', 'ODP',
      v_region_id, v_pop_id, v_project_id,
      '1:8', 8, 0,
      v_odc_id, v_dist_cable_id_1, 2, 2,
      'active', 'Jl. MT Haryono No. 15, Semarang', 'Jawa Tengah', 'Semarang',
      110.4235, -6.9805, 'ODP-02 — Distribusi-1 core 2, splitter 1:8'
    );
  end if;

  -- ODP-03
  if not exists (select 1 from public.devices where device_name = 'ODP-03 Semarang') then
    insert into public.devices (
      device_name, asset_group, device_type_key,
      region_id, pop_id, project_id,
      splitter_ratio, total_ports, used_ports,
      source_odc_id, feeder_cable_id, feeder_core_start, feeder_core_end,
      status, address, province, city,
      longitude, latitude, notes
    )
    values (
      'ODP-03 Semarang', 'passive', 'ODP',
      v_region_id, v_pop_id, v_project_id,
      '1:8', 8, 0,
      v_odc_id, v_dist_cable_id_1, 3, 3,
      'active', 'Jl. Pandanaran No. 20, Semarang', 'Jawa Tengah', 'Semarang',
      110.4258, -6.9828, 'ODP-03 — Distribusi-1 core 3, splitter 1:8'
    );
  end if;

  -- --------------------------------------------------------------------------
  -- DISTRIBUSI-2 (12c, 3km) → ODP-04, ODP-05, ODP-06
  -- --------------------------------------------------------------------------
  if not exists (select 1 from public.devices where device_name = 'Kabel Distribusi-2 ODC ke ODP 4-6') then
    insert into public.devices (
      device_name, asset_group, device_type_key,
      region_id, pop_id, project_id,
      capacity_core, used_core,
      route_name, route_type, cable_type, cable_length_m,
      status, notes
    )
    values (
      'Kabel Distribusi-2 ODC ke ODP 4-6', 'passive', 'CABLE',
      v_region_id, v_pop_id, v_project_id,
      12, 3,
      'Rute Distribusi-2', 'distribution', 'fiber_loose_tube', 3000,
      'active', 'Kabel distribusi 12 core, 3 km — melayani ODP-04 s.d. ODP-06'
    )
    returning id into v_dist_cable_id_2;
  else
    select id into v_dist_cable_id_2 from public.devices where device_name = 'Kabel Distribusi-2 ODC ke ODP 4-6';
  end if;

  -- ODP-04
  if not exists (select 1 from public.devices where device_name = 'ODP-04 Semarang') then
    insert into public.devices (
      device_name, asset_group, device_type_key,
      region_id, pop_id, project_id,
      splitter_ratio, total_ports, used_ports,
      source_odc_id, feeder_cable_id, feeder_core_start, feeder_core_end,
      status, address, province, city,
      longitude, latitude, notes
    )
    values (
      'ODP-04 Semarang', 'passive', 'ODP',
      v_region_id, v_pop_id, v_project_id,
      '1:8', 8, 0,
      v_odc_id, v_dist_cable_id_2, 1, 1,
      'active', 'Jl. Veteran No. 5, Semarang', 'Jawa Tengah', 'Semarang',
      110.4152, -6.9755, 'ODP-04 — Distribusi-2 core 1, splitter 1:8'
    );
  end if;

  -- ODP-05
  if not exists (select 1 from public.devices where device_name = 'ODP-05 Semarang') then
    insert into public.devices (
      device_name, asset_group, device_type_key,
      region_id, pop_id, project_id,
      splitter_ratio, total_ports, used_ports,
      source_odc_id, feeder_cable_id, feeder_core_start, feeder_core_end,
      status, address, province, city,
      longitude, latitude, notes
    )
    values (
      'ODP-05 Semarang', 'passive', 'ODP',
      v_region_id, v_pop_id, v_project_id,
      '1:8', 8, 0,
      v_odc_id, v_dist_cable_id_2, 2, 2,
      'active', 'Jl. Sutomo No. 8, Semarang', 'Jawa Tengah', 'Semarang',
      110.4190, -6.9772, 'ODP-05 — Distribusi-2 core 2, splitter 1:8'
    );
  end if;

  -- ODP-06
  if not exists (select 1 from public.devices where device_name = 'ODP-06 Semarang') then
    insert into public.devices (
      device_name, asset_group, device_type_key,
      region_id, pop_id, project_id,
      splitter_ratio, total_ports, used_ports,
      source_odc_id, feeder_cable_id, feeder_core_start, feeder_core_end,
      status, address, province, city,
      longitude, latitude, notes
    )
    values (
      'ODP-06 Semarang', 'passive', 'ODP',
      v_region_id, v_pop_id, v_project_id,
      '1:8', 8, 0,
      v_odc_id, v_dist_cable_id_2, 3, 3,
      'active', 'Jl. Diponegoro No. 12, Semarang', 'Jawa Tengah', 'Semarang',
      110.4218, -6.9798, 'ODP-06 — Distribusi-2 core 3, splitter 1:8'
    );
  end if;

  -- --------------------------------------------------------------------------
  -- DISTRIBUSI-3 (12c, 3km) → ODP-07, ODP-08, ODP-09
  -- --------------------------------------------------------------------------
  if not exists (select 1 from public.devices where device_name = 'Kabel Distribusi-3 ODC ke ODP 7-9') then
    insert into public.devices (
      device_name, asset_group, device_type_key,
      region_id, pop_id, project_id,
      capacity_core, used_core,
      route_name, route_type, cable_type, cable_length_m,
      status, notes
    )
    values (
      'Kabel Distribusi-3 ODC ke ODP 7-9', 'passive', 'CABLE',
      v_region_id, v_pop_id, v_project_id,
      12, 3,
      'Rute Distribusi-3', 'distribution', 'fiber_loose_tube', 3000,
      'active', 'Kabel distribusi 12 core, 3 km — melayani ODP-07 s.d. ODP-09'
    )
    returning id into v_dist_cable_id_3;
  else
    select id into v_dist_cable_id_3 from public.devices where device_name = 'Kabel Distribusi-3 ODC ke ODP 7-9';
  end if;

  -- ODP-07
  if not exists (select 1 from public.devices where device_name = 'ODP-07 Semarang') then
    insert into public.devices (
      device_name, asset_group, device_type_key,
      region_id, pop_id, project_id,
      splitter_ratio, total_ports, used_ports,
      source_odc_id, feeder_cable_id, feeder_core_start, feeder_core_end,
      status, address, province, city,
      longitude, latitude, notes
    )
    values (
      'ODP-07 Semarang', 'passive', 'ODP',
      v_region_id, v_pop_id, v_project_id,
      '1:8', 8, 0,
      v_odc_id, v_dist_cable_id_3, 1, 1,
      'active', 'Jl. Ahmad Yani No. 30, Semarang', 'Jawa Tengah', 'Semarang',
      110.4275, -6.9845, 'ODP-07 — Distribusi-3 core 1, splitter 1:8'
    );
  end if;

  -- ODP-08
  if not exists (select 1 from public.devices where device_name = 'ODP-08 Semarang') then
    insert into public.devices (
      device_name, asset_group, device_type_key,
      region_id, pop_id, project_id,
      splitter_ratio, total_ports, used_ports,
      source_odc_id, feeder_cable_id, feeder_core_start, feeder_core_end,
      status, address, province, city,
      longitude, latitude, notes
    )
    values (
      'ODP-08 Semarang', 'passive', 'ODP',
      v_region_id, v_pop_id, v_project_id,
      '1:8', 8, 0,
      v_odc_id, v_dist_cable_id_3, 2, 2,
      'active', 'Jl. Siliwangi No. 18, Semarang', 'Jawa Tengah', 'Semarang',
      110.4300, -6.9868, 'ODP-08 — Distribusi-3 core 2, splitter 1:8'
    );
  end if;

  -- ODP-09
  if not exists (select 1 from public.devices where device_name = 'ODP-09 Semarang') then
    insert into public.devices (
      device_name, asset_group, device_type_key,
      region_id, pop_id, project_id,
      splitter_ratio, total_ports, used_ports,
      source_odc_id, feeder_cable_id, feeder_core_start, feeder_core_end,
      status, address, province, city,
      longitude, latitude, notes
    )
    values (
      'ODP-09 Semarang', 'passive', 'ODP',
      v_region_id, v_pop_id, v_project_id,
      '1:8', 8, 0,
      v_odc_id, v_dist_cable_id_3, 3, 3,
      'active', 'Jl. Wolter Monginsidi No. 22, Semarang', 'Jawa Tengah', 'Semarang',
      110.4325, -6.9890, 'ODP-09 — Distribusi-3 core 3, splitter 1:8'
    );
  end if;

  -- ==========================================================================
  -- 9. DEVICE LINKS — Logical connectivity (pakai if not exists)
  -- ==========================================================================

  -- Link: OTB → ODC via Feeder Cable
  if not exists (
    select 1 from public.device_links
    where from_device_id = v_otb_id and to_device_id = v_odc_id
      and link_type = 'fiber'
  ) then
    insert into public.device_links (
      region_id, from_device_id, to_device_id,
      link_type, route_id, cable_device_id,
      fiber_count, status, notes
    )
    values (
      v_region_id, v_otb_id, v_odc_id,
      'fiber', v_route_feeder_id, v_feeder_cable_id,
      48, 'active',
      'Link OTB ke ODC via kabel feeder 48 core'
    );
  end if;

  -- Link: ODC → Distribusi-1 (kabel distribusi-1)
  if not exists (
    select 1 from public.device_links
    where route_id = v_route_dist_1_id and cable_device_id = v_dist_cable_id_1
  ) then
    insert into public.device_links (
      region_id, from_device_id, to_device_id,
      link_type, route_id, cable_device_id,
      fiber_count, core_start, core_end, status,
      notes
    )
    values (
      v_region_id, v_odc_id, v_dist_cable_id_1,
      'distribution', v_route_dist_1_id, v_dist_cable_id_1,
      12, 1, 12, 'active',
      'Link ODC ke Distribusi-1 (12 core, 3 km) — menuju ODP 1-3'
    );
  end if;

  -- Link: ODC → Distribusi-2 (kabel distribusi-2)
  if not exists (
    select 1 from public.device_links
    where route_id = v_route_dist_2_id and cable_device_id = v_dist_cable_id_2
  ) then
    insert into public.device_links (
      region_id, from_device_id, to_device_id,
      link_type, route_id, cable_device_id,
      fiber_count, core_start, core_end, status,
      notes
    )
    values (
      v_region_id, v_odc_id, v_dist_cable_id_2,
      'distribution', v_route_dist_2_id, v_dist_cable_id_2,
      12, 1, 12, 'active',
      'Link ODC ke Distribusi-2 (12 core, 3 km) — menuju ODP 4-6'
    );
  end if;

  -- Link: ODC → Distribusi-3 (kabel distribusi-3)
  if not exists (
    select 1 from public.device_links
    where route_id = v_route_dist_3_id and cable_device_id = v_dist_cable_id_3
  ) then
    insert into public.device_links (
      region_id, from_device_id, to_device_id,
      link_type, route_id, cable_device_id,
      fiber_count, core_start, core_end, status,
      notes
    )
    values (
      v_region_id, v_odc_id, v_dist_cable_id_3,
      'distribution', v_route_dist_3_id, v_dist_cable_id_3,
      12, 1, 12, 'active',
      'Link ODC ke Distribusi-3 (12 core, 3 km) — menuju ODP 7-9'
    );
  end if;

  -- ==========================================================================
  -- 10. DEVICE PORTS + PORT CONNECTIONS
  -- ==========================================================================

  -- OTB Ports
  if not exists (select 1 from public.device_ports where device_id = v_otb_id and port_index = 1) then
    insert into public.device_ports (device_id, region_id, port_index, port_label, port_type, direction, status, notes)
    values
      (v_otb_id, v_region_id, 1, 'IN-Backbone', 'fiber', 'in', 'used', 'Input dari backbone — terminasi'),
      (v_otb_id, v_region_id, 2, 'OUT-Feeder', 'fiber', 'out', 'used', 'Output ke kabel feeder 48c menuju ODC');
  end if;

  -- Feeder Cable Ports
  if not exists (select 1 from public.device_ports where device_id = v_feeder_cable_id and port_index = 1) then
    insert into public.device_ports (device_id, region_id, port_index, port_label, port_type, direction, status, notes)
    values
      (v_feeder_cable_id, v_region_id, 1, 'Terminal-OTB', 'fiber', 'in', 'used', 'Terminasi sisi OTB'),
      (v_feeder_cable_id, v_region_id, 2, 'Terminal-ODC', 'fiber', 'out', 'used', 'Terminasi sisi ODC');
  end if;

  -- ODC Ports
  if not exists (select 1 from public.device_ports where device_id = v_odc_id and port_index = 1) then
    insert into public.device_ports (device_id, region_id, port_index, port_label, port_type, direction, status, notes)
    values
      (v_odc_id, v_region_id, 1, 'Feeder-IN', 'fiber', 'in', 'used', 'Input dari kabel feeder 48c (dari OTB)'),
      (v_odc_id, v_region_id, 2, 'Dist-1-OUT', 'fiber', 'out', 'used', 'Output ke kabel distribusi-1 (12c, ke ODP 1-3)'),
      (v_odc_id, v_region_id, 3, 'Dist-2-OUT', 'fiber', 'out', 'used', 'Output ke kabel distribusi-2 (12c, ke ODP 4-6)'),
      (v_odc_id, v_region_id, 4, 'Dist-3-OUT', 'fiber', 'out', 'used', 'Output ke kabel distribusi-3 (12c, ke ODP 7-9)');
  end if;

  -- Distribution Cable Ports (Dist-1, Dist-2, Dist-3)
  if not exists (select 1 from public.device_ports where device_id = v_dist_cable_id_1 and port_index = 1) then
    insert into public.device_ports (device_id, region_id, port_index, port_label, port_type, direction, status, notes)
    values
      (v_dist_cable_id_1, v_region_id, 1, 'Terminal-ODC', 'fiber', 'in', 'used', 'Terminasi sisi ODC'),
      (v_dist_cable_id_1, v_region_id, 2, 'Terminal-ODP', 'fiber', 'out', 'used', 'Terminasi sisi ODP (cabang)'),
      (v_dist_cable_id_2, v_region_id, 1, 'Terminal-ODC', 'fiber', 'in', 'used', 'Terminasi sisi ODC'),
      (v_dist_cable_id_2, v_region_id, 2, 'Terminal-ODP', 'fiber', 'out', 'used', 'Terminasi sisi ODP (cabang)'),
      (v_dist_cable_id_3, v_region_id, 1, 'Terminal-ODC', 'fiber', 'in', 'used', 'Terminasi sisi ODC'),
      (v_dist_cable_id_3, v_region_id, 2, 'Terminal-ODP', 'fiber', 'out', 'used', 'Terminasi sisi ODP (cabang)');
  end if;

  -- PORT CONNECTIONS (hanya insert jika belum ada)
  -- OTB:Port2 (OUT-Feeder) → Feeder Cable:Port1 (Terminal-OTB)
  if not exists (
    select 1 from public.port_connections pc
    join public.device_ports fp on fp.id = pc.from_port_id
    join public.device_ports tp on tp.id = pc.to_port_id
    where fp.device_id = v_otb_id and fp.port_label = 'OUT-Feeder'
      and tp.device_id = v_feeder_cable_id and tp.port_label = 'Terminal-OTB'
  ) then
    insert into public.port_connections (region_id, from_port_id, to_port_id, connection_type, route_id, cable_device_id, fiber_count, status, notes)
    select v_region_id, fp.id, tp.id, 'fiber', v_route_feeder_id, v_feeder_cable_id, 48, 'active', 'Koneksi OTB ke kabel feeder — 48 core'
    from public.device_ports fp, public.device_ports tp
    where fp.device_id = v_otb_id and fp.port_label = 'OUT-Feeder'
      and tp.device_id = v_feeder_cable_id and tp.port_label = 'Terminal-OTB';
  end if;

  -- Feeder Cable:Port2 (Terminal-ODC) → ODC:Port1 (Feeder-IN)
  if not exists (
    select 1 from public.port_connections pc
    join public.device_ports fp on fp.id = pc.from_port_id
    join public.device_ports tp on tp.id = pc.to_port_id
    where fp.device_id = v_feeder_cable_id and fp.port_label = 'Terminal-ODC'
      and tp.device_id = v_odc_id and tp.port_label = 'Feeder-IN'
  ) then
    insert into public.port_connections (region_id, from_port_id, to_port_id, connection_type, route_id, cable_device_id, fiber_count, status, notes)
    select v_region_id, fp.id, tp.id, 'fiber', v_route_feeder_id, v_feeder_cable_id, 48, 'active', 'Koneksi kabel feeder ke ODC — 48 core'
    from public.device_ports fp, public.device_ports tp
    where fp.device_id = v_feeder_cable_id and fp.port_label = 'Terminal-ODC'
      and tp.device_id = v_odc_id and tp.port_label = 'Feeder-IN';
  end if;

  -- ODC:Port2 (Dist-1-OUT) → Distribusi-1:Port1 (Terminal-ODC)
  if not exists (
    select 1 from public.port_connections pc
    join public.device_ports fp on fp.id = pc.from_port_id
    join public.device_ports tp on tp.id = pc.to_port_id
    where fp.device_id = v_odc_id and fp.port_label = 'Dist-1-OUT'
      and tp.device_id = v_dist_cable_id_1 and tp.port_label = 'Terminal-ODC'
  ) then
    insert into public.port_connections (region_id, from_port_id, to_port_id, connection_type, route_id, cable_device_id, fiber_count, status, notes)
    select v_region_id, fp.id, tp.id, 'fiber', v_route_dist_1_id, v_dist_cable_id_1, 12, 'active', 'Koneksi ODC ke distribusi-1 — 12 core'
    from public.device_ports fp, public.device_ports tp
    where fp.device_id = v_odc_id and fp.port_label = 'Dist-1-OUT'
      and tp.device_id = v_dist_cable_id_1 and tp.port_label = 'Terminal-ODC';
  end if;

  -- ODC:Port3 (Dist-2-OUT) → Distribusi-2:Port1 (Terminal-ODC)
  if not exists (
    select 1 from public.port_connections pc
    join public.device_ports fp on fp.id = pc.from_port_id
    join public.device_ports tp on tp.id = pc.to_port_id
    where fp.device_id = v_odc_id and fp.port_label = 'Dist-2-OUT'
      and tp.device_id = v_dist_cable_id_2 and tp.port_label = 'Terminal-ODC'
  ) then
    insert into public.port_connections (region_id, from_port_id, to_port_id, connection_type, route_id, cable_device_id, fiber_count, status, notes)
    select v_region_id, fp.id, tp.id, 'fiber', v_route_dist_2_id, v_dist_cable_id_2, 12, 'active', 'Koneksi ODC ke distribusi-2 — 12 core'
    from public.device_ports fp, public.device_ports tp
    where fp.device_id = v_odc_id and fp.port_label = 'Dist-2-OUT'
      and tp.device_id = v_dist_cable_id_2 and tp.port_label = 'Terminal-ODC';
  end if;

  -- ODC:Port4 (Dist-3-OUT) → Distribusi-3:Port1 (Terminal-ODC)
  if not exists (
    select 1 from public.port_connections pc
    join public.device_ports fp on fp.id = pc.from_port_id
    join public.device_ports tp on tp.id = pc.to_port_id
    where fp.device_id = v_odc_id and fp.port_label = 'Dist-3-OUT'
      and tp.device_id = v_dist_cable_id_3 and tp.port_label = 'Terminal-ODC'
  ) then
    insert into public.port_connections (region_id, from_port_id, to_port_id, connection_type, route_id, cable_device_id, fiber_count, status, notes)
    select v_region_id, fp.id, tp.id, 'fiber', v_route_dist_3_id, v_dist_cable_id_3, 12, 'active', 'Koneksi ODC ke distribusi-3 — 12 core'
    from public.device_ports fp, public.device_ports tp
    where fp.device_id = v_odc_id and fp.port_label = 'Dist-3-OUT'
      and tp.device_id = v_dist_cable_id_3 and tp.port_label = 'Terminal-ODC';
  end if;

  -- ==========================================================================
  -- SUMMARY
  -- ==========================================================================
  raise notice '[8/8] ✅ SELESAI — Semua data test topology telah siap.';
  raise notice '═══════════════════════════════════════════';
  raise notice 'Topologi: Jawa Tengah (Semarang)';
  raise notice '═══════════════════════════════════════════';
  raise notice 'OTB  (96c) → Feeder (48c, 1km) → ODC (96c)';
  raise notice '  ├── Distribusi-1 (12c, 3km) → ODP-01, ODP-02, ODP-03 (1:8)';
  raise notice '  ├── Distribusi-2 (12c, 3km) → ODP-04, ODP-05, ODP-06 (1:8)';
  raise notice '  └── Distribusi-3 (12c, 3km) → ODP-07, ODP-08, ODP-09 (1:8)';
  raise notice '═══════════════════════════════════════════';

end $$;
