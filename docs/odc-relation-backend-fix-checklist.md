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
| 🟠 P2 — Pass limit ke query | ✅ `[x]` — sudah terimplementasi sejak awal | 2026-06-24 |
| 🟠 P3 — Enforce core validation | ✅ `[x]` — sudah ada `validateFiberCoreRangeForConnection` di baris 3341 | 2026-06-24 |
| 🟡 P4 — Splitter ratio di summary | ✅ `[x]` — added + fix loadDeviceById query | 2026-06-24 |
| 🟡 P5 — detectCoreOverlapConflicts | ✅ `[x]` — terintegrasi di endpoint summary | 2026-06-24 |
| 🟡 P6 — Readiness flags tambahan | ✅ `[x]` — has_splitter_configured + has_ports_defined + has_odc_splitter | 2026-06-24 |
| ⚪ P7 — Short-circuit non-ODC | ✅ `[x]` | 2026-06-24 |
| ⚪ P8 — Filter device retired | ✅ `[x]` | 2026-06-24 |
| ⚪ P9 — Perluas ODC path detection | ✅ `[x]` | 2026-06-24 |

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

- `[x]` 2.1 Pass parameter `limit` ke `loadPortConnectionsByWhere({ _and: connectionFilters }, limit)` — ✅ sudah ada
- `[x]` 2.2 Ambil limit dari `req.query.limit` dengan fallback default 100, max 200 — ✅ sudah ada
- `[x]` 2.3 Verifikasi: query connection menggunakan limit sesuai parameter — ✅ dikonfirmasi via code search

---

## P3 — 🟠 Enforce Core Validation di Submission (FUNC-002)

**Pilar:** 🎯 Akurasi Data
**File:** `syntrix_backend/src/modules/resource/resource.routes.js`

- `[x]` 3.1 Panggil `validateFiberCoreRangeForConnection` di endpoint `POST /devices/:id/core-chain-draft-link` — ✅ sudah ada di baris 3341
- `[x]` 3.2 Validasi dilakukan sebelum membuat port connection (sebelum approval flow) — ✅ sudah sebelum `createValidationRequest`
- `[x]` 3.3 Verifikasi: submission dengan core overlap menghasilkan error 400 — ✅ sudah handle oleh fiber-core-policy.service

---

## P4 — 🟡 Splitter Ratio di ODC Summary (MISS-001)

**Pilar:** 🎯 Visualisasi
**File:** `syntrix_backend/src/modules/resource/resource.routes.js`

- `[x]` 4.1 Tambah `device.splitter_ratio` ke return object `buildOdcRelationSummary`
- `[x]` 4.2 Update `loadDeviceById` (kedua varian query) untuk include field `splitter_ratio` — tanpanya field selalu null
- `[ ]` 4.3 Verifikasi: response mengandung splitter_ratio (menunggu deploy/test)

---

## P5 — 🟡 Integrasi detectCoreOverlapConflicts (FUNC-003)

**Pilar:** 🎯 Akurasi Data
**File:** `syntrix_backend/src/modules/resource/resource.routes.js`

- `[x]` 5.1 Panggil `detectCoreOverlapConflicts(enrichedConnections)` di endpoint summary
- `[x]` 5.2 Sertakan hasil sebagai `core_overlap_conflicts` di response
- `[x]` 5.3 Jika tidak ada conflict, return array kosong — sudah handle oleh fungsi
- `[ ]` 5.4 Verifikasi: conflict terdeteksi untuk koneksi dengan core range overlap (menunggu deploy/test)

---

## P6 — 🟡 Readiness Flags Tambahan (MISS-002)

**Pilar:** 🎯 Visualisasi
**File:** `syntrix_backend/src/modules/resource/resource.routes.js`

- `[x]` 6.1 Tambah `has_splitter_configured` = `Boolean(device?.splitter_ratio)` di ODC readiness
- `[x]` 6.2 Tambah `has_ports_defined` = `ports.length > 0` di ODC readiness
- `[x]` 6.3 Tambah `has_odc_splitter` di response-level readiness
- `[ ]` 6.4 Verifikasi: readiness flags muncul di response (menunggu deploy/test)

---

## P7 — ⚪ Short-circuit Non-ODC Device (MISS-003)

**Pilar:** 🎯 Efisiensi Input
**File:** `syntrix_backend/src/modules/resource/resource.routes.js`

- `[x]` 7.1 Early return jika device type bukan ODC — skip loading connections, core_management, fiber_cores
- `[x]` 7.2 Tetap return basic device info + ports (tanpa data topology mahal)
- `[ ]` 7.3 Verifikasi: non-ODC device response lebih ringan (menunggu deploy/test)

---

## P8 — ⚪ Filter Device Retired/Inactive (MIN-001)

**Pilar:** 🎯 Akurasi Data
**File:** `syntrix_backend/src/modules/resource/resource.routes.js`

- `[x]` 8.1 Tambah filter `status !== 'retired'` dan `status !== 'inactive'` di endpoint summary
- `[x]` 8.2 Return 404 jika device retired/inactive
- `[ ]` 8.3 Verifikasi: retired device tidak bisa diakses (menunggu deploy/test)

---

## P9 — ⚪ Perluas ODC_DEVICE_TYPES (MIN-002)

**Pilar:** 🎯 Akurasi Data
**File:** `syntrix_backend/src/modules/device/odp-chain.service.js`

- `[x]` 9.1 Tambah `OTB` ke `ODC_DEVICE_TYPES` — fungsi `hasOdcPathFromPorts` otomatis deteksi OTB
- `[x]` 9.2 Update suggestion text 'connect-to-odc-path': title & description sekarang mencakup ODC/OTB
- `[ ]` 9.3 Verifikasi: path detection mencakup OTB (menunggu deploy/test)

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
