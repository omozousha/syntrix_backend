# Generic Device Validation UAT Runbook

Companion runbook untuk `generic-device-detail-and-validation-workflow-plan.md`.

Tujuan: memastikan generic device detail dan validation workflow berjalan untuk ODP, ODC, CABLE, ONT, dan unsupported device type tanpa kebocoran wording ODP di alur non-ODP.

## Pre-UAT Checks

Jalankan dari repo backend:

```bash
npm run test:generic-validation-payload
npm run test:validation-state-machine
```

Jalankan dari repo frontend:

```bash
npm run lint
npm run build
```

Jalankan dari Syntrix-One workspace:

```bash
npm run lint
npm run build
```

## Test Accounts

Siapkan minimal:

- validator region A;
- adminregion region A;
- superadmin;
- validator region B untuk negative region guard.

## Device Fixtures

Siapkan device non-POP berikut di region A:

- ODP dengan port aktif;
- ODC dengan kapasitas port/core;
- CABLE dengan `capacity_core`;
- ONT dengan serial number atau port;
- satu device unsupported, misalnya tipe uji non-produksi.

Pastikan setiap device memiliki QR/public QR context dan tidak sedang punya validation request aktif yang memblokir submit ulang.

## UAT Cases

### ODP

1. Login Syntrix-One sebagai validator region A.
2. Scan QR ODP.
3. Pastikan form ODP legacy terbuka.
4. Submit validation dengan evidence.
5. Login web sebagai adminregion region A, approve request.
6. Login web sebagai superadmin, approve request.
7. Buka detail ODP.
8. Pastikan detail berubah sesuai payload approved, evidence muncul di gallery, dan history menampilkan validator/adminregion/superadmin.

Expected:

- tidak ada regresi label ODP;
- port/evidence tetap terbaca;
- gallery hanya memuat evidence setelah final approval.

### ODC

1. Scan QR ODC sebagai validator region A.
2. Pastikan form generic ODC terbuka dengan field splitter, total port, used port, capacity core, dan used core.
3. Submit validation dengan evidence.
4. Approve adminregion dan superadmin.
5. Buka queue approval dan detail device.

Expected:

- approval comparison tidak menampilkan `Nama ODP Lama/Baru`;
- detail ODC menampilkan technical summary ODC;
- history menampilkan `field_validation_type = ODC`.

### CABLE

1. Scan QR CABLE sebagai validator region A.
2. Pastikan form Cable menampilkan kapasitas core dan used core.
3. Submit validation dengan evidence.
4. Approve adminregion dan superadmin.
5. Buka detail CABLE.

Expected:

- approval comparison memakai label core/cable, bukan ODP;
- final approval hanya menerapkan field yang diizinkan untuk CABLE;
- gallery detail hanya menampilkan approved evidence.

### ONT

1. Scan QR ONT sebagai validator region A.
2. Pastikan form ONT menampilkan serial number dan port summary fields.
3. Submit dan approve sampai final.
4. Buka detail ONT.

Expected:

- history menampilkan actor lengkap;
- relation summary tetap read-only;
- tidak ada wording ODP di form/review ONT.

### Unsupported Device Type

1. Scan QR device unsupported sebagai validator region A.
2. Pastikan generic fallback form terbuka.
3. Submit status/lokasi/evidence.
4. Approve sampai final.

Expected:

- workflow tidak crash;
- backend hanya menerapkan safe generic fields;
- approval comparison memakai label generic device.

### Role and Region Guard

1. Login adminregion atau superadmin lalu coba submit field validation dari Syntrix-One.
2. Login validator region B lalu scan device region A.

Expected:

- adminregion/superadmin tidak bisa submit sebagai validator;
- wrong region menampilkan dialog atau screen mismatch, bukan silent redirect;
- tidak ada validation request dibuat untuk unauthorized submit.

## Evidence Acceptance

- Pending evidence tidak muncul di inventory gallery.
- Evidence muncul setelah final approval.
- Web detail dan Syntrix-One detail membaca approved evidence dengan rule yang sama.
