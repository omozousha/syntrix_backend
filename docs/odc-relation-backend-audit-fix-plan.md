# ODC Relation Backend — Audit & Fix Plan

**Last updated:** 2026-06-24 (Asia/Jakarta)
**Auditor:** Buffy (Codebuff AI Agent)
**Commit reference:** `fcc61a0` — Implement ODC relation workflow backend

---

## 1. Product Boundary (North Star)

> Syntrix adalah **Network Asset Management / Inventory Tool** untuk aset jaringan pasif dan physical-layer.
> **Bukan** Network Management System (NMS).

### 3 Pilar Pengembangan

| Pilar | Prioritas | Artinya |
|-------|-----------|---------|
| 🎯 **Akurasi Data** | Tertinggi | Source of truth harus presisi, tanpa conflict |
| 🎯 **Visualisasi** | Tinggi | Tampilkan relasi aset secara intuitif |
| 🎯 **Efisiensi Input** | Tinggi | Teknisi lapangan cepat mencatat evidence |

### Domain Boundaries

| ✅ **In Scope** | ❌ **Out of Scope** |
|----------------|-------------------|
| POP/OTB, ODC, ODP, ONT, Cable, Fiber Core, Route, Splice, HH/MH | Live traffic monitoring, SNMP/telemetry |
| Approval-safe inventory mutation | OLT live commands, auto discovery |
| Validation evidence, gallery, audit trail | Alarm correlation |
| Trace Topology based on approved `port_connections` | Bandwidth/throughput/CPU dashboards |
| Impact analysis based on approved physical relations | Real-time device state polling |

---

## 2. Audit Findings Summary

### 🔴 Critical Bug

| ID | Issue | File:Line | Dampak |
|----|-------|-----------|--------|
| **BUG-001** | `cableUsage` bucket logic salah — `connection.cable_device_id === device.id` tidak akan pernah true untuk ODC | `resource.routes.js:1217` | Bucket `cable_usage` selalu array kosong. Data kabel feeder/distribusi tidak pernah tercatat. |

### 🟠 Functional Issues

| ID | Issue | File:Line | Dampak |
|----|-------|-----------|--------|
| **FUNC-001** | Limit variable tidak di-pass ke `loadPortConnectionsByWhere` | `resource.routes.js:4003-4025` | Data koneksi ODC terpotong di default 100 untuk ODC besar |
| **FUNC-002** | `validateFiberCoreRangeForConnection` hanya di enforce saat approval apply, bukan saat submission | `validation.service.js` + `resource.routes.js` | Adminregion bisa submit koneksi dengan core overlap; approval jadi sia-sia |
| **FUNC-003** | `detectCoreOverlapConflicts` sudah ada tapi tidak dipanggil di ODC summary endpoint | `resource.routes.js:2165` | Overlap core range antar koneksi tidak terdeteksi |

### 🟡 Missing Features (Inventory Scope)

| ID | Issue | Dampak |
|----|-------|--------|
| **MISS-001** | Splitter ratio ODC tidak ditampilkan di `odc_relations` summary | Frontend tidak bisa menampilkan status splitter ODC |
| **MISS-002** | Readiness flags tidak lengkap: missing `has_splitter_configured`, `has_ports_defined` | Frontend tidak bisa cek readiness splitter & port |
| **MISS-003** | Non-ODC device tidak di short-circuit — selalu load connections & fiber cores | Performa boros untuk device OLT, ODP, ONT, dll |

### ⚪ Minor Issues

| ID | Issue | Dampak |
|----|-------|--------|
| **MIN-001** | Device retired/inactive tidak di-filter di endpoint summary | ODC retired tetap tampil |
| **MIN-002** | `ODC_DEVICE_TYPES` di `odp-chain.service.js` hanya ODC, tidak include OTB/POP | Path detection terlalu sempit |

---

## 3. Priority Mapping (Reframed)

Berdasarkan 3 pilar, semua isu sudah di-reframe agar **inventory-first**:

| Priority | ID | Pilar | Perbaikan | Estimasi |
|----------|----|-------|-----------|----------|
| 🔴 **P1** | BUG-001 | 🎯 Akurasi Data | Fix logika `cableUsage` — kumpulkan cable_device dari koneksi yang melibatkan port ODC | 15 menit |
| 🟠 **P2** | FUNC-001 | 🎯 Akurasi Data | Pass variable `limit` ke `loadPortConnectionsByWhere` | 5 menit |
| 🟠 **P3** | FUNC-002 | 🎯 Akurasi Data | Enforce `validateFiberCoreRangeForConnection` di endpoint submission `core-chain-draft-link` | 20 menit |
| 🟡 **P4** | MISS-001 | 🎯 Visualisasi | Tambah `splitter_ratio` dari device ke `odc_relations.summary` | 10 menit |
| 🟡 **P5** | FUNC-003 | 🎯 Akurasi Data | Integrasi `detectCoreOverlapConflicts` ke ODC summary response | 15 menit |
| 🟡 **P6** | MISS-002 | 🎯 Visualisasi | Tambah readiness flags: `has_splitter_configured`, `has_ports_defined` | 10 menit |
| ⚪ **P7** | MISS-003 | 🎯 Efisiensi Input | Short-circuit: skip ODC loading jika device bukan ODC | 10 menit |
| ⚪ **P8** | MIN-001 | 🎯 Akurasi Data | Filter device retired/inactive di endpoint summary | 5 menit |
| ⚪ **P9** | MIN-002 | 🎯 Akurasi Data | Perluas `ODC_DEVICE_TYPES` atau rename fungsi | 5 menit |

---

## 4. Detailed Implementation Plan

### P1 — Fix `cableUsage` Logic

**Current behavior (bug):**
```javascript
if (connection.cable_device_id === device.id) {  // ALWAYS false for ODC
```

**Expected behavior:** Untuk setiap koneksi yang melibatkan port ODC, kumpulkan referensi kabel yang digunakan. Gunakan data yang sudah tersedia di `enrichedConnections` (field `cable_device` sudah di-enrich).

**Approach:**
```javascript
// Kumpulkan kabel dari upstream dan downstream connections
const cableSet = new Map();
[...upstream, ...downstream].forEach((item) => {
  if (item.cable_device?.id) {
    cableSet.set(item.cable_device.id, item);
  }
});
const cableUsage = Array.from(cableSet.values()).map(item => ({ ... }));
```

### P2 — Pass Limit ke Query

**Current:** `loadPortConnectionsByWhere({ _and: connectionFilters })` — default limit 100

**Fix:** `loadPortConnectionsByWhere({ _and: connectionFilters }, limit)`

### P3 — Enforce Core Validation di Submission

**Lokasi:** Endpoint `POST /devices/:id/core-chain-draft-link`

**Approach:** Panggil `validateFiberCoreRangeForConnection` sebelum membuat port connection di draft-link endpoint. Sama seperti yang sudah dilakukan di `validation.service.js:validatePortConnectionApplyPayload`.

### P4 — Splitter Ratio di Summary

**Approach:** Tambahkan field `splitter_ratio` (dari `device.splitter_ratio`) ke object return `buildOdcRelationSummary`.

### P5 — Integrasi `detectCoreOverlapConflicts`

**Approach:** Panggil `detectCoreOverlapConflicts(enrichedConnections)` di endpoint `/topology/devices/:id/summary` dan sertakan hasilnya di response.

### P6 — Readiness Flags Tambahan

**Approach:** Tambahkan ke object `readiness`:
- `has_splitter_configured: Boolean(device.splitter_ratio)`
- `has_ports_defined: ports.length > 0`

---

## 5. Success Criteria

Setelah implementasi, setiap perbaikan harus diverifikasi:

| ID | Success Criterion | Cara Verifikasi |
|----|------------------|-----------------|
| P1 | `cable_usage.items` tidak kosong untuk ODC yang punya koneksi dengan cable_device_id | Hit endpoint summary untuk ODC, cek `odc_relations.cable_usage` |
| P2 | Query koneksi ODC menggunakan limit dari `req.query.limit` | Inspeksi kode: `loadPortConnectionsByWhere` menerima parameter limit |
| P3 | Submission koneksi ODC→ODP dengan core overlap di-reject | Test via endpoint draft-link dengan core range conflict |
| P4 | Response `odc_relations` mengandung field `splitter_ratio` | Hit endpoint, cek response JSON |
| P5 | Response mengandung array `core_overlap_conflicts` | Hit endpoint untuk region dengan multiple connections di cable yang sama |
| P6 | `readiness.has_splitter_configured` dan `readiness.has_ports_defined` ada | Hit endpoint, cek response JSON |
| P7 | Non-ODC device tidak load connections & fiber cores | Inspeksi kode: ada early return |
| P8 | Device dengan status `retired` tidak muncul di summary | Verifikasi di kode |
| P9 | Path detection mencakup OTB/POP | Review kode `hasOdcPathFromPorts` |

---

## 6. Referensi

- [ODC Validation and ODP Relation Workflow Plan](./odc-validation-and-odp-relation-workflow-plan.md)
- [Network SoT Implementation TODO](./network-sot-implementation-todo.md)
- **Karpathy Guidelines** — `~/.agents/skills/karpathy-guidelines/SKILL.md`
- **Product Boundary** — `syntrix_backend/AGENTS.md`
