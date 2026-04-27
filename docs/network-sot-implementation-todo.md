# Network SoT Implementation TODO

Last updated: 2026-04-27 (Asia/Jakarta)

## Status Legend
- `[ ]` Not started
- `[~]` In progress
- `[x]` Done

## Stage Roadmap

### Stage 1 - Backend Foundation + Unified Trace
- `[x]` Create implementation TODO document and tracking format.
- `[x]` Add database foundation for splitter profiles and fiber core color mapping.
- `[x]` Add stricter validation rules for topology connection payloads.
- `[x]` Unify `/devices/:id/trace` to use actual topology (`port_connections` + `fiber_cores`) as SoT.
- `[x]` Expose new master resources for splitter/color profile management through resource registry.
- `[x]` Update this file with completed Stage 1 checklist and notes.

### Stage 2 - Topology Operation UX
- `[x]` Device-centric topology action from device detail/list.
- `[x]` Connection wizard: from-port, to-port, cable, core range, route, splitter.
- `[x]` Port/core occupancy panel per device.

### Stage 3 - As-Built Upgrade
- `[x]` Branching topology diagram (not linear sequence only).
- `[x]` Core color rendering and splitter annotation in diagram.
- `[x]` Export metadata completeness and revision usability improvements.

### Stage 4 - Data Integrity and Migration
- `[x]` Transition strategy from legacy `device_links` (planning) to actual topology.
- `[x]` Integrity checker (overlap core, over-capacity, orphan linkage, broken chain).
- `[x]` KPI for topology data quality in operational dashboard.

---

## Notes

### Scope
- Prioritize backend readiness first so frontend can evolve safely.
- Keep backward compatibility where possible while shifting SoT to actual connectivity tables.

### Change Log
- 2026-04-27: Stage 1 started.
- 2026-04-27: Stage 1 completed on backend scope.
- 2026-04-27: Stage 2 completed on topology frontend UX scope.
- 2026-04-27: Stage 3 completed on As-Built visualization and revision UX scope.
- 2026-04-27: Stage 4 completed on migration transition, integrity checker, and KPI integration.

### Completed Files (Stage 1)
- `database/migrations/20260427_splitter_profiles_and_core_colors.sql`
- `src/modules/device/connectivity.validation.js`
- `src/modules/resource/resource.registry.js`
- `src/modules/resource/resource.routes.js`

### Completed Files (Stage 2)
- `syntrix_frontend/app/(app)/data-management/topology/page.tsx`

### Completed Files (Stage 3)
- `syntrix_frontend/components/topology-trace-panel.tsx`
- `syntrix_frontend/app/(app)/data-management/as-built/page.tsx`

### Completed Files (Stage 4)
- `database/migrations/20260427_topology_transition_and_integrity.sql`
- `src/modules/resource/resource.routes.js`
- `syntrix_frontend/app/(app)/data-management/page.tsx`

