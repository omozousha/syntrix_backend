# Syntrix Agent Instructions

## Product Boundary

Syntrix must be treated as a **Network Asset Management / Inventory Tool** for passive and physical-layer network assets.

Primary scope:

- inventory data for POP/OTB, ODC, ODP, ONT, cable, fiber cores, routes, splice points, handholes/manholes, and related physical assets;
- approval-safe updates to inventory records;
- validation workflow, field evidence, gallery, and audit trail;
- topology relation modeling through `devices`, `device_ports`, `port_connections`, `fiber_cores`, `core_management`, and `network_routes`;
- Trace Topology and impact analysis based on approved inventory relations.

Explicit non-goals for the current product scope:

- Network Management System (NMS) behavior;
- live traffic monitoring;
- real-time device polling;
- auto discovery from active network devices;
- SNMP/telemetry/OLT command integration as a required assumption;
- alarm correlation from live equipment;
- bandwidth, throughput, packet loss, CPU, memory, or interface traffic dashboards based on live data.

When designing or implementing Syntrix features, prefer inventory-driven language:

- use "status from approved inventory", "field validation", "manual measurement", "OTDR/evidence attachment", and "topology relation";
- avoid implying live monitoring unless the user explicitly asks for a future NMS integration plan.

If a feature sounds like NMS, reframe it as inventory evidence or manual/approved operational data first. Only propose live monitoring integration as a separate future module after the passive inventory source of truth is stable.

## Implementation Guidance

- Reuse existing endpoints and resource flows before adding new endpoints.
- Preserve approval-safe mutation for topology and inventory changes.
- Keep Trace Topology based on approved physical relations, not live device state.
- Keep UI copy clear that Syntrix records planned/installed/validated/broken inventory state, not real-time traffic state.
