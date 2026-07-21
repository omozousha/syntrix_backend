-- Master Data Synchronization Slice 5
-- Seed capacity_core and total_ports for existing asset_models.
-- Capacity values derived from existing model names and known hardware specs.
-- Run AFTER 20260721_asset_model_capacity_and_ports. sql.
do $$
declare
  v_otb_type_id uuid;
  v_odc_type_id uuid;
  v_jc_type_id uuid;
begin
  select id into v_otb_type_id from public.asset_types where type_name = 'OTB';
  select id into v_odc_type_id from public.asset_types where type_name = 'ODC';
  select id into v_jc_type_id from public.asset_types where type_name = 'JC';

  -- OTB models: total_ports = core count (1:1 fiber mapping)
  update public.asset_models
  set
    total_ports = case
      when model_name ilike '%96%' then 96
      when model_name ilike '%72%' then 72
      when model_name ilike '%48%' then 48
      when model_name ilike '%24%' then 24
      when model_name ilike '%12%' then 12
      else total_ports
    end,
    capacity_core = case
      when model_name ilike '%96%' then 96
      when model_name ilike '%72%' then 72
      when model_name ilike '%48%' then 48
      when model_name ilike '%24%' then 24
      when model_name ilike '%12%' then 12
      else capacity_core
    end
  where asset_type_id = v_otb_type_id
    and deleted_at is null;

  -- ODC models: total_ports = core count (1:1 for distribution cabinet)
  update public.asset_models
  set
    total_ports = case
      when model_name ilike '%96%' then 96
      when model_name ilike '%72%' then 72
      when model_name ilike '%48%' then 48
      when model_name ilike '%24%' then 24
      else total_ports
    end,
    capacity_core = case
      when model_name ilike '%96%' then 96
      when model_name ilike '%72%' then 72
      when model_name ilike '%48%' then 48
      when model_name ilike '%24%' then 24
      else capacity_core
    end
  where asset_type_id = v_odc_type_id
    and deleted_at is null;

  -- JC models: capacity_core = max core count, total_ports = splice capacity
  update public.asset_models
  set
    total_ports = case
      when model_name ilike '%144%' then 144
      when model_name ilike '%96%' then 96
      when model_name ilike '%72%' then 72
      when model_name ilike '%48%' then 48
      when model_name ilike '%24%' then 24
      else total_ports
    end,
    capacity_core = case
      when model_name ilike '%144%' then 144
      when model_name ilike '%96%' then 96
      when model_name ilike '%72%' then 72
      when model_name ilike '%48%' then 48
      when model_name ilike '%24%' then 24
      else capacity_core
    end
  where asset_type_id = v_jc_type_id
    and deleted_at is null;

  raise notice 'Asset model capacity/ports seeded successfully';
end $$;