# ODC Relation Backend — Fix Checklist & Todo

**Last updated:** 2026-06-24 (Asia/Jakarta)
**Source plan:** `./odc-relation-backend-audit-fix-plan.md`

---

## Status Legend

| Symbol | Arti |
|--------|------|
| `[ ]` | Not started |
| `[~]` | In progress |
| `[x]` | Done |
| `[-]` | Skipped / Cancelled |

---

## Current Progress

| Priority | Status | Last Updated |
|----------|--------|-------------|
| 🔴 P1 — Fix `cableUsage` logic | ✅ `[x]` | 2026-06-24 |
| 🟠 P2 — Pass limit ke query | ❌ `[ ]` | - |
| 🟠 P3 — Enforce core validation | ❌ `[ ]` | - |
| 🟡 P4 — Splitter ratio di summary | ❌ `[ ]` | - |
| 🟡 P5 — detectCoreOverlapConflicts | ❌ `[ ]` | - |
| 🟡 P6 — Readiness flags tambahan | ❌ `[ ]` | - |
| ⚪ P7 — Short-circuit non-ODC | ❌ `[ ]` | - |
| ⚪ P8 — Filter device retired | ❌ `[ ]` | - |
| ⚪ P9 — Perluas ODC path detection | ❌ `[ ]` | - |

---

## P1 — 🔴 Fix `cableUsage` Logic (BUG-001)

**Pilar:** 🎯 Akurasi Data
**File:** `syntrix_backend/src/modules/resource/resource.routes.js`

- `[x]` 1.1 Ubah logika `connection.cable_device_id === device.id` → filter upstream & downstream items yang punya `cable_device`
- `[x]` 1.2 Hapus `cableUsage = []` dan `cableUsage.push({...})` di dalam forEach
- `[ ]` 1.3 Verifikasi: response `odc_relations.cable_usage.items` tidak kosong untuk ODC valid (menunggu deployment/test)

---

## P2 — 🟠 Pass Limit ke Query Connection (FUNC-001)

**Pilar:** 🎯 Akurasi Data
**File:** `syntrix_backend/src/modules/resource/resource.routes.js`

- `[ ]` 2.1 Pass parameter `limit` ke `loadPortConnectionsByWhere({ _and: connectionFilters }, limit)`
- `[ ]` 2.2 Ambil limit dari `req.query.limit` dengan fallback default 100, max 200
- `[ ]` 2.3 Verifikasi: query connection menggunakan limit sesuai parameter

---

## P3 — 🟠 Enforce Core Validation di Submission (FUNC-002)

**Pilar:** 🎯 Akurasi Data
**File:** `syntrix_backend/src/modules/resource/resource.routes.js`

- `[ ]` 3.1 Panggil `validateFiberCoreRangeForConnection` di endpoint `POST /devices/:id/core-chain-draft-link`
- `[ ]` 3.2 Validasi dilakukan sebelum membuat port connection (sebelum approval flow)
- `[ ]` 3.3 Verifikasi: submission dengan core overlap menghasilkan error 400

---

## P4 — 🟡 Splitter Ratio di ODC Summary (MISS-001)

**Pilar:** 🎯 Visualisasi
**File:** `syntrix_backend/src/modules/resource/resource.routes.js`

- `[ ]` 4.1 Tambah `device.splitter_ratio` ke return object `buildOdcRelationSummary`
- `[ ]` 4.2 Field tersedia di `readiness.splitter_ratio` dan `summary.splitter_ratio`
- `[ ]` 4.3 Verifikasi: response mengandung splitter_ratio

---

## P5 — 🟡 Integrasi detectCoreOverlapConflicts (FUNC-003)

**Pilar:** 🎯 Akurasi Data
**File:** `syntrix_backend/src/modules/resource/resource.routes.js`

- `[ ]` 5.1 Panggil `detectCoreOverlapConflicts(enrichedConnections)` di endpoint summary
- `[ ]` 5.2 Sertakan hasil sebagai `core_overlap_conflicts` di response
- `[ ]` 5.3 Jika tidak ada conflict, return array kosong
- `[ ]` 5.4 Verifikasi: conflict terdeteksi untuk koneksi dengan core range overlap

---

## P6 — 🟡 Readiness Flags Tambahan (MISS-002)

**Pilar:** 🎯 Visualisasi
**File:** `syntrix_backend/src/modules/resource/resource.routes.js`

- `[ ]` 6.1 Tambah `has_splitter_configured` = `Boolean(device.splitter_ratio)`
- `[ ]` 6.2 Tambah `has_ports_defined` = `ports.length > 0`
- `[ ]` 6.3 Update juga readiness di level response `readiness.has_odc_splitter` dan `readiness.has_odc_ports`
- `[ ]` 6.4 Verifikasi: readiness flags muncul di response

---

## P7 — ⚪ Short-circuit Non-ODC Device (MISS-003)

**Pilar:** 🎯 Efisiensi Input
**File:** `syntrix_backend/src/modules/resource/resource.routes.js`

- `[ ]` 7.1 Early return jika device type bukan ODC — skip loading connections, core_management, fiber_cores
- `[ ]` 7.2 Tetap return basic device info + ports (tanpa data topology mahal)
- `[ ]` 7.3 Verifikasi: non-ODC device response lebih ringan

---

## P8 — ⚪ Filter Device Retired/Inactive (MIN-001)

**Pilar:** 🎯 Akurasi Data
**File:** `syntrix_backend/src/modules/resource/resource.routes.js`

- `[ ]` 8.1 Tambah filter `status !== 'retired'` dan `status !== 'inactive'` di endpoint summary
- `[ ]` 8.2 Return 404 jika device retired/inactive
- `[ ]` 8.3 Verifikasi: retired device tidak bisa diakses

---

## P9 — ⚪ Perluas ODC_DEVICE_TYPES (MIN-002)

**Pilar:** 🎯 Akurasi Data
**File:** `syntrix_backend/src/modules/device/odp-chain.service.js`

- `[ ]` 9.1 Tambah `OTB` ke `ODC_DEVICE_TYPES` atau evaluasi apakah rename fungsi diperlukan
- `[ ]` 9.2 Pertimbangan: fungsi `hasOdcPathFromPorts` juga harus deteksi OTB sebagai upstream source
- `[ ]` 9.3 Verifikasi: path detection mencakup OTB

---

## UAT Scenarios

Setelah semua implementasi selesai, jalankan skenario berikut:

| ID | Skenario | Expected Result | Status |
|----|----------|----------------|--------|
| UAT-01 | Hit `/topology/devices/:id/summary` untuk ODC valid | Response mengandung `odc_relations` dengan `upstream`, `downstream`, `cable_usage` tidak kosong | `[ ]` |
| UAT-02 | Hit endpoint untuk non-ODC device | Response tanpa `odc_relations` (null) dan loading lebih ringan | `[ ]` |
| UAT-03 | Submit koneksi ODC→ODP dengan core range valid | Berhasil submission | `[ ]` |
| UAT-04 | Submit koneksi ODC→ODP dengan core range overlap | Error 400 | `[ ]` |
| UAT-05 | Hit endpoint untuk ODC dengan multiple downstream ODP | Semua ODP tercantum di `downstream` | `[ ]` |
| UAT-06 | Hit endpoint untuk ODC retired | 404 | `[ ]` |
| UAT-07 | Cek response mengandung `splitter_ratio` | Field ada | `[ ]` |
| UAT-08 | Cek response mengandung `core_overlap_conflicts` | Array (bisa kosong) | `[ ]` |
| UAT-09 | Cek readiness flags lengkap | `has_splitter_configured`, `has_ports_defined`, dll | `[ ]` |
| UAT-10 | Cek `cable_usage` tidak kosong untuk ODC dengan kabel terpasang | Items > 0 | `[ ]` |

---

## Deployment Notes

- Semua perubahan di file `syntrix_backend/src/modules/resource/resource.routes.js`
- Perubahan P3 juga menyentuh endpoint yang sudah ada — perlu regression test
- Perubahan P9 menyentuh `syntrix_backend/src/modules/device/odp-chain.service.js`
- Tidak ada perubahan database schema
- Tidak ada perubahan API contract (hanya adds fields ke response)

---

## Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-24 | Buffy | Initial document — based on audit of commit `fcc61a0` |
