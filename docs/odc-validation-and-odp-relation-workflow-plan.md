# ODC Validation and ODP Relation Workflow Plan

Dokumen ini adalah companion plan untuk:

- `docs/network-inventory-relation-development-plan.md`
- `docs/generic-device-detail-and-validation-workflow-plan.md`

Fokus dokumen ini adalah memperdalam form validasi ODC dan workflow relasi ODC ke ODP. ODC tidak boleh diperlakukan sebagai generic device biasa; ODC adalah titik cabinet/distribution yang menghubungkan feeder/upstream ke ODP/downstream.

Tujuan utama: membangun rantai relasi perangkat yang lengkap dan valid dari POP/OTB sampai ODP, sehingga fitur Trace Topology bisa menelusuri jalur optik secara akurat:

```text
POP / OTB -> Kabel Feeder -> ODC -> Kabel Distribusi -> ODP
```

---

## 1. Prinsip Produk

### 1.1 ODC Sebagai Distribution Cabinet

ODC harus menampilkan dan memvalidasi konteks:

- identitas cabinet/site;
- lokasi dan POP/project;
- kapasitas port dan core;
- feeder side;
- distribution side;
- tray/splitter/splice condition;
- downstream ODP yang terhubung;
- route, cable, dan core range yang dipakai.

ODC bukan customer endpoint. Customer assignment tetap terjadi di port ODP atau ONT relation, bukan langsung di ODC.

### 1.2 Source of Truth Relasi ODC ke ODP

Relasi ODC -> ODP wajib memakai data approved:

```text
devices(ODC) -> device_ports(ODC output/distribution port)
  -> port_connections
  -> device_ports(ODP input/upstream port)
  -> devices(ODP)
```

Relasi pendukung:

- `port_connections.route_id` untuk route/path;
- `port_connections.cable_device_id` untuk kabel distribusi;
- `port_connections.core_start` dan `core_end` untuk core range;
- `fiber_cores` untuk status per core;
- `core_management` untuk summary/range read model.

### 1.3 Approval-Safe Mutation

Validator tidak boleh langsung membuat/mengubah relasi ODC -> ODP.

Pembagian tanggung jawab:

- Validator: validasi kondisi lapangan ODC dan memberi rekomendasi/temuan relasi.
- Adminregion: review, membuat/mengubah relasi topology jika diperlukan.
- Superadmin: final approval untuk perubahan inventory/topology.

### 1.4 Project Relation as Asset Capitalization Context

Relasi Project adalah konteks bisnis/legal untuk asset pasif. ODC, ODP, dan kabel tidak perlu tabel relasi project baru selama semuanya masih direpresentasikan sebagai row `devices`.

Source of truth:

```text
projects(id)
  -> devices.project_id
     where device_type_key in ('ODC', 'ODP', 'CABLE', 'OTB', 'JC')
```

Keputusan implementasi:

- gunakan field existing `devices.project_id` untuk ODC, ODP, kabel, OTB, dan JC;
- jangan menambah foreign key baru khusus ODC/ODP/CABLE kecuali UAT membuktikan `devices.project_id` tidak cukup;
- create/edit device harus tetap menyediakan field `Project`;
- project detail harus punya read model asset rollup dari `devices.project_id`;
- topology relation boleh memberi warning jika `from_device`, `to_device`, dan `cable_device` berada di project berbeda;
- cross-project relation tidak langsung diblokir karena asset legacy dan route bersama bisa valid secara operasional.

Manfaat yang harus didukung:

- Asset Capitalization: project dapat menghitung ODC/ODP/kabel yang dibuat atau dipasang dalam konteks SPK, BAST, vendor, dan budget.
- As-Built Lifecycle: project menjadi pusat untuk evidence, image attachments, support documents, dan as-built documents.
- Spatial Tagging: device yang dibuat dari konteks project bisa mewarisi region/POP/location context untuk mengurangi salah input.

### 1.5 Physical Asset Field Requirements

Setiap asset fisik yang ikut rantai topology harus punya dua status minimum:

- `validation_status`: `unvalidated`, `validated`, atau status workflow lain yang sudah disepakati.
- `operational_status`: `planned`, `installed`, `maintenance`, `broken`, atau status operasional sejenis.

Status ini dipakai untuk audit, data quality, dan Trace Topology agar sistem bisa membedakan asset yang belum divalidasi dari asset yang memang rusak atau belum terpasang.

#### OTB / POP Patch Panel

OTB adalah titik paling hulu di POP. Jika master data belum punya tipe `OTB`, asset ini bisa sementara direpresentasikan sebagai device POP-side dengan `device_type_key` yang disepakati.

Field wajib:

- Identity:
  - device id / inventory id;
  - device name;
  - brand;
  - model;
  - serial number.
- Capacity:
  - total slot tray;
  - total port/core capacity, for example 24, 48, 96, or 144 core.
- Technical:
  - connector type, for example SC/UPC, SC/APC, or LC;
  - rack unit position;
  - tray/patch panel position if available.
- Relation and location:
  - POP ID / POP name;
  - room name;
  - rack location;
  - region/project context;
  - operational status.

Trace role:

- upstream source for ODC feeder relation;
- origin node for feeder cable;
- first traceable optical handoff from POP to outside plant.

#### ODC

ODC adalah titik distribusi menengah yang membagi feeder cable menjadi distribution cable.

Field wajib:

- Identity:
  - device id / inventory id;
  - device name;
  - brand;
  - model.
- Capacity and usage:
  - total core capacity;
  - used core;
  - total port cabinet;
  - port status: idle, connected, reserved, maintenance.
- Internal splitter:
  - splitter profile;
  - splitter ratio, for example 1:2, 1:4, or 1:8.
- Geospatial:
  - latitude;
  - longitude;
  - address / location description.
- Relation:
  - region id;
  - POP/project;
  - tenant/owner, for example PT. TRANS INDONESIA SUPERKORIDOR;
  - upstream OTB relation;
  - downstream ODP relation.

Trace role:

- receives feeder relation from OTB;
- emits distribution relation to ODP;
- main checkpoint for downstream impact analysis.

#### ODP

ODP adalah titik distribusi akhir yang menghadap ke pelanggan/ONT.

Field wajib:

- Identity:
  - device id;
  - device name;
  - installation type, for example aerial/pole, closure, wall, or pedestal.
- Drop capacity:
  - total port/splitter capacity, for example 8 or 16 ports;
  - splitter ratio, for example 1:8 or 1:16.
- Port status:
  - port id / port label, for example #1 to #8;
  - port status: idle, used, reserved, maintenance;
  - customer/service id if used.
- Geospatial and relation:
  - latitude;
  - longitude;
  - pole id if mounted on pole;
  - parent ODC id or upstream ODC relation from `port_connections`.

Trace role:

- receives distribution relation from ODC;
- connects service/drop ports to customer/ONT assignment;
- becomes downstream endpoint for ODC impact analysis.

#### Cable: Feeder, Distribution, and Drop

Cable adalah media transmisi fisik antar node.

Field wajib:

- Identity:
  - cable id / segment name;
  - cable type: feeder, distribution, or drop.
- Physical specification:
  - core capacity, for example 24C, 48C, 96C, or 144C;
  - cable type code, for example G.652D;
  - installation mode: aerial or buried.
- Length:
  - spanned length in meters from route/map;
  - actual/physical length in meters including slack.
- Node relation:
  - origin node id / A-End;
  - destination node id / B-End;
  - route id;
  - active core range if used by `port_connections`.

Trace role:

- physical carrier for feeder and distribution edges;
- source of `fiber_cores`;
- basis for core occupancy and cut impact simulation.

#### JC / Joint Closure / Splice Case

JC adalah titik sambung kabel di tengah rute, baik karena batas panjang haspel maupun percabangan.

Field wajib:

- Identity:
  - JC id / name;
  - JC type: inline or dome.
- Splice capacity:
  - max splice tray capacity;
  - total splice protection sleeve slots.
- Splicing data:
  - splicing chart matrix;
  - mapping from cable A core number to cable B core number;
  - splice tray number;
  - splice notes.
- Geospatial:
  - latitude;
  - longitude;
  - placement: aerial on pole, inside manhole, or other.

Trace role:

- intermediate splice node between cable segments;
- future expansion point for per-core trace beyond simple core range relation.

#### Handhole / Manhole

HH/MH adalah infrastruktur sipil bawah tanah untuk kabel slack/looping dan JC.

Field wajib:

- Identity:
  - structure id;
  - structure name;
  - structure type, for example handhole pit or main manhole.
- Dimension and specification:
  - length;
  - width;
  - depth;
  - cover type, for example concrete or heavy duty iron.
- Contents:
  - loaded cables;
  - installed JC id if any;
  - slack length in meters.
- Geospatial:
  - latitude;
  - longitude;
  - elevation/depth.

Trace role:

- civil infrastructure context for cable route;
- stores slack and installed joint closure context;
- supports field maintenance and route inspection, even when it is not an optical endpoint.

---

## 2. Target Form Validasi ODC

### 2.1 General Section

Field:

- ODC name current;
- optional suggested ODC name;
- status;
- latitude;
- longitude;
- address / location note;
- POP confirmation;
- project confirmation;
- cabinet label visible;
- QR label readable.

Payload target:

```json
{
  "general_validation": {
    "device_name": "...",
    "status": "active",
    "latitude": -6.1,
    "longitude": 106.8,
    "address": "...",
    "pop_confirmed": true,
    "project_confirmed": true,
    "cabinet_label_ok": true,
    "qr_label_ok": true
  }
}
```

### 2.2 Cabinet Condition Section

Field:

- cabinet condition: `good`, `minor_issue`, `major_issue`, `damaged`;
- door/lock condition;
- grounding condition;
- waterproof/seal condition;
- cleanliness;
- mounting/pole/wall condition;
- remarks.

Payload target:

```json
{
  "technical_validation": {
    "cabinet_condition": "good",
    "door_lock_ok": true,
    "grounding_ok": true,
    "seal_ok": true,
    "cleanliness": "good",
    "mounting_condition": "good",
    "cabinet_notes": "..."
  }
}
```

### 2.3 Port and Splitter Section

Field:

- total feeder ports;
- used feeder ports;
- total distribution ports;
- used distribution ports;
- splitter ratio/profile;
- splitter input condition;
- splitter output condition;
- unused port cap/label condition.

Mapping awal bisa memakai field existing:

- `total_ports`;
- `used_ports`;
- `splitter_ratio`;
- `device_ports` summary.

Jika nanti dibutuhkan detail feeder/distribution yang lebih presisi, tambahkan metadata port role di `device_ports.splitter_role` atau `device_ports.port_type`.

Payload target:

```json
{
  "technical_validation": {
    "feeder_port_total": 4,
    "feeder_port_used": 2,
    "distribution_port_total": 16,
    "distribution_port_used": 8,
    "splitter_ratio": "1:8",
    "splitter_input_ok": true,
    "splitter_output_ok": true,
    "port_label_ok": true
  }
}
```

### 2.4 Tray, Splice, and Core Section

Field:

- tray count;
- active tray count;
- tube/color label visible;
- core color label visible;
- splice condition;
- attenuation/loss note optional;
- core mismatch found;
- damaged core count;
- reserved/used core count.

Data read source:

- `fiber_cores` for per-core status/color/tube;
- `core_management` for range summary;
- `port_connections` for core range relation.

Payload target:

```json
{
  "technical_validation": {
    "tray_count": 2,
    "active_tray_count": 1,
    "tube_label_ok": true,
    "core_label_ok": true,
    "splice_condition": "good",
    "core_mismatch_found": false,
    "damaged_core_count": 0,
    "loss_note": "..."
  }
}
```

### 2.5 Evidence Section

Minimum evidence:

- ODC front photo;
- inside cabinet photo;
- splitter/tray photo;
- label/QR photo;
- optional route/cable/core evidence photo.

Semua evidence tetap masuk `validation_requests.payload_snapshot.field_inspection` dan baru muncul di gallery setelah final approval.

---

## 3. Target Relasi ODC ke ODP

### 3.1 Read Model di Detail ODC

Detail ODC harus menampilkan:

- total downstream ODP;
- list ODP downstream;
- connected ODC port;
- connected ODP port;
- route label;
- cable label;
- core range;
- status connection;
- fiber/core issue summary;
- link to topology trace.

Contoh display:

```text
ODC BGR-01
Downstream ODP: 12

ODC Port #D01 -> ODP BGR-02 Port #IN
Route: BGR feeder distribution 01
Cable: CBL-BGR-ODC-ODP-001
Core: 13-24
Status: active
```

### 3.2 Create Relation Flow

Relasi dibuat dari Topology Management atau action dari detail ODC.

Minimum input:

- from device: ODC;
- from port: ODC distribution/output port;
- to device: ODP;
- to port: ODP upstream/input port;
- connection type: `fiber`;
- status: `planned` atau `active`;
- route optional but recommended;
- cable device optional if belum ada data kabel, required if core range diisi;
- core start/end optional but recommended.

Backend validation rule:

- ODC dan ODP harus berada dalam region yang boleh diakses role;
- from/to port tidak boleh sama;
- port tidak boleh sudah punya active connection yang konflik;
- jika `core_start/core_end` diisi maka `cable_device_id` wajib ada;
- `cable_device_id` harus device type `CABLE`;
- core range tidak boleh overlap active/cutover connection lain;
- adminregion create/update masuk approval superadmin;
- superadmin dapat apply langsung sesuai policy existing.

### 3.3 Edit/Cancel Relation Flow

Relasi ODC -> ODP harus bisa:

- edit route;
- edit cable;
- edit core range;
- edit status: planned, active, cutover, inactive;
- archive/delete connection;
- release fiber core occupancy ketika inactive/delete;
- menampilkan rollback/audit trail.

Untuk adminregion, edit/cancel tetap approval-safe.

---

## 4. Target Rantai POP/OTB -> ODC -> ODP

Bagian ini adalah scenario-driven target untuk kasus ODC `TEST-ODC-001` di POP Kandanghaur dan ODP `BGR 02 SP 09 - 02`.

### 4.1 Tahap 1 - Jalur Hulu POP/OTB ke ODC

Kondisi saat ini:

- ODC `TEST-ODC-001` di POP Kandanghaur sudah mencatat `Used Core: 12`.
- Nilai `Core/Route` masih `0` karena belum ada input kabel feeder approved dari arah OTB.
- Trace Topology belum bisa mengetahui sumber upstream ODC.

Target:

- OTB/POP menjadi upstream source yang sah untuk ODC.
- Koneksi feeder dari OTB ke ODC tercatat sebagai `port_connections`.
- Kabel feeder dan core range tercatat sebagai relasi approved.

Tindakan:

- Masuk ke detail perangkat OTB terkait di POP Kandanghaur.
- Buat downstream connection baru dari port OTB ke port feeder/input ODC.
- Gunakan tipe connection `fiber` dengan konteks `Kabel Feeder`.
- Pilih route feeder jika sudah tersedia.
- Pilih cable device feeder jika sudah tersedia.
- Isi `core_start` dan `core_end` untuk 12 core feeder yang dipakai.
- Submit approval jika dilakukan oleh adminregion.
- Setelah approved, sync `fiber_cores` dan summary ODC.

Acceptance criteria:

- Detail ODC menampilkan upstream source OTB.
- `Core/Route` ODC tidak lagi `0` jika feeder route/core sudah tersedia.
- Trace dari ODC ke upstream dapat menemukan OTB/POP.
- `Used Core: 12` punya asal/source connection yang jelas.

### 4.2 Tahap 2 - Jalur Hilir ODC ke ODP

Kondisi saat ini:

- Hubungan ODC ke ODP `BGR 02 SP 09 - 02` masih incomplete.
- Seluruh 24 port pada ODC masih idle.
- ODP belum terbaca sebagai downstream ODC pada topology summary.

Target:

- ODC memiliki downstream ODP relation yang sah.
- Port ODC yang dipakai berubah dari idle menjadi connected/used sesuai policy.
- ODP memiliki upstream ODC relation.
- Kabel distribusi dan core range dari ODC ke ODP tercatat.

Tindakan:

- Buka detail ODC.
- Gunakan action `Create Connection`.
- Prefill from device dengan ODC `TEST-ODC-001`.
- Pilih ODC output/distribution port yang masih idle.
- Pilih target device ODP `BGR 02 SP 09 - 02`.
- Pilih ODP input/upstream port.
- Gunakan tipe connection `fiber` dengan konteks `Kabel Distribusi`.
- Pilih route distribusi jika tersedia.
- Pilih cable device distribusi jika tersedia.
- Alokasikan core distribusi dari ODC ke ODP.
- Submit approval jika dilakukan oleh adminregion.
- Setelah approved, update occupancy port ODC dan ODP.

Acceptance criteria:

- Detail ODC menampilkan ODP `BGR 02 SP 09 - 02` sebagai downstream.
- Detail ODP menampilkan ODC `TEST-ODC-001` sebagai upstream.
- ODC port yang dipakai tidak lagi idle.
- Connection memiliki labels untuk route, cable, endpoint, dan core range.
- Core distribution yang dipakai tidak overlap dengan active connection lain.

### 4.3 Tahap 3 - Validasi Data dan Pengujian Trace Topology

Kondisi saat ini:

- ODC dan ODP masih `unvalidated`.
- Topology readiness baru sebagian siap.
- Trace Topology belum bisa membaca rantai penuh.

Target:

- Rantai `OTB -> ODC -> ODP` valid dan traceable.
- Validation history berisi bukti lapangan atau approval final.
- Device detail dan topology workspace membaca data approved yang sama.

Tindakan:

- Jalankan Trace Topology dari OTB ke ODC.
- Jalankan Trace Topology dari ODC ke ODP.
- Jalankan Trace Topology dari ODP ke upstream.
- Pastikan visualisasi tidak menampilkan broken edge.
- Upload evidence lapangan untuk ODC dan ODP.
- Jalankan approval sampai status perangkat berubah `validated`.
- Re-check topology readiness setelah approval.

Acceptance criteria:

- Trace Topology menampilkan jalur:

```text
OTB -> ODC TEST-ODC-001 -> ODP BGR 02 SP 09 - 02
```

- Tidak ada orphan connection untuk jalur tersebut.
- Tidak ada active connection missing fiber core jika core range diisi.
- Tidak ada used fiber core tanpa active/cutover connection.
- ODC dan ODP punya validation history yang bisa dibaca.
- Gallery hanya menampilkan evidence yang sudah approved.

---

## 5. Backend Plan

### Endpoint Reuse Policy

Default implementasi harus memakai endpoint yang sudah ada. Endpoint baru hanya boleh dibuat jika ada gap kontrak yang tidak bisa diselesaikan dengan query parameter, response enrichment, atau resource existing.

Endpoint existing yang harus diprioritaskan:

| Kebutuhan | Endpoint existing | Catatan penggunaan |
| --- | --- | --- |
| Detail/read resource device, cable, route, port, core | Generic resource routes (`/devices`, `/devicePorts`, `/portConnections`, `/fiberCores`, `/coreManagement`, `/routes`) | Gunakan resource registry dan filter existing. Hindari endpoint detail baru untuk data yang sudah tersedia sebagai resource. |
| Public QR device lookup | `GET /public/qr/devices/:id` | Dipakai Syntrix-One untuk resolve QR sebelum membuka detail/form. |
| Device topology summary | `GET /topology/devices/:id/summary` | Extend response existing untuk upstream OTB/source, downstream ODP, labels, counts, dan readiness. Jangan buat `/odc/:id/summary` baru. |
| Trace topology | `GET /topology/trace` dan `GET /devices/:id/trace` | Reuse untuk Trace Topology OTB -> ODC -> ODP. Tambahkan response enrichment jika label/edge metadata kurang. |
| Topology map/read model | `GET /topology/maps` | Reuse untuk visualisasi map dan edge/node context. |
| Topology quality/integrity | `GET /topology/quality`, `GET /topology/integrity` | Reuse untuk data quality readiness dan issue list. Tambahkan issue type baru jika diperlukan. |
| Project asset rollup | Generic resource `/projects`, `/devices`, `/routes`, `/asBuiltDocuments` | Gunakan `devices.project_id` sebagai source of truth ODC/ODP/CABLE/OTB/JC milik project. Enrich project detail dari resource existing sebelum membuat endpoint baru. |
| Create/update/archive relation | Generic resource `/portConnections` plus existing topology connection helpers | Relation OTB -> ODC dan ODC -> ODP tetap `portConnections`; adminregion mengikuti approval flow existing. |
| Port assignment | `POST /device-ports/:id/assignment`, `DELETE /device-ports/:id/assignment` | Hanya untuk customer/ONT assignment; bukan untuk ODC feeder/distribution relation. |
| Device port provisioning | `POST /devices/:id/provision-ports` | Reuse jika OTB/ODC/ODP port template belum terbentuk. |
| Validation workflow | `/validation-requests` routes | ODC field validation tetap masuk generic validation request envelope. |
| Attachment/evidence | `/attachments/upload`, preview, download | Reuse untuk ODC evidence; gallery tetap approved-only. |

Kapan endpoint baru boleh dibuat:

- existing endpoint terlalu berat dan tidak bisa difilter tanpa memecah kompatibilitas;
- response yang dibutuhkan adalah aggregate khusus yang tidak cocok masuk `/topology/devices/:id/summary`;
- perlu action domain baru yang bukan resource CRUD, bukan validation request, dan bukan topology trace;
- semua opsi reuse sudah dicatat dan ditolak di plan sebelum implementasi.

### Phase 1 - Contract Audit

Todo:

- [ ] Audit current ODC `device_ports` template and role naming.
- [ ] Audit ODP input/upstream port convention.
- [ ] Audit OTB/POP port convention for feeder output.
- [ ] Audit existing `/topology/devices/:id/summary` response for ODC downstream labels.
- [ ] Audit existing `/topology/devices/:id/summary` response for ODC upstream OTB labels.
- [ ] Audit existing `/topology/trace` response for full chain OTB -> ODC -> ODP.
- [ ] Audit generic `/portConnections` resource flow for relation create/update/archive.
- [ ] Audit validation payload apply whitelist for ODC-specific fields.

Checker:

- [ ] Gap table tersedia untuk backend, frontend, and Syntrix-One.
- [ ] Tidak ada runtime change.

### Phase 2 - ODC Validation Payload Contract

Todo:

- [ ] Add ODC-specific payload normalizer fields.
- [ ] Add ODC-specific apply whitelist.
- [ ] Preserve generic `technical_validation` fallback.
- [ ] Ensure unsupported ODC relation fields are review-only, not directly applied.

Checker:

- [ ] ODC payload stores general/cabinet/port/core/evidence sections.
- [ ] ODC validation cannot write unrelated device fields.
- [ ] Existing ODP validation still passes.

### Phase 3 - ODC Upstream and Downstream Topology Summary

Todo:

- [x] Extend existing `/topology/devices/:id/summary` with upstream OTB/POP summary for ODC.
- [x] Extend existing `/topology/devices/:id/summary` with downstream ODP summary for ODC.
- [x] Include `labels.from`, `labels.to`, `labels.route`, `labels.cable`, and `labels.core_range`.
- [ ] Include downstream ODP count and affected customer count if role permits.
- [ ] Reuse existing `/topology/trace` for full-chain verification; enrich response only if edge labels are missing.

Checker:

- [ ] Detail ODC can render upstream OTB/source without UUID.
- [ ] Detail ODC can render ODP downstream list without UUID.
- [ ] Trace Topology can use existing trace endpoint without new ODC-specific trace endpoint.
- [ ] Adminregion region guard applies.
- [ ] Superadmin sees all accessible topology.

### Phase 4 - OTB -> ODC and ODC -> ODP Relation Validation Rules

Todo:

- [ ] Enforce OTB/POP feeder port to ODC feeder/input port when port role data exists.
- [ ] Enforce ODC output/distribution port to ODP input/upstream port when port role data exists.
- [ ] Enforce cable/core range policy.
- [ ] Enforce duplicate connection prevention.
- [ ] Enforce approval flow for adminregion create/update/archive.
- [ ] Keep create/update/archive on existing `/portConnections` resource flow unless a proven blocker appears.

Checker:

- [ ] Invalid same-device connection rejected.
- [ ] Overlapping active core range rejected.
- [ ] Adminregion relation change creates approval request.
- [ ] Superadmin approval syncs `fiber_cores`.
- [ ] No new relation endpoint is introduced unless documented in this plan.

### Phase 5 - Project Asset Rollup and Project Consistency

Todo:

- [x] Reuse `devices.project_id` for ODC, ODP, CABLE, OTB, and JC project ownership.
- [x] Add/read project asset rollup from existing generic resources before introducing a new endpoint.
- [x] Count project assets by `device_type_key` for ODC, ODP, CABLE, OTB, and JC.
- [x] Summarize cable/core capacity for CABLE rows linked to the project.
- [x] Summarize topology relation counts where from/to/cable devices belong to the project.
- [x] Add warning metadata for topology relations whose endpoint/cable projects differ.
- [x] Keep cross-project relation as warning-first, not hard-block, unless business rule later requires blocking.

Checker:

- [x] Project detail can show linked ODC, ODP, and CABLE rows without raw UUID.
- [x] ODC/ODP/CABLE detail shows active project label/link from `devices.project_id`.
- [x] No new project relation table is introduced.
- [x] Legacy assets with empty `project_id` remain visible and auditable.
- [x] Project scope can be filtered by region/POP without bypassing role guard.

---

## 6. Frontend Web Plan

### Phase 0 - ODC Create Form Alignment

Todo:

- [x] Ensure create form ODC exposes `Capacity Core` and `Used Core`.
- [x] Ensure create form ODC exposes `Total Port Cabinet` and `Port Terpakai`.
- [x] Ensure create form ODC exposes `Splitter Profile`.
- [x] Ensure create payload sends ODC `total_ports`, `used_ports`, and `splitter_ratio`.
- [x] Keep OTB -> ODC and ODC -> ODP relation creation outside create-device form; relation is created after the device exists through Topology Management.

Checker:

- [x] ODC create form and ODC detail technical fields use matching labels.
- [x] ODC create form does not imply live/NMS monitoring fields.
- [x] ODC relation buttons remain on detail/topology flow, not on initial create form.

### Phase 0.5 - Project Detail Asset Rollup

Todo:

- [x] Add `Project Assets` section on project detail.
- [x] Show linked ODC, ODP, CABLE, OTB, and JC from `devices.project_id`.
- [x] Show asset counts by type and operational/validation status.
- [x] Show cable/core capacity summary for project cables.
- [x] Show project route/as-built document links from existing project/resource fields.
- [x] Show warning if project has no linked passive assets.
- [x] Keep attachments/documents on project detail as project evidence hub.

Checker:

- [x] Project detail user can find all ODC/ODP/CABLE assets for the project without opening each device list manually.
- [x] Asset rows show readable inventory id/name/type/status, not raw UUID.
- [x] Project detail links back to device detail and topology trace where available.
- [x] Region-scoped users only see project assets inside allowed region scope.

### Phase 1 - ODC Detail Section

Todo:

- [x] Add ODC technical section component.
- [x] Show cabinet, port, splitter, core, upstream OTB, and downstream ODP summary.
- [x] Show relation-ready labels from topology summary.
- [x] Add action: `Create Feeder Relation` from ODC detail.
- [x] Add action: `Create ODP Relation` from ODC detail.

Checker:

- [x] ODC detail does not show ODP-only labels.
- [x] Upstream OTB relation list shows names, ports, route, cable, and core range.
- [x] Downstream ODP relation list shows names, ports, route, cable, and core range.
- [x] Empty state explains how to create relation.

### Phase 2 - ODC Relation Wizard

Todo:

- [x] Support feeder mode: OTB/POP -> ODC.
- [x] Support distribution mode: ODC -> ODP.
- [x] Prefill from device = current ODC.
- [x] Filter from ports to ODC available output/distribution ports when possible.
- [x] Filter to device candidates to ODP in same region/POP/project context.
- [x] Filter to ports to available ODP input/upstream ports when possible.
- [x] Allow route/cable/core selection.
- [x] Reuse Topology Management create/update API.

Checker:

- [x] Create relation from ODC detail opens topology form with current ODC prefilled.
- [x] User can complete OTB -> ODC feeder relation without manually copying UUID.
- [x] User can complete ODC -> ODP relation without manually copying UUID.
- [x] Validation errors are shown before submit.

### Phase 3 - Approval Review

Todo:

- [ ] Improve topology connection review for OTB -> ODC and ODC -> ODP relations.
- [ ] Show from/to device labels, ports, route, cable, and core range.
- [ ] Show fiber core conflict warnings if backend returns them.

Checker:

- [ ] Approval page does not show raw UUID for relation context.
- [ ] Superadmin can understand ODC -> ODP change before approval.

---

## 7. Syntrix-One Plan

### Phase 1 - ODC Form v2

Todo:

- [ ] Replace generic ODC v1 with ODC-specific form sections.
- [ ] Add cabinet condition fields.
- [ ] Add feeder/distribution port fields.
- [ ] Add tray/splice/core fields.
- [ ] Add required ODC evidence photos.
- [ ] Add review summary before submit.

Checker:

- [ ] QR ODC opens ODC-specific form.
- [ ] ODC form does not show CABLE/ONT/ODP-specific copy.
- [ ] Payload includes `field_validation_type = ODC`.

### Phase 2 - Read-Only ODC Relation Summary

Todo:

- [ ] Show upstream OTB/source status.
- [ ] Show downstream ODP count.
- [ ] Show connected ODP list.
- [ ] Show route/cable/core labels.
- [ ] Show warning if no relation exists.

Checker:

- [ ] Validator can see whether ODC already has feeder/upstream relation.
- [ ] Validator can see whether ODC already has ODP downstream relation.
- [ ] Mobile detail does not expose mutation buttons to validator.

---

## 8. UAT Scenarios

### 8.1 ODC Validation

- [ ] Validator scans ODC QR.
- [ ] ODC detail opens with ODC technical summary.
- [ ] Validator fills cabinet, port, tray/core, and evidence sections.
- [ ] Adminregion reviews request.
- [ ] Superadmin approves request.
- [ ] ODC detail updates approved fields/history/gallery.

### 8.2 OTB -> ODC Feeder Relation

- [ ] Adminregion opens OTB or ODC detail.
- [ ] Clicks `Create Feeder Relation`.
- [ ] Selects OTB feeder/output port.
- [ ] Selects ODC feeder/input port.
- [ ] Selects feeder route/cable/core range.
- [ ] Submits relation for approval.
- [ ] Superadmin approves.
- [ ] ODC detail shows upstream OTB/source relation.
- [ ] Topology trace from ODC reaches OTB/POP.

### 8.3 ODC -> ODP Distribution Relation

- [ ] Adminregion opens ODC detail.
- [ ] Clicks `Create ODP Relation`.
- [ ] Selects ODC output port.
- [ ] Selects ODP target and ODP input port.
- [ ] Selects route/cable/core range.
- [ ] Submits relation for approval.
- [ ] Superadmin approves.
- [ ] ODC detail shows ODP downstream relation.
- [ ] ODP detail shows upstream ODC relation.
- [ ] Topology trace from ODC reaches ODP.
- [ ] Topology trace from ODP reaches ODC/upstream.

### 8.4 Full Chain Trace

- [ ] Trace from OTB reaches ODC.
- [ ] Trace from ODC reaches OTB and ODP.
- [ ] Trace from ODP reaches ODC and OTB/POP.
- [ ] No broken edge appears in Trace Topology.
- [ ] ODC readiness increases after feeder and distribution relations are approved.

### 8.5 Negative Cases

- [ ] Cannot connect ODC to ODP outside allowed region.
- [ ] Cannot use already connected active port.
- [ ] Cannot use overlapping active core range.
- [ ] Cannot assign non-CABLE device as `cable_device_id`.
- [ ] Validator cannot create/edit ODC -> ODP relation.

---

## 9. Open Decisions

1. ODC port role convention:
   - use `port_type`;
   - use `splitter_role`;
   - or add a clearer enum for feeder/distribution/input/output.

2. ODP upstream port convention:
   - reserve port index `1`;
   - use `splitter_role = input`;
   - or add explicit port role.

3. ODC tray/splice model:
   - keep in `technical_validation` only;
   - map to `core_management`;
   - or add normalized splice/tray table later.

4. Relation mutation entry point:
   - only Topology Management;
   - or also ODC detail wizard with prefilled topology form.

5. OTB/POP representation:
   - represent OTB as device type OTB if available;
   - represent OTB as a POP-side device if OTB catalog does not exist yet;
   - or use existing POP-linked device with `device_type_key` agreed by master data.

Recommendation awal:

- Start with ODC detail action that opens Topology Management with prefilled ODC context.
- Use existing `device_ports`, `port_connections`, `fiber_cores`, and `core_management`.
- Model feeder and distribution as separate `port_connections` so Trace Topology can traverse both edges.
- Do not add new tables until ODC UAT proves the missing fields cannot fit in current model.

---

## 10. Definition of Done

ODC workflow dianggap matang jika:

- ODC validation form has cabinet, port, tray/core, and evidence sections.
- ODC validation payload is type-aware and approval-safe.
- ODC detail shows upstream OTB/source relation without raw UUID.
- ODC detail shows downstream ODP relation without raw UUID.
- OTB -> ODC feeder relation can be created through approved topology workflow.
- ODC -> ODP relation can be created through approved topology workflow.
- ODP detail shows upstream ODC relation after approval.
- Trace Topology can traverse OTB -> ODC -> ODP without broken edges.
- Fiber core status syncs with active/planned relation.
- Project detail can roll up ODC, ODP, and CABLE assets via `devices.project_id`.
- Project-linked assets show readable project labels/links in device detail.
- Validator can validate ODC but cannot mutate topology.
- Adminregion relation mutation requires superadmin approval.
- Superadmin can approve/reject with clear relation context.

---

## 11. Implementation Preparation

### 11.1 Working Assumptions

- Syntrix tetap inventory-driven, bukan NMS/live monitoring.
- Tidak membuat endpoint baru pada tahap awal.
- OTB -> ODC dan ODC -> ODP direpresentasikan sebagai dua edge `port_connections` terpisah.
- Route/cable/core relation memakai field existing: `route_id`, `cable_device_id`, `core_start`, `core_end`, dan `fiber_count`.
- ODC/ODP/CABLE/OTB/JC project ownership memakai field existing `devices.project_id`.
- Project asset rollup dibangun dari resource existing sebelum menambah endpoint khusus.
- ODC detail, Topology Management, approval request, dan Syntrix-One harus membaca source of truth yang sama.
- Jika `device_type_key = OTB` belum ada, OTB dapat dimodelkan sementara sebagai POP-side device dengan type key yang sudah disepakati master data.

### 11.2 First Implementation Slice

Prioritas pertama bukan membuat form besar sekaligus. Prioritas pertama adalah membuat rantai topology bisa dibaca jelas dari data existing.

Slice 1 target:

- Backend enrich `/topology/devices/:id/summary` untuk ODC:
  - upstream edges: OTB/POP -> ODC;
  - downstream edges: ODC -> ODP;
  - labels for endpoint, route, cable, and core range;
  - readiness flags for feeder and distribution relation.
- Frontend ODC detail:
  - show upstream feeder relation summary;
  - show downstream ODP relation summary;
  - show empty state if feeder/distribution relation is missing;
  - keep `Create Connection` routing to existing Topology Management.
- No Syntrix-One form change yet, except read-only relation summary if the backend response is ready.

Why this slice first:

- It proves whether existing `port_connections` and trace endpoints are enough.
- It gives immediate visibility for ODC `TEST-ODC-001`.
- It avoids overbuilding ODC validation form before relation data shape is proven.

### 11.3 Backend File Targets

Expected files:

- `src/modules/resource/resource.routes.js`
  - extend existing `/topology/devices/:id/summary`;
  - reuse `enrichPortConnections`;
  - add ODC-oriented summary grouping if needed;
  - optionally enrich project detail/read model with asset rollup from `devices.project_id`;
  - do not add new route unless documented blocker appears.
- `src/modules/device/connectivity.validation.js`
  - only if existing relation validation needs extra OTB/ODC/ODP port role checks.
- `src/modules/device/fiber-core-policy.service.js`
  - only if feeder/distribution core range policy needs an extra guard.
- `src/modules/validation/validation.service.js`
  - only if ODC validation payload apply whitelist needs new ODC fields.
- `src/modules/resource/resource.registry.js`
  - only if fields already exist in DB but are not exposed by resource config.
- `src/shared/resource.service.js`
  - only if project list/detail needs readable project asset labels from existing joins.

Backend verification:

- `npm run test:generic-validation-payload`
- `node --check src/modules/resource/resource.routes.js`
- `node --check src/modules/validation/validation.service.js` if touched
- `git diff --check`

### 11.4 Frontend Web File Targets

Expected files:

- `../syntrix_frontend/app/(app)/data-management/list/[slug]/[id]/page.tsx`
  - keep existing topology summary fetch;
  - pass ODC-specific relation summary into ODC section.
  - add project detail asset rollup if project detail remains generic.
- `../syntrix_frontend/components/features/data-management/device-detail/device-technical-summary-section.tsx`
  - extend ODC metrics with upstream/downstream status.
- `../syntrix_frontend/app/(app)/data-management/create/page.tsx`
  - keep ODC create form aligned with ODC detail technical fields.
- `../syntrix_frontend/components/features/data-management/device-detail/*`
  - add a project asset rollup section only if the page composer becomes too crowded.
- `../syntrix_frontend/components/features/data-management/device-form/device-capacity-fields.tsx`
  - expose ODC cabinet port labels and splitter profile.
- Optional new component:
  - `../syntrix_frontend/components/features/data-management/device-detail/odc-relation-summary-section.tsx`
  - use this only if the detail page becomes too crowded.
- `../syntrix_frontend/app/(app)/data-management/topology/page.tsx`
  - only if query params need better prefill for feeder/distribution relation.

Frontend verification:

- `npm run lint`
- `npm run build`
- `git diff --check`

### 11.5 Syntrix-One File Targets

Expected files:

- `../syntrix_app/src/components/odp-detail-view.tsx`
  - display read-only ODC relation summary when device type is ODC.
- `../syntrix_app/src/components/validation-form.tsx`
  - later phase: replace generic ODC v1 with ODC form v2.
- `../syntrix_app/src/services/api.ts`
  - only if API response typing needs generic topology summary fields.

Syntrix-One verification:

- `npm run lint`
- `npm run build`

### 11.6 Data Checks Before Coding

Run read-only checks against database/API before implementing relation rules:

- Confirm ODC `TEST-ODC-001` has `device_type_key = ODC`.
- Confirm ODP `BGR 02 SP 09 - 02` has available upstream/input port or generated `device_ports`.
- Confirm candidate OTB/POP-side device exists in POP Kandanghaur.
- Confirm ODC has generated 24 ports and their statuses are actually idle.
- Confirm cable feeder/distribution device exists or decide whether relation can be planned without cable.
- Confirm `fiber_cores` exist for feeder/distribution cable if core range will be assigned.
- Confirm ODC, ODP, and CABLE rows already have or can receive `devices.project_id`.
- Confirm project detail can fetch linked devices with `project_id` filter through existing resource endpoint.
- Confirm current `/topology/devices/:id/summary` response for ODC includes existing connections if any.
- Confirm `/topology/trace` can accept ODC/ODP device id and returns current incomplete path clearly.

### 11.7 Suggested Implementation Order

1. Backend ODC summary enrichment.
   - Verify: direct API call for ODC summary returns upstream/downstream buckets.
2. Frontend ODC detail summary.
   - Verify: ODC detail shows feeder missing/distribution missing states without UUID.
3. Topology Management prefill.
   - Verify: `Create Feeder Relation` and `Create ODP Relation` open existing topology form with current ODC context.
4. Project Asset Rollup.
   - Verify: project detail shows linked ODC, ODP, and CABLE assets from `devices.project_id`.
5. Relation validation hardening.
   - Verify: invalid same-device, overlapping core range, and non-CABLE `cable_device_id` are rejected.
6. Syntrix-One read-only relation summary.
   - Verify: validator sees ODC feeder/distribution status but no mutation action.
7. ODC form v2.
   - Verify: ODC-specific payload includes cabinet, port, tray/core, and evidence sections.

### 11.8 Stop Conditions

Pause and update the plan before coding further if:

- OTB has no representable device type or POP-side device row.
- ODC/ODP port role cannot be inferred from existing fields.
- Project asset rollup cannot be represented with `devices.project_id` and existing resource filters.
- Existing `/portConnections` flow cannot represent feeder/distribution without ambiguous semantics.
- Existing `/topology/devices/:id/summary` becomes too heavy or incompatible after enrichment.
- Required fields are missing from DB schema and cannot fit safely into `specifications` or `custom_fields`.
