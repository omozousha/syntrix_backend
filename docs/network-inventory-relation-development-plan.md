# Network Inventory Relation Development Plan

Rencana ini menjelaskan pengembangan relasi inventory jaringan Syntrix dari level POP sampai customer/ONT dengan model graph berbasis `devices`, `device_ports`, dan `port_connections`.

Dokumen ini dibuat sebagai acuan implementasi bertahap agar pengembangan topology tidak mengganggu flow yang sudah berjalan: master data, validation request, approval adminregion/superadmin, audit trail, frontend, dan Syntrix-One.

---

## 1. Tujuan

Membangun source of truth relasi antar asset jaringan yang:

- bisa menangani banyak kategori device, bukan hanya ODP;
- menjadikan setiap device non-POP memiliki QR dinamis sebagai identitas lapangan;
- menjadikan project sebagai relasi bisnis utama setiap device;
- mendukung trace upstream/downstream dari customer/ONT sampai POP;
- menjaga akurasi port, core, kabel, route, dan customer assignment;
- menjadikan Topology/Core Management sebagai sumber visual relasi jaringan;
- menjadikan As-Built Documents sebagai output/dokumentasi final dari topology yang sudah approved;
- tetap mengikuti approval flow Syntrix;
- bisa dipakai konsisten oleh backend, frontend, dan Syntrix-One;
- siap untuk map/topology view, impact analysis, occupancy, dan integrity check.

---

## 2. Prinsip Desain

### 2.1 Source of Truth

Source of truth topology:

```text
devices -> device_ports -> port_connections
```

Aturan:

- `devices` menyimpan semua asset jaringan.
- `device_ports` menyimpan port/core/splitter endpoint per device.
- `port_connections` menyimpan koneksi port-to-port.
- `device_links` diperlakukan sebagai legacy/summary, bukan source of truth final.
- `network_routes`, `fiber_cores`, dan `core_management` dipakai untuk route/core detail.

### 2.2 Generic Device First

Jangan membuat tabel khusus seperti `odc_inventories`, `odp_inventories`, atau `odp_ports` sebagai model utama.

Gunakan:

- `device_type_key` untuk membedakan OLT, ODC, ODP, ONT, CABLE, SWITCH, ROUTER, dan device lain.
- `custom_fields` atau `specifications` untuk atribut yang belum perlu menjadi kolom permanen.
- kolom eksplisit hanya jika field tersebut sering difilter, dihitung, atau dipakai lintas workflow.

### 2.3 Approval-Safe Mutation

Perubahan topology yang dilakukan adminregion atau validator tidak boleh langsung mengubah inventory final.

Mutasi berikut wajib masuk approval:

- create/update/archive device;
- provision/update port;
- create/update/delete port connection;
- assign/release customer dari port;
- attach ONT ke customer/port;
- update route/core relasi;
- perubahan hasil validasi lapangan.

Inventory final berubah setelah approval sesuai role selesai.

### 2.4 Relation-Ready Rendering

API read yang dipakai frontend dan Syntrix-One harus mengembalikan label relasi siap tampil.

Contoh response device detail harus membawa:

- `region.region_name`;
- `pop.pop_name` dan `pop.pop_code`;
- `tenant.tenant_name`;
- `device_type.display_name`;
- `customer.customer_name` atau `customer_number`;
- port summary;
- upstream/downstream summary jika relevan.

Tujuannya agar UI tidak menampilkan UUID sementara sebelum label relasi dimuat.

### 2.5 Device QR by Default

Setiap record di `devices` harus bisa dibuka melalui QR dinamis.

Aturan:

- QR default berlaku untuk semua device non-POP.
- POP tetap diperlakukan sebagai site/location scope, bukan selalu asset fisik.
- QR tidak perlu disimpan sebagai file statis per device.
- QR dibangun dari public QR endpoint dan `device.id` atau identifier aman lain.
- Komponen QR di detail device harus generik untuk semua device type, bukan hanya ODP.
- Template QR tetap mengikuti QR label setting global yang diatur superadmin.

Tujuan:

- teknisi/validator bisa membuka detail device dari label fisik;
- QR label konsisten untuk ODP, ODC, OLT, ONT, cable device, switch, router, dan device lain;
- QR tetap berubah otomatis jika template logo/footer global berubah.

### 2.6 Project as Main Device Relation

Setiap device harus punya relasi utama ke project jika device tersebut berasal dari pekerjaan/proyek tertentu.

Aturan:

- `devices.project_id` diposisikan sebagai relasi bisnis utama, bukan metadata tambahan.
- Untuk data existing, `project_id` boleh null sampai ada backfill atau koreksi data.
- Untuk create device baru, project harus menjadi field penting dan direkomendasikan kuat.
- Pada workflow adminregion, project harus tampil jelas di request preview.
- Pada approval superadmin, project menjadi konteks apakah asset boleh masuk inventory final.
- Route, port connection, core relation, dan As-Built output sebaiknya juga bisa difilter berdasarkan project.

Tujuan:

- asset dapat dilacak berdasarkan pekerjaan;
- As-Built bisa dibuat per project;
- audit trail dan approval lebih mudah dipahami.

### 2.7 Topology Management before As-Built Output

As-Built Documents tidak boleh menjadi source of truth relasi jaringan.

Keputusan:

- Source of truth tetap `devices`, `device_ports`, `port_connections`, `network_routes`, dan core data.
- Halaman relasi teknis sebaiknya berkembang menjadi `Topology Management` atau `Topology & Core Management`.
- As-Built Documents menjadi output/dokumen final dari topology yang sudah approved.
- Nama halaman `As-Built Documents` bisa dipertahankan sementara, tetapi arah produk perlu dipisahkan:
  - `Topology Management`: input, koreksi, trace, dan visual relasi.
  - `As-Built Documents`: arsip, export, dan dokumentasi final.

Tujuan:

- visual topology tidak bergantung pada file dokumen;
- dokumen As-Built selalu bisa diregenerasi dari data yang benar;
- core management punya tempat operasional yang tepat.

### 2.8 Maps as Final Spatial Layer

Maps/GIS penting, tetapi dikerjakan setelah relasi topology stabil.

Aturan:

- Maps tidak menjadi source of truth awal.
- Maps membaca lokasi device, route geometry, dan topology relation yang sudah approved.
- Map editor/drawing bisa masuk fase akhir setelah port, core, route, dan trace stabil.

Tujuan:

- menghindari visual map yang terlihat benar tetapi relasi port/core salah;
- menjaga implementasi tetap bertahap dan bisa diuji.

---

## 3. Kondisi Saat Ini

Fondasi yang sudah tersedia:

- `devices` sebagai master asset.
- QR label dinamis sudah matang untuk ODP dan perlu digeneralisasi ke semua device.
- `device_ports` untuk port inventory.
- `port_connections` untuk koneksi port-to-port.
- `device_port_templates` untuk provision port berdasarkan tipe device.
- `splitter_profiles` untuk profil splitter.
- `network_routes` untuk jalur fisik.
- `core_management` dan/atau `fiber_cores` untuk core tracking.
- `project_id` sudah ada di `devices`, tetapi perlu diperlakukan sebagai main relation.
- `validation_requests` untuk approval workflow.
- audit trail dengan before/after dan action categorization.
- endpoint topology trace/integrity/quality mulai tersedia.
- frontend sudah mulai memakai Relation-Ready Rendering.
- Syntrix-One sudah menampilkan detail ODP, gallery, history, dan validasi sesuai role.

Gap utama:

- QR detail masih perlu menjadi generic device capability, bukan hanya ODP.
- Project relation perlu konsisten di create/edit/detail/request/approval/filter.
- Fungsi As-Built Documents perlu diposisikan ulang sebagai output dari Topology/Core Management.
- Maps belum diimplementasikan dan sebaiknya menjadi fase akhir.
- UI topology/port management belum sepenuhnya menjadi workflow utama.
- Mutasi `port_connections` dan customer assignment perlu dipastikan approval-safe.
- Trace upstream/downstream perlu distandardisasi outputnya untuk frontend dan mobile.
- Integrity check perlu menjadi operasional rutin.
- Migration/backfill dari relasi lama ke port-to-port perlu rapi.
- Dokumentasi dan UAT belum memetakan semua device type.

---

## 4. Scope Pengembangan

### In Scope

- standardisasi model relasi device generic;
- generic QR label untuk semua device non-POP;
- project sebagai relasi utama device;
- port template dan port provisioning;
- port-to-port connection workflow;
- customer/ONT assignment ke port;
- trace upstream/downstream;
- topology integrity report;
- Topology/Core Management sebagai visual operasional relasi perangkat;
- As-Built Documents sebagai output/export/arsip dari topology approved;
- frontend views untuk topology/port/connection;
- Syntrix-One read-only topology summary sesuai role;
- approval-safe mutation;
- audit trail untuk semua mutasi topology;
- migration/backfill script bila diperlukan.

### Out of Scope untuk Tahap Awal

- real-time network monitoring;
- auto discovery dari perangkat jaringan;
- integration OLT live command;
- full GIS route drawing editor;
- link budget advanced dengan semua vendor-specific loss parameter;
- multi-template project-specific QR label;
- multi-template QR label topology.

Fitur out of scope bisa masuk phase lanjutan setelah source of truth stabil.

---

## 5. Arsitektur Data Target

### 5.1 devices

Digunakan untuk semua asset.

Wajib konsisten:

- `region_id` selalu ada.
- `pop_id` optional tapi direkomendasikan untuk asset dalam scope POP.
- `project_id` menjadi relasi bisnis utama untuk asset yang berasal dari pekerjaan/proyek.
- `tenant_id` optional sesuai kebutuhan bisnis.
- `device_type_key` wajib mengacu master device type.
- `validation_status` hanya final setelah approval.
- setiap device non-POP harus punya QR dinamis di detail page.

Catatan:

- Device tanpa project masih boleh ada untuk data legacy atau asset umum, tetapi harus terlihat sebagai data yang perlu dilengkapi.
- Field Project harus tampil di detail device, request approval, audit trail, dan filter data-management.

### 5.2 device_ports

Digunakan untuk port teknis dan assignment service.

Aturan:

- `(device_id, port_index)` unik.
- status port: `idle`, `used`, `reserved`, `down`, `maintenance`.
- customer assignment hanya boleh pada port yang sesuai.
- ONT assignment mengisi `ont_device_id`.
- Port yang sudah used tidak bisa dipakai ulang.

### 5.3 port_connections

Digunakan untuk graph edge.

Aturan:

- `from_port_id` dan `to_port_id` tidak boleh sama.
- koneksi lintas region harus ditolak kecuali ada kebutuhan khusus yang disetujui.
- port yang terkoneksi harus aktif dan tidak soft-deleted.
- `cable_device_id` dipakai jika koneksi melewati kabel sebagai asset.
- `route_id` dipakai jika koneksi mengikuti network route.

### 5.4 validation_requests

Digunakan untuk staged mutation.

Payload topology harus menyimpan:

- entity target;
- intended action;
- before snapshot;
- after snapshot;
- affected device/port/connection IDs;
- relation labels untuk preview;
- attachment/evidence bila ada;
- actor dan approval state.

### 5.5 audit_logs

Audit harus mencatat:

- action name spesifik;
- actor;
- entity type;
- entity id;
- entity label;
- before_data;
- after_data;
- request_id jika berasal dari approval;
- IP dan user agent;
- timestamp.

### 5.6 qr_identity

QR identity tidak membutuhkan tabel baru untuk tahap awal.

Sumber data:

- `devices.id` sebagai identifier internal;
- public QR endpoint untuk browser fallback;
- QR label template global untuk logo dan footer;
- relation label dari device detail untuk nama device, type, POP, tenant, dan project jika perlu.

Aturan:

- QR label tidak menyimpan snapshot statis kecuali nanti dibutuhkan untuk arsip cetak.
- Jika device di-rename, QR tetap valid karena targetnya berbasis ID.
- Jika template logo/footer berubah, download QR detail dan bulk mengikuti setting terbaru.

### 5.7 topology_management

Topology Management adalah layer operasional untuk melihat dan mengelola hasil relasi:

- device;
- port;
- connection;
- route;
- core;
- customer/ONT assignment;
- trace upstream/downstream;
- integrity warning.

As-Built Documents mengambil output dari layer ini.

### 5.8 as_built_documents

As-Built Documents berfungsi sebagai:

- dokumen final;
- export/shareable view;
- arsip topology approved;
- snapshot pekerjaan per project atau per route.

As-Built Documents bukan tempat utama untuk membuat relasi port/core. Input relasi tetap melalui Topology Management dan approval flow.

---

## 6. Phase Implementasi

## Phase 1 - Product/Data Contract Audit

Tujuan:
Memastikan schema dan product contract cukup untuk topology target sebelum menambah fitur.

Todo:

- [ ] Audit `devices`, `device_ports`, `port_connections`, `device_links`, `network_routes`, `fiber_cores`, `core_management`.
- [ ] Audit QR label component agar bisa dipakai semua device type.
- [ ] Audit penggunaan `project_id` di create/edit/detail/request/approval/filter.
- [ ] Tetapkan keputusan nama produk: `Topology Management` sebagai pusat relasi, `As-Built Documents` sebagai output.
- [ ] Pastikan semua FK dan index yang dibutuhkan trace sudah ada.
- [ ] Pastikan `device_ports` mendukung customer/ONT assignment.
- [ ] Pastikan `port_connections` mendukung route, cable, core range, status.
- [ ] Buat response contract topology untuk frontend dan Syntrix-One.
- [ ] Tentukan field wajib untuk port create/update.
- [ ] Tentukan field wajib untuk connection create/update.

Checker:

- [ ] Tidak ada tabel baru yang dibuat jika schema existing cukup.
- [ ] Semua relasi target dapat direpresentasikan dengan tabel existing.
- [ ] Semua device non-POP dapat diarahkan ke QR endpoint.
- [ ] Project relation tersedia di API contract device.
- [ ] Tidak ada field UUID-only yang menjadi satu-satunya data display di API contract.
- [ ] Dokumen contract disetujui sebelum implementasi API.

Risiko:

- Menambah tabel baru terlalu cepat akan membuat data terpecah.
- Kontrak API yang belum stabil akan memicu refactor frontend/mobile berulang.

---

## Phase 2 - Generic Device Identity dan Project Relation

Tujuan:
Menjadikan QR dan project sebagai fondasi identitas device.

Todo:

- [x] Jadikan QR Label Panel sebagai komponen generik di detail semua device non-POP.
- [x] Pastikan QR bulk bisa memproses semua device type yang eligible, bukan hanya ODP.
- [ ] Pastikan QR label menampilkan type device, nama device, inventory ID, POP, dan optional project/tenant sesuai template.
- [x] Pastikan public QR fallback tetap app-required dan aman.
- [x] Pastikan create/edit device punya field Project yang jelas.
- [x] Pastikan detail device menampilkan Project di section utama.
- [x] Pastikan request approval menampilkan Project lama/baru bila berubah.
- [x] Pastikan filter data-management bisa by Project jika API sudah mendukung.

Checker:

- [x] Detail ODP, ODC, OLT, ONT, dan device lain memiliki QR panel konsisten.
- [x] Download QR detail dan bulk memakai template global yang sama.
- [ ] Device baru dari adminregion membawa project context ke request.
- [ ] Superadmin bisa melihat Project saat approve create/update device.
- [x] UI tidak menampilkan raw `project_id`.

---

## Phase 3 - Port Template dan Provisioning Standard

Tujuan:
Membuat pembuatan port konsisten untuk setiap device type.

Todo:

- [ ] Review `device_port_templates` untuk OLT, ODC, ODP, ONT, SWITCH, ROUTER, CABLE.
- [ ] Pastikan default ODP 1:8/1:16 bisa dipilih dari `total_ports` atau template.
- [ ] Pastikan create device dapat provision port otomatis atau manual sesuai mode.
- [ ] Tambahkan dry-run provisioning untuk melihat port yang akan dibuat.
- [ ] Pastikan provision port tercatat di audit trail.
- [ ] Pastikan adminregion provisioning masuk approval jika mengubah inventory final.

Checker:

- [ ] Create ODP 16 port menghasilkan 16 row `device_ports`.
- [ ] Re-run provision tidak membuat duplicate port.
- [ ] Port usage di `devices.total_ports` dan `devices.used_ports` sinkron.
- [ ] Audit trail menampilkan nama device dan jumlah port yang dibuat.

---

## Phase 4 - Port Connection Workflow

Tujuan:
Membuat koneksi port-to-port sebagai workflow utama topology.

Todo:

- [ ] API create/update/delete `port_connections`.
- [ ] Validasi from/to port aktif.
- [ ] Validasi region consistency.
- [ ] Validasi port tidak terkoneksi ganda jika jenis port tidak mengizinkan.
- [ ] Validasi cable/core range.
- [ ] Approval flow untuk adminregion.
- [ ] Audit trail action spesifik.
- [ ] Response Relation-Ready untuk connection detail.

Checker:

- [ ] Koneksi ODC output port ke ODP input port bisa dibuat.
- [ ] Koneksi dengan port deleted ditolak.
- [ ] Koneksi cross-region ditolak.
- [ ] Adminregion create connection menghasilkan request, bukan langsung final.
- [ ] Superadmin approval menerapkan connection ke inventory.

---

## Phase 5 - Customer dan ONT Assignment

Tujuan:
Mengunci customer/ONT ke port ODP secara akurat.

Todo:

- [ ] API assign customer ke port.
- [ ] API release customer dari port.
- [ ] API attach ONT device ke port.
- [ ] Validasi port harus idle/reserved sesuai policy.
- [ ] Validasi customer tidak aktif di dua port berbeda tanpa policy migrasi.
- [ ] Approval flow untuk adminregion.
- [ ] Audit trail dengan customer name/CID dan device name.

Checker:

- [ ] Assign customer membuat port `used`.
- [ ] Release customer membuat port `idle` atau `reserved` sesuai payload.
- [ ] ODP occupancy berubah sesuai assignment.
- [ ] Trace dari customer menemukan upstream path.
- [ ] UI tidak bisa assign ke port penuh/down.

---

## Phase 6 - Trace Upstream dan Downstream

Tujuan:
Menyediakan tracing topology untuk troubleshooting dan impact analysis.

Todo:

- [ ] Standardisasi endpoint `GET /topology/trace`.
- [ ] Input mendukung `device_id`, `port_id`, dan `customer_id`.
- [ ] Direction: `upstream`, `downstream`, `both`.
- [ ] Output: nodes, edges, path, warnings, depth, relation labels.
- [ ] Batasi hasil berdasarkan role/region.
- [ ] Tambahkan loop protection dan max depth.
- [ ] Tambahkan trace summary untuk device detail.

Checker:

- [ ] Trace dari ODP menampilkan upstream ODC/OLT/POP bila relasi tersedia.
- [ ] Trace dari customer menampilkan port ODP dan upstream path.
- [ ] Trace dari ODC downstream menampilkan ODP/customer terdampak.
- [ ] User adminregion hanya melihat region yang diizinkan.
- [ ] UI tidak menampilkan UUID mentah saat data trace dimuat.

---

## Phase 7 - Integrity dan Quality Report

Tujuan:
Mendeteksi data topology yang tidak sehat.

Todo:

- [ ] Report orphan `port_connections`.
- [ ] Report port over-capacity.
- [ ] Report connection same-device invalid.
- [ ] Report cross-region connection.
- [ ] Report customer assigned ke port tidak used.
- [ ] Report ONT assigned lebih dari satu port aktif.
- [ ] Report route tanpa start/end asset.
- [ ] Tambahkan severity: info, warning, critical.

Checker:

- [ ] Endpoint integrity mengembalikan issue list dan summary.
- [ ] UI bisa filter issue by severity.
- [ ] Issue punya action hint.
- [ ] Tidak ada false positive untuk data valid.

---

## Phase 8 - Frontend Topology Management UX

Tujuan:
Membuat topology dan core relation bisa dikelola dari web admin.

Todo:

- [ ] Device detail menampilkan port list ringkas.
- [ ] Device detail menampilkan Project dan QR panel generik.
- [ ] Drawer port detail menampilkan connection dan assignment.
- [ ] UI create connection dari port A ke port B.
- [ ] UI trace topology dari detail device.
- [ ] UI occupancy per ODP/ODC/OLT.
- [ ] UI integrity report.
- [ ] UI Topology Management menampilkan relasi device, port, core, route, dan customer/ONT assignment.
- [ ] As-Built Documents diarahkan menjadi output/export dari data topology yang approved.
- [ ] Semua komponen memakai Relation-Ready Rendering.
- [ ] Komponen form/tabs/drawer/select/date picker memakai shadcn UI bila tersedia.
- [ ] Responsive desktop/tablet/mobile.

Checker:

- [ ] Tidak ada layout overflow di mobile.
- [ ] Tidak ada UUID flash saat membuka detail.
- [ ] Adminregion dan superadmin melihat action sesuai role.
- [ ] Mutasi adminregion masuk approval.
- [ ] Superadmin bisa review before/after topology.
- [ ] Nama halaman/menu tidak membingungkan antara topology editor dan dokumen As-Built.

---

## Phase 9 - As-Built Documents Output

Tujuan:
Menjadikan As-Built Documents sebagai dokumen/export/snapshot dari topology approved.

Todo:

- [ ] Tentukan apakah menu tetap bernama `As-Built Documents` atau dipindah di bawah `Topology Management`.
- [ ] Generate As-Built berdasarkan project, route, POP, atau selected device path.
- [ ] Simpan snapshot metadata: project, region, route, generated_by, generated_at.
- [ ] Tampilkan visual topology/core summary yang read-only.
- [ ] Tambahkan export PDF/CSV/JSON bila dibutuhkan.
- [ ] Pastikan dokumen hanya memakai data approved.

Checker:

- [ ] As-Built per project bisa menunjukkan device dan connection yang relevan.
- [ ] As-Built tidak menjadi tempat input relasi utama.
- [ ] Perubahan topology setelah dokumen dibuat tidak mengubah snapshot lama kecuali regenerate.
- [ ] Role adminregion hanya bisa melihat scope regionnya.

---

## Phase 10 - Syntrix-One Topology Read Support

Tujuan:
Menyediakan data topology yang relevan untuk validator/mobile tanpa memberi akses mutasi yang tidak diperlukan.

Todo:

- [ ] Detail semua device hasil QR menampilkan QR identity dan project context jika tersedia.
- [ ] Detail ODP menampilkan upstream summary.
- [ ] Detail ODP menampilkan port occupancy.
- [ ] Detail ODP menampilkan customer count jika role boleh.
- [ ] Detail ODP menampilkan validation history dan approved gallery.
- [ ] Scanner QR tetap memblokir cross-region dan role non-validator.
- [ ] Loading state konsisten saat memuat trace/detail.
- [ ] Offline/error state jelas.

Checker:

- [ ] Validator hanya melihat scope region miliknya.
- [ ] Adminregion/superadmin tidak diarahkan ke form validasi mobile.
- [ ] Data approved di web dan mobile konsisten.
- [ ] Tidak ada image/history kosong jika backend sudah punya data approved.

---

## Phase 11 - Maps/GIS Visualization

Tujuan:
Menambahkan layer spasial setelah relasi topology, route, dan core stabil.

Todo:

- [ ] Tampilkan device berdasarkan longitude/latitude.
- [ ] Tampilkan route berdasarkan `network_routes.path_geojson`.
- [ ] Tampilkan connection/path dari hasil trace.
- [ ] Tampilkan marker status validation/health/occupancy.
- [ ] Filter by region, project, POP, device type, dan tenant.
- [ ] Pastikan map membaca data approved, bukan staged request.

Checker:

- [ ] Maps tidak menjadi source of truth relasi.
- [ ] Device tanpa koordinat punya fallback list issue.
- [ ] Route tanpa geometry tetap bisa ditampilkan di topology table/tree.
- [ ] Performa tetap aman saat data besar.

---

## Phase 12 - Migration dan Backfill

Tujuan:
Memindahkan atau melengkapi data lama agar mengikuti source of truth baru.

Todo:

- [ ] Audit device non-POP yang belum punya QR display eligibility.
- [ ] Audit device yang belum punya `project_id`.
- [ ] Audit device yang punya `total_ports` tapi belum punya `device_ports`.
- [ ] Backfill port ODP berdasarkan `total_ports`.
- [ ] Backfill project relation bila bisa diturunkan dari import, request, POP, route, atau dokumen lama.
- [ ] Backfill basic `device_links` ke `port_connections` jika memungkinkan.
- [ ] Backfill customer assignment ke port jika data tersedia.
- [ ] Backfill route/core relation jika data tersedia.
- [ ] Buat script manual SQL yang safe to run more than once.
- [ ] Tambahkan verification query di setiap script.

Checker:

- [ ] Script idempotent.
- [ ] Verification result jelas.
- [ ] Tidak mengubah data final tanpa evidence.
- [ ] Bisa rollback atau minimal punya backup query.

---

## Phase 13 - UAT dan Release

Tujuan:
Memastikan fitur aman sebelum dipakai operasional.

UAT scenario:

- [ ] Semua device non-POP punya QR di detail.
- [ ] QR ODP, ODC, OLT, ONT, dan device lain membuka fallback/app target yang benar.
- [ ] Create device baru wajib/menyarankan project dan tampil di approval.
- [ ] Superadmin create ODP dengan 16 port.
- [ ] Adminregion create ODP dan menunggu approval.
- [ ] Superadmin approve create ODP lalu port tersedia.
- [ ] Adminregion membuat connection ODC -> ODP dan menunggu approval.
- [ ] Superadmin approve connection lalu trace bekerja.
- [ ] Assign customer ke port ODP.
- [ ] Coba assign customer ke port used, harus ditolak.
- [ ] Trace customer ke POP.
- [ ] Trace ODC downstream untuk impact analysis.
- [ ] Integrity report mendeteksi orphan/cross-region test data.
- [ ] Topology Management menampilkan port, connection, route, core, dan assignment.
- [ ] As-Built Documents dapat dibuat dari project/topology approved.
- [ ] Maps menampilkan data jika relasi dan koordinat sudah tersedia.
- [ ] Audit trail menampilkan action, actor, entity label, before/after.
- [ ] Syntrix-One detail ODP menampilkan data approved yang sama dengan frontend.

Release checklist:

- [ ] SQL migration siap.
- [ ] Manual SQL backfill siap jika diperlukan.
- [ ] Backend deployed.
- [ ] Frontend deployed.
- [ ] Syntrix-One build siap jika ada perubahan mobile.
- [ ] Post-deploy smoke test selesai.
- [ ] Rollback plan tersedia.

---

## 7. Risiko dan Mitigasi

Risiko: Data topology menjadi tidak konsisten karena sebagian memakai `device_links`, sebagian memakai `port_connections`.

Mitigasi:
- Tetapkan `port_connections` sebagai source of truth.
- `device_links` hanya summary/legacy.
- Buat transition/backfill bertahap.

Risiko: Approval flow tidak ikut pada mutasi topology.

Mitigasi:
- Semua endpoint mutasi topology memakai guard role.
- Adminregion/validator membuat `validation_requests`.
- Apply final hanya dilakukan saat approval final.

Risiko: UI menampilkan UUID atau data flicker.

Mitigasi:
- Semua API read topology harus Relation-Ready.
- Frontend menggunakan skeleton/loading, bukan fallback UUID.

Risiko: QR hanya matang untuk ODP dan tidak konsisten untuk device lain.

Mitigasi:
- Gunakan satu komponen QR generik untuk semua device.
- Hindari hardcode label ODP di helper QR.
- UAT minimal mencakup beberapa device type.

Risiko: Project hanya menjadi field tambahan dan tidak membantu workflow.

Mitigasi:
- Tampilkan Project di create/edit/detail/request/approval/audit.
- Jadikan Project filter utama untuk As-Built dan topology.
- Tambahkan data completeness report untuk device tanpa project.

Risiko: As-Built Documents berubah menjadi source of truth kedua.

Mitigasi:
- Tetapkan Topology Management sebagai tempat input/edit relasi.
- As-Built hanya snapshot/export dari data approved.
- Regenerate As-Built harus eksplisit.

Risiko: Maps dibangun sebelum data topology sehat.

Mitigasi:
- Jadikan Maps fase akhir.
- Maps hanya membaca device, route, dan connection approved.
- Integrity report harus tersedia sebelum map menjadi fitur operasional utama.

Risiko: Port occupancy tidak sinkron.

Mitigasi:
- Update port usage setelah assign/release/provision.
- Tambahkan checker integrity.

Risiko: Migration mengubah data lama secara salah.

Mitigasi:
- Semua script backfill idempotent.
- Verification query wajib.
- Jalankan di staging/preview dulu jika memungkinkan.

---

## 8. Definition of Done

Pengembangan dianggap selesai jika:

- semua device non-POP punya QR dinamis di detail dan download label;
- semua device baru punya project context yang jelas;
- semua asset topology memakai `devices`, `device_ports`, dan `port_connections`;
- create/update topology mengikuti approval flow;
- trace upstream/downstream berjalan untuk device dan customer;
- occupancy port akurat;
- integrity report tersedia;
- Topology Management menjadi pusat visual relasi, port, core, route, dan assignment;
- As-Built Documents menjadi output/snapshot dari topology approved;
- Maps/GIS tersedia sebagai layer spasial setelah relasi stabil;
- audit trail lengkap dan mudah dibaca;
- frontend responsive dan Relation-Ready;
- Syntrix-One menampilkan data approved yang konsisten;
- UAT superadmin, adminregion, dan validator selesai.

---

## 9. Catatan Implementasi

Urutan terbaik:

1. Jangan mulai dari UI map besar.
2. Jadikan QR dan Project sebagai identitas dasar semua device.
3. Stabilkan port dan connection.
4. Pastikan approval-safe.
5. Baru tampilkan trace dan Topology/Core Management.
6. Jadikan As-Built Documents sebagai output dari topology approved.
7. Setelah data sehat, lanjut ke link budget dan map/GIS yang lebih kaya.

Pendekatan ini lebih aman karena Syntrix sudah punya workflow validasi dan approval yang aktif digunakan.
