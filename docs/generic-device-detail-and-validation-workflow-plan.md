# Generic Device Detail and Validation Workflow Plan

Dokumen ini adalah companion plan untuk `network-inventory-relation-development-plan.md`.

Network Inventory Relation Development Plan menetapkan source of truth topology: `devices`, `device_ports`, `port_connections`, route, cable, core, project, dan maps. Dokumen ini menetapkan bagaimana detail device dan form validasi harus membaca source of truth tersebut secara konsisten untuk semua device type.

Tujuan utama: QR device sudah generic, maka halaman detail, form validasi Syntrix-One, approval comparison, gallery, history, dan apply-to-inventory juga harus generic dan device-type-aware.

---

## 1. Prinsip Produk

### 1.1 General + Technical Detail

Setiap device detail harus dibagi menjadi dua lapisan:

1. General Device Information
2. Device-Specific Technical Information

General information wajib konsisten untuk semua device:

- device name;
- inventory ID;
- device type;
- region;
- POP;
- project;
- tenant;
- status;
- validation status;
- installation date jika tersedia;
- address;
- longitude/latitude;
- QR label;
- gallery;
- validation history;
- audit/request summary.

Technical information berubah berdasarkan `device_type_key`.

Tujuan:

- halaman detail tidak lagi terasa seperti ODP-only;
- admin bisa memahami device apa pun dari struktur yang sama;
- Syntrix-One bisa memakai pola section yang sama saat validasi lapangan.

### 1.2 Device-Type-Aware Validation

Form validasi tidak boleh hardcoded ODP untuk semua QR.

Saat QR discan, app harus:

1. load device detail;
2. cek `device_type_key`;
3. pilih schema form sesuai tipe device;
4. tetap menjalankan role/region guard;
5. submit payload ke workflow approval yang sama.

Semua hasil validasi tetap masuk `validation_requests`.

### 1.3 Approval-Safe Mutation

Hasil validasi dari validator tidak boleh langsung mengubah inventory final.

Alur tetap:

```text
Validator submit validation
  -> Adminregion review
  -> Superadmin final approval
  -> Apply to inventory final
```

Data final di `devices`, `device_ports`, `port_connections`, `fiber_cores`, route/core relation, gallery, dan history hanya berubah setelah final approval sesuai policy.

### 1.4 Relation-Ready Rendering

Backend response untuk frontend dan Syntrix-One harus membawa label relasi siap tampil.

Detail device tidak boleh menampilkan UUID sementara seperti:

- `region_id`;
- `pop_id`;
- `project_id`;
- `tenant_id`;
- `customer_id`;
- `from_port_id`;
- `to_port_id`;
- `cable_device_id`.

UI harus mendapat object atau label:

- `region.region_name`;
- `pop.pop_name`;
- `project.project_name`;
- `tenant.tenant_name`;
- `customer.customer_name` / `customer_number`;
- `port.port_label`;
- `device.device_name`;
- `route.route_name`;
- `cable.device_name`.

### 1.5 Same Data Logic Across Web and Syntrix-One

Jika frontend bisa menampilkan sebuah data secara logis, Syntrix-One juga harus bisa menampilkan versi yang sesuai role dan kebutuhan lapangan.

Contoh:

- Web detail ODC punya route/core/connection summary.
- Syntrix-One detail ODC minimal punya summary yang sama secara read-only.
- Web approval menampilkan before/after.
- Syntrix-One history menampilkan actor, tanggal, dan hasil validasi yang relevan.

---

## 2. Hubungan Dengan Network Inventory Relation Development Plan

Dokumen ini bergantung pada keputusan berikut dari Network Inventory Relation Development Plan:

- `devices` adalah master asset untuk semua device.
- QR dynamic berlaku untuk semua device non-POP.
- `project_id` menjadi main relation device.
- `device_ports` adalah source of truth port.
- `port_connections` adalah source of truth koneksi port-to-port.
- `network_routes` adalah jalur/path/topology.
- `devices.device_type_key = 'CABLE'` adalah asset fisik kabel.
- Route dan Cable tidak disatukan.
- As-Built Documents adalah output dari topology approved.
- Maps/GIS dikerjakan setelah relasi stabil.

Implikasi untuk dokumen ini:

- detail device harus menampilkan QR dan project context;
- detail cable harus menampilkan route/core relation;
- detail route boleh menampilkan cable devices terkait, tetapi route bukan device;
- validasi device harus bisa memperbarui data teknis sesuai device type setelah approval;
- approval comparison harus memahami field teknis per device type.

---

## 3. Device Detail Target

### 3.1 Layout Standar Web

Setiap detail device di `syntrix_frontend` memakai struktur:

1. Header:
   - device name;
   - inventory ID;
   - type badge;
   - validation status;
   - action buttons sesuai role.

2. General Information:
   - identity;
   - location;
   - relation context;
   - operational status.

3. Technical Information:
   - section khusus sesuai device type.

4. QR Label:
   - generic QR label;
   - download label;
   - reminder hanya jika device type dan role mendukung.

5. Gallery:
   - create attachment approved;
   - validation evidence approved;
   - tetap tidak menampilkan evidence pending sebelum approval final.

6. History:
   - validation history;
   - actor validator;
   - actor adminregion;
   - actor superadmin jika ada final decision.

7. Topology Summary:
   - upstream/downstream;
   - port/core/route relation;
   - read-only jika mutation belum masuk scope.

### 3.2 Layout Standar Syntrix-One

Setiap detail device di app memakai struktur:

1. Device identity card.
2. Scope/location card.
3. Technical summary card.
4. QR/action context if needed.
5. Mini gallery.
6. Validation history.
7. Related topology summary.

Role behavior:

- Validator: read detail, validate device sesuai region, lihat history submission miliknya.
- Adminregion: tidak memakai form validasi lapangan, tetapi bisa melihat data sesuai region jika fitur mobile admin ada.
- Superadmin: read-only mobile support jika dibutuhkan, bukan field validation actor.

---

## 4. Device-Type Technical Matrix

### 4.1 ODP

Technical detail:

- ODP type;
- installation type;
- splitter ratio/profile;
- total ports;
- used/reserved/idle/down ports;
- upstream ODC/OLT summary;
- distribution cable/core;
- customer/ONT assignment summary.

Validation form:

- old ODP name;
- optional new ODP name;
- POP;
- coordinate;
- status;
- ODP type;
- installation type;
- splitter;
- port condition;
- redaman optional;
- checklist condition;
- evidence photos.

Approval comparison:

- existing vs validator for ODP identity;
- port summary;
- evidence preview/download;
- core chain warning if incomplete.

### 4.2 ODC

Technical detail:

- cabinet/site info;
- feeder ports;
- distribution ports;
- splitter/tray info;
- upstream OLT/POP;
- downstream ODP count;
- cable/core relation;
- port occupancy.

Validation form:

- ODC name;
- coordinate;
- status;
- cabinet condition;
- feeder/distribution port count;
- tray/splitter condition;
- route/cable evidence;
- photos.

Approval comparison:

- identity/location;
- feeder/distribution summary;
- cable/core relation changes;
- evidence.

### 4.3 OLT

Technical detail:

- POP/site;
- rack/slot/card info;
- PON port count;
- uplink interface;
- downstream ODC/ODP summary;
- port occupancy.

Validation form:

- OLT name;
- POP/site confirmation;
- rack/slot/card;
- PON/uplink status;
- photos.

Approval comparison:

- device identity;
- rack/card/PON summary;
- uplink/downstream relation summary.

### 4.4 ONT

Technical detail:

- customer relation;
- customer number/CID;
- service type;
- serial number;
- ODP port relation;
- status;
- installed date.

Validation form:

- ONT name/serial;
- customer confirmation;
- ODP/port confirmation;
- service status;
- photos.

Approval comparison:

- customer/service relation;
- serial/status;
- port assignment.

### 4.5 CABLE

Technical detail:

- cable name;
- route relation;
- capacity core;
- used/reserved/available core;
- fiber core list;
- start/end relation;
- core range usage.

Validation form:

- cable identity;
- route confirmation;
- capacity core;
- core condition;
- splice/core range evidence;
- photos.

Approval comparison:

- route/cable relation;
- core capacity and usage;
- evidence.

### 4.6 SWITCH / ROUTER

Technical detail:

- site/POP;
- rack/location;
- interface count;
- uplink/downlink relation;
- status.

Validation form:

- device identity;
- interface/uplink status;
- location;
- photos.

Approval comparison:

- identity/location;
- port/interface summary;
- relation summary.

---

## 5. Backend Payload Contract

### 5.1 Generic Envelope

Semua field validation request menggunakan envelope:

```json
{
  "source": "field-validation-device",
  "field_validation_type": "ODC",
  "device": {
    "id": "...",
    "device_type_key": "ODC",
    "device_name": "...",
    "region_id": "...",
    "pop_id": "...",
    "project_id": "...",
    "tenant_id": "..."
  },
  "general_validation": {},
  "technical_validation": {},
  "field_inspection": {},
  "port_summary": {},
  "core_summary": {},
  "relation_summary": {}
}
```

### 5.2 Compatibility

ODP payload existing tetap didukung:

- `field_validation`;
- `field_inspection`;
- `port_summary`;
- `device_ports`.

Namun implementasi baru harus mulai menulis struktur generic:

- `general_validation`;
- `technical_validation`;
- `field_validation_type`.

ODP bisa dipetakan ke generic structure secara bertahap.

### 5.3 Apply Rules

Apply ke inventory final harus type-aware:

- ODP apply hanya field ODP approved.
- ODC apply hanya field ODC approved.
- CABLE apply dapat menyentuh route/core relation jika disetujui.
- ONT apply dapat menyentuh customer/port relation jika disetujui.

Field yang tidak relevan untuk device type harus diabaikan atau ditolak.

---

## 6. Frontend Approval Target

Halaman Requests harus:

- membaca `field_validation_type`;
- memilih comparison renderer sesuai type;
- menampilkan General Comparison;
- menampilkan Technical Comparison;
- menampilkan Evidence Checklist;
- menampilkan Relation/Topology Summary jika ada;
- tidak memakai label ODP untuk ODC/OLT/ONT/CABLE.

Fallback:

- jika `field_validation_type` kosong tetapi payload lama ODP ada, render sebagai ODP legacy.
- jika type belum punya renderer, tampilkan generic key/value review dengan warning "Device type renderer belum tersedia".

---

## 7. Syntrix-One Target

### 7.1 QR Scan Flow

```text
Scan QR
  -> load device
  -> verify role and region
  -> detect device_type_key
  -> open device detail
  -> user taps Validate
  -> open type-specific validation form
```

### 7.2 Form Registry

App perlu registry:

```text
ODP -> OdpValidationForm
ODC -> OdcValidationForm
OLT -> OltValidationForm
ONT -> OntValidationForm
CABLE -> CableValidationForm
SWITCH -> NetworkDeviceValidationForm
ROUTER -> NetworkDeviceValidationForm
default -> GenericDeviceValidationForm
```

### 7.3 Mobile UX

Form mobile harus:

- section-based;
- safe back/close confirmation;
- current location button jika device membutuhkan coordinate;
- evidence capture;
- validation summary before submit;
- loading dialog konsisten;
- error dialog spesifik jika region/type/data tidak valid.

---

## 8. Phased Implementation

## Phase 1 - Contract Audit

Todo:

- [ ] Audit current device detail fields per type.
- [ ] Audit current ODP validation payload.
- [ ] Audit frontend approval comparison renderer.
- [ ] Audit Syntrix-One QR scan and validation form routing.
- [ ] List missing backend relation labels for detail device.

Checker:

- [ ] Gap list tersedia untuk web, app, backend.
- [ ] Tidak ada perubahan runtime.

## Phase 2 - Device Detail Generalization

Todo:

- [ ] Split general device info component.
- [ ] Split technical section registry by device type.
- [ ] Make QR label panel generic for every non-POP device.
- [ ] Ensure gallery/history are generic.
- [ ] Ensure relation-ready rendering for all relation labels.

Checker:

- [ ] ODP detail tetap sama secara fungsi.
- [ ] ODC detail tidak lagi memakai section ODP-only.
- [ ] CABLE detail menampilkan route/core placeholder yang jelas.
- [ ] QR tidak flash logo default lalu custom.

## Phase 3 - Backend Generic Validation Payload

Todo:

- [ ] Add generic payload builder for field validation.
- [ ] Keep ODP legacy compatibility.
- [ ] Add `field_validation_type`.
- [ ] Add type-aware apply guards.
- [ ] Add audit action labels per device type.

Checker:

- [ ] Existing ODP validation tetap bisa approve.
- [ ] Unknown type tidak merusak inventory.
- [ ] Payload stores general and technical sections.

## Phase 4 - Syntrix-One Form Registry

Todo:

- [ ] Create form registry by `device_type_key`.
- [ ] Route ODP to existing ODP form.
- [ ] Add ODC form v1.
- [ ] Add CABLE form v1.
- [ ] Add generic fallback form.
- [ ] Add summary before submit.

Checker:

- [ ] QR ODP membuka form ODP.
- [ ] QR ODC membuka form ODC.
- [ ] QR CABLE membuka form Cable.
- [ ] Wrong region shows dialog, not silent redirect.

## Phase 5 - Frontend Approval Type Renderer

Todo:

- [ ] Add renderer registry by `field_validation_type`.
- [ ] Add ODC comparison.
- [ ] Add CABLE comparison.
- [ ] Add generic fallback comparison.
- [ ] Preserve ODP legacy comparison.

Checker:

- [ ] ODC request tidak menampilkan "Nama ODP Lama/Baru".
- [ ] Evidence preview/download tetap berfungsi.
- [ ] Approval final applies correct fields.

## Phase 6 - History and Gallery Consistency

Todo:

- [ ] Validation history includes device type.
- [ ] History shows validator/adminregion/superadmin actor.
- [ ] Gallery only receives approved evidence.
- [ ] Syntrix-One and frontend read same approved evidence.

Checker:

- [ ] Pending evidence tidak masuk inventory gallery.
- [ ] Approved evidence muncul di frontend and Syntrix-One.
- [ ] History tidak kosong setelah approval.

## Phase 7 - UAT per Device Type

UAT:

- [ ] ODP scan, validate, approve, detail update.
- [ ] ODC scan, validate, approve, detail update.
- [ ] CABLE scan, validate, approve, detail update.
- [ ] ONT scan, validate, approve, relation visible.
- [ ] Unsupported device type uses generic form safely.
- [ ] Adminregion/superadmin cannot submit field validation as validator.
- [ ] Validator cannot validate device outside region.

---

## 9. Risks

Risk: ODP behavior regresses.

Mitigation:

- keep ODP legacy payload support;
- add UAT ODP first;
- do not rename existing ODP fields until compatibility layer exists.

Risk: generic form becomes too weak.

Mitigation:

- use generic fallback only for unsupported device types;
- implement real ODC/CABLE forms before broad rollout.

Risk: approval apply writes wrong field to wrong device type.

Mitigation:

- backend type-aware whitelist;
- reject irrelevant field changes;
- keep before/after audit.

Risk: frontend and mobile show different truth.

Mitigation:

- both consume same backend relation-ready detail response;
- no client-side UUID label fallback for relation fields.

---

## 10. Definition of Done

Fitur dianggap matang jika:

- every non-POP device has QR and correct detail target;
- every supported device type has correct detail sections;
- Syntrix-One opens validation form based on `device_type_key`;
- approval comparison is type-aware;
- final approval applies only approved fields;
- gallery/history consistent between frontend and Syntrix-One;
- role/region guard works for every device type;
- no ODP wording leaks into ODC/CABLE/OLT/ONT validation UI;
- relation-ready rendering remains clean.
