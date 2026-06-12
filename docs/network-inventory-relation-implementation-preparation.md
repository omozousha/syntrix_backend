# Network Inventory Relation Implementation Preparation

Dokumen ini adalah fase persiapan sebelum implementasi bertahap `Network Inventory Relation Development Plan`.

Tujuannya bukan langsung coding, tetapi memastikan data model, endpoint, frontend, Syntrix-One, approval flow, dan UAT sudah punya baseline yang jelas. Dengan begitu implementasi bisa berjalan kecil, terukur, dan tidak mengganggu fitur yang sudah stabil.

---

## 1. Tujuan Persiapan

- Menentukan baseline kondisi backend, frontend, dan Syntrix-One sebelum perubahan.
- Menghindari overlap dengan pekerjaan topology lama yang sudah pernah ditandai selesai.
- Memastikan QR default, project relation, topology management, As-Built output, dan Maps masuk urutan yang benar.
- Menentukan apa yang perlu diaudit, apa yang perlu dikunci sebagai contract, dan apa yang baru boleh diimplementasikan.
- Membuat checklist UAT awal untuk setiap phase.

---

## 2. Prinsip Persiapan

- Jangan menambah tabel baru sebelum schema existing terbukti tidak cukup.
- Jangan mulai dari Maps atau visual besar.
- Jangan membuat As-Built sebagai source of truth kedua.
- Jangan hardcode ODP untuk fitur yang seharusnya generic device.
- Jangan bypass approval flow untuk mutasi adminregion/validator.
- Jangan menampilkan UUID relasi ke UI user-facing.
- Pertahankan data berat sebagai lazy section.

---

## 3. Baseline yang Harus Diverifikasi

### 3.1 Backend Schema

Checklist:

- [ ] `devices.project_id` tersedia dan indexed.
- [ ] `devices.tenant_id`, `pop_id`, `region_id`, dan `customer_id` tersedia.
- [ ] `device_ports` tersedia untuk port/core/splitter endpoint.
- [ ] `port_connections` tersedia untuk koneksi port-to-port.
- [ ] `network_routes` tersedia untuk route dan `path_geojson`.
- [ ] `core_management` dan/atau `fiber_cores` tersedia untuk core tracking.
- [ ] `qr_label_settings` tersedia untuk logo/footer global QR.
- [ ] `as_built_documents` tersedia sebagai dokumen/snapshot, bukan source of truth.

Checker:

- [ ] Tidak ada kebutuhan schema baru yang belum dibuktikan oleh gap audit.
- [ ] Semua FK/index utama sudah dicatat.
- [ ] Semua field yang perlu Relation-Ready sudah punya jalur enrichment.

### 3.2 Backend Endpoint

Checklist:

- [ ] `GET /devices/:id` mengembalikan relation label utama.
- [ ] `GET /public/qr/devices/:id` aman dan display-ready.
- [ ] `GET /qr-label-settings` tersedia untuk frontend.
- [ ] `PATCH /qr-label-settings` khusus superadmin.
- [ ] `POST /devices/:id/provision-ports` tersedia.
- [ ] `GET /devices/:id/trace` tersedia.
- [ ] `GET /topology/trace` tersedia.
- [ ] `GET /topology/integrity` tersedia.
- [ ] `GET /topology/quality` tersedia.
- [ ] Mutasi `port_connections` dan assignment port jelas: langsung final atau staged approval.

Checker:

- [ ] Endpoint read sudah Relation-Ready.
- [ ] Endpoint mutasi punya audit trail.
- [ ] Endpoint mutasi adminregion/validator tidak langsung mengubah final inventory jika seharusnya approval.

### 3.3 Frontend

Checklist:

- [ ] Detail device punya pola QR yang bisa digeneralisasi.
- [ ] QR detail dan QR bulk memakai helper/template yang sama.
- [ ] Form create/edit device sudah punya field Project.
- [ ] Detail device menampilkan Project sebagai relasi utama.
- [ ] Request approval menampilkan Project lama/baru bila relevan.
- [ ] Data-management bisa filter by Project bila backend mendukung.
- [ ] Topology page existing dicek ulang: apakah masih relevan dengan plan baru.
- [ ] As-Built page existing dicek ulang: apakah source of truth atau output.
- [ ] Maps page existing dicek: status belum implementasi atau sudah partial.

Checker:

- [ ] `npm run audit:relation-display -- --strict` pass.
- [ ] `npm run audit:performance-safety` pass.
- [ ] Tidak ada QR component yang hardcode ODP untuk semua logic.
- [ ] Tidak ada layout utama yang overflow di mobile.

### 3.4 Syntrix-One

Checklist:

- [ ] QR scan flow aman untuk semua device eligible, bukan hanya ODP jika phase generic device dimulai.
- [ ] Validator tetap hanya masuk form validasi sesuai role/scope.
- [ ] Adminregion/superadmin tetap diblok dari form validasi mobile.
- [ ] Detail ODP saat ini tetap stabil: gallery, history, port, validation status.
- [ ] Loading dialog scan tidak stack.
- [ ] Cross-region QR menampilkan dialog spesifik.

Checker:

- [ ] Tidak ada regresi flow validasi ODP.
- [ ] Tidak ada data approved yang kosong di detail mobile jika backend sudah punya data.
- [ ] App tetap ringan, data berat lazy.

---

## 4. Reconcile dengan Dokumen Lama

Dokumen lama:

```txt
docs/network-sot-implementation-todo.md
```

Catatan:

- Dokumen lama menandai Stage 1-4 selesai pada 2026-04-27.
- Plan baru memperluas scope dengan QR default semua device, Project as main relation, Topology Management, As-Built sebagai output, dan Maps sebagai fase akhir.
- Karena itu, status "done" lama tidak otomatis berarti plan baru selesai.

Todo:

- [ ] Audit ulang file dan endpoint yang disebut selesai di dokumen lama.
- [ ] Tandai bagian yang masih valid.
- [ ] Tandai bagian yang perlu refactor agar selaras dengan plan baru.
- [ ] Jangan hapus dokumen lama; jadikan historical implementation note.

Checker:

- [ ] Tidak ada duplikasi rencana yang membingungkan.
- [ ] Plan baru menjadi acuan utama.
- [ ] Dokumen lama tetap menjadi referensi historis.

---

## 5. Urutan Persiapan Implementasi

### Step 1 - Audit Contract

Target:

- Backend schema.
- Backend endpoint.
- Frontend QR/project/detail/topology/as-built.
- Syntrix-One QR/detail/validation.

Output:

- daftar gap;
- daftar endpoint siap pakai;
- daftar endpoint perlu perubahan;
- daftar UI yang perlu refactor;
- daftar UAT minimum.

Checker:

- [ ] Gap audit selesai sebelum coding phase 2.

### Step 2 - Tentukan Phase Pertama yang Aman

Rekomendasi phase pertama:

```txt
Generic Device Identity + Project Relation
```

Alasan:

- QR dan Project adalah fondasi identitas device.
- Dampaknya jelas di detail, create/edit, approval, dan audit.
- Tidak perlu langsung mengubah topology connection.
- Risiko lebih kecil daripada langsung mengubah port/core.

Checker:

- [ ] Phase pertama tidak mengubah final topology behavior.
- [ ] Bisa diuji tanpa data migration besar.

### Step 3 - Buat Implementation Checklist per Phase

Setiap phase harus punya:

- scope;
- file target backend;
- file target frontend;
- file target app jika ada;
- migration/manual SQL jika ada;
- test command;
- UAT scenario;
- rollback note.

Checker:

- [ ] Tidak ada phase yang dimulai tanpa checklist.

### Step 4 - Siapkan Data Sample

Minimal sample:

- 1 POP.
- 1 Project.
- 1 OLT.
- 1 ODC.
- 1 ODP 8 port.
- 1 ODP 16 port.
- 1 ONT.
- 1 Customer.
- 1 Route.
- 1 Cable device jika tersedia.
- 1 Tenant.

Checker:

- [ ] Sample bisa dipakai untuk QR, project relation, trace, As-Built, dan Maps nanti.

---

## 6. Pre-Implementation Checklist

### Backend

- [ ] `git status` backend clean atau perubahan aktif jelas.
- [ ] Schema audit selesai.
- [ ] Endpoint audit selesai.
- [ ] Approval mutation audit selesai.
- [ ] Audit trail action naming audit selesai.
- [ ] Manual SQL need/no-need diputuskan.

### Frontend

- [ ] `git status` frontend clean atau perubahan aktif jelas.
- [ ] Relation audit strict pass.
- [ ] Performance safety audit pass.
- [ ] QR component audit selesai.
- [ ] Project field audit selesai.
- [ ] Topology/As-Built/Maps route audit selesai.

### Syntrix-One

- [ ] Current APK version dicatat.
- [ ] QR scan ODP baseline dicatat.
- [ ] Detail ODP gallery/history baseline dicatat.
- [ ] Role/scope block baseline dicatat.

### Product Decision

- [ ] Topology Management adalah pusat input/edit relasi.
- [ ] As-Built Documents adalah output/snapshot/export.
- [ ] Maps adalah visual layer terakhir.
- [ ] QR default berlaku untuk semua device non-POP.
- [ ] Project adalah relasi utama device.

---

## 7. Implementation Gate

Implementasi phase berikutnya boleh dimulai jika:

- [ ] pre-implementation checklist selesai;
- [ ] phase target sudah dipilih;
- [ ] file target sudah jelas;
- [ ] test dan UAT untuk phase tersebut sudah jelas;
- [ ] tidak ada perubahan backend/frontend/app yang belum dipush dari pekerjaan sebelumnya, kecuali memang bagian phase aktif.

---

## 8. Rekomendasi Phase Pertama

Mulai dari:

```txt
Phase 2 - Generic Device Identity dan Project Relation
```

Sub-urutan yang aman:

1. Audit QR component frontend.
2. Generalisasi label QR detail dari ODP-only menjadi device-generic.
3. Pastikan public QR fallback menampilkan type device, nama device, tenant, POP, dan Project jika tersedia.
4. Audit create/edit device untuk Project field.
5. Pastikan detail device, request approval, dan audit trail menampilkan Project.
6. UAT ODP dulu, lalu ODC/OLT/ONT/device lain.

Kenapa bukan port connection dulu:

- QR dan Project lebih foundational.
- Risiko data topology lebih kecil.
- Tidak mengganggu approval port/core yang perlu desain lebih hati-hati.
