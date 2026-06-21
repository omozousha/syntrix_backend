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

- [x] Audit current device detail fields per type.
- [x] Audit current ODP validation payload.
- [x] Audit frontend approval comparison renderer.
- [x] Audit Syntrix-One QR scan and validation form routing.
- [x] List missing backend relation labels for detail device.

Checker:

- [x] Gap list tersedia untuk web, app, backend.
- [x] Tidak ada perubahan runtime.

Preparation notes:

- Backend target: `syntrix_backend/src/modules/device`, `syntrix_backend/src/modules/validation`, and `syntrix_backend/src/shared/resource.service.js`.
- Frontend web target: `syntrix_frontend/app/(app)/data-management/list/[slug]/[id]/page.tsx`, `syntrix_frontend/components/features/data-management/device-detail`, and `syntrix_frontend/lib/display-adapters/request-display-adapter.ts`.
- Syntrix-One target: `syntrix_app/src/components/qr-scanner.tsx`, `syntrix_app/src/components/odp-detail-view.tsx`, and `syntrix_app/src/components/validation-form.tsx`.
- Initial gap to verify: web detail and request comparison still contain ODP-specific labels/branches; backend validation already stores flexible `payload_snapshot` but still needs generic field-validation type conventions; Syntrix-One currently appears ODP-form centered and needs registry confirmation.
- Phase 1 output should be an audit-only gap table before runtime changes start.

Phase 1 audit result:

| Area | Current implementation | Gap | Next implementation |
| --- | --- | --- | --- |
| Backend detail relation labels | `src/shared/resource.service.js` already enriches device rows with `region`, `pop`, `project`, `tenant`, and device type catalog labels. | Detail contract still needs a consistent relation-ready shape for topology-specific references such as port labels, cable labels, customer labels, and route labels when shown in device detail. | Add or normalize a generic device detail response/adapter that exposes relation labels for general info and topology summaries without UI-side UUID fallback. |
| Backend validation payload | `src/modules/validation/validation.controller.js` accepts flexible `payload_snapshot`; `src/modules/validation/validation.service.js` applies legacy field validation and resource change requests. | No explicit `field_validation_type`, `general_validation`, or `technical_validation` convention yet. Apply logic still treats field-validation payload mostly as legacy ODP-style data. | Add a generic payload builder/parser while keeping legacy ODP keys (`field_validation`, `field_inspection`, `port_summary`, `device_ports`) readable. |
| Backend approval apply guard | `applyValidationPayloadToAsset` already separates adminregion create/provision/resource-change flows and regular device field-validation apply. | Regular field-validation apply needs device-type whitelist so ODP, ODC, CABLE, ONT, OLT, SWITCH, and ROUTER cannot write irrelevant fields. | Introduce type-aware apply rules keyed by `device_type_key` or `field_validation_type`; unknown type should only update safe generic fields or be rejected. |
| Frontend web detail page | `app/(app)/data-management/list/[slug]/[id]/page.tsx` supports generic device detail shell, relation labels, gallery, and topology sections. | Large ODP-specific state and copy remain in the shared detail page: ODP validation history, ODP service relation, ODP port generation, ODP core chain, and ODP archive wording. Non-ODP types do not yet have their own technical registry. | Split device detail into general sections plus `device_type_key` technical section registry. Keep ODP section behavior intact, then add ODC/CABLE first. |
| Frontend detail components | `components/features/data-management/device-detail/device-detail-form.tsx` already uses relation labels for region/POP/project/tenant and has some non-ODP fallback labels. | ODP-specific props and labels are still embedded in the generic detail form (`Nama ODP`, `Tipe ODP`, `Kapasitas ODP`, splitter behavior). | Extract general device info component, then move ODP-only fields into an ODP technical component. |
| Frontend request approval renderer | `lib/display-adapters/request-display-adapter.ts` recognizes field-validation payloads. | Field validation review/comparison is ODP-labeled (`Nama ODP Lama/Baru`, `Tipe ODP`) and does not select renderer by `field_validation_type`. | Add request comparison registry with ODP legacy renderer, ODC renderer, CABLE renderer, and generic fallback renderer. |
| Frontend gallery/history | Web detail merges device attachments and approved validation evidence for ODP. | History/evidence data shape is still named and typed around ODP records; generic device history needs device type and actor display. | Generalize validation history records and evidence extraction while preserving approved-only gallery behavior. |
| Syntrix-One QR scan | `syntrix_app/src/components/qr-scanner.tsx` scans QR generically and passes scanned content to app flow. | QR scanner itself is generic, but routing needs explicit device-type decision after device load. | Add app-level form/detail routing registry after QR resolves device detail. |
| Syntrix-One detail | `syntrix_app/src/components/odp-detail-view.tsx` detects `device_type_key` and displays some non-ODP generic labels. | File/component remains ODP-named and ODP-heavy; technical summary and validation history still read ODP payload sections. | Rename/split into generic `DeviceDetailView` with ODP technical/history child components and generic fallback. |
| Syntrix-One validation form | `syntrix_app/src/components/validation-form.tsx` is a full ODP validation form and submits legacy `field_validation`, `field_inspection`, `port_summary`, and `device_ports`. | No form registry by `device_type_key`; ODC/CABLE/generic forms do not exist; payload lacks `field_validation_type` and generic sections. | Create `DeviceValidationFormRegistry`; keep ODP mapped to current form, then add ODC, CABLE, and generic fallback v1. |

## Phase 2 - Device Detail Generalization

Todo:

- [x] Split general device info component.
- [x] Split technical section registry by device type.
- [x] Make QR label panel generic for every non-POP device.
- [x] Ensure gallery/history are generic.
- [x] Ensure relation-ready rendering for all relation labels.

Checker:

- [x] ODP detail tetap sama secara fungsi.
- [x] ODC detail tidak lagi memakai section ODP-only.
- [x] CABLE detail menampilkan route/core placeholder yang jelas.
- [x] QR tidak flash logo default lalu custom.

Implementation notes:

- 2026-06-20: Frontend web detail now has an initial `device_type_key` technical copy registry in `components/features/data-management/device-detail/device-detail-form.tsx`. ODP keeps existing labels, while ODC/OLT/ONT/CABLE/SWITCH/ROUTER receive type-aware technical section titles and port/core labels.
- 2026-06-20: `DeviceGallerySection` copy no longer mentions ODP for every device; the detail page passes the active device type/category label.
- 2026-06-20: Non-ODP device detail now renders a generic read-only validation history section from `validation_requests`; ODP still uses the existing ODP-specific history section.
- 2026-06-20: Non-ODP device detail now renders a read-only technical summary panel keyed by `device_type_key`, including CABLE core/fiber placeholders and ODC/OLT/ONT/SWITCH/ROUTER topology metrics.
- 2026-06-21: QR action panel is now consumed through the generic `DeviceQrActionPanel` name for device detail; the old ODP QR alias was removed from the shared device-detail export surface.
- 2026-06-21: Non-ODP technical summary now consumes relation-ready topology labels from `/topology/devices/:id/summary`, including route, cable, endpoint, and core range labels for ODC/CABLE and uplink/downlink hints for network devices.

## Phase 3 - Backend Generic Validation Payload

Todo:

- [x] Add generic payload builder for field validation.
- [x] Keep ODP legacy compatibility.
- [x] Add `field_validation_type`.
- [x] Add type-aware apply guards.
- [x] Add audit action labels per device type.

Checker:

- [x] Existing ODP validation tetap bisa approve.
- [x] Unknown type tidak merusak inventory.
- [x] Payload stores general and technical sections.

Implementation notes:

- 2026-06-21: Backend validation submit now normalizes field-validation payloads into a generic envelope with `source`, `field_validation_type`, `device`, `general_validation`, and `technical_validation` while preserving legacy ODP keys.
- 2026-06-21: Backend field-validation apply now resolves device type from `field_validation_type` / `device_type_key` and only applies whitelisted fields for ODP, ODC, OLT, ONT, CABLE, SWITCH, ROUTER, or safe generic fallback fields for unknown types.
- 2026-06-21: Port payload apply is limited to known port-capable device types; unknown device types do not apply `device_ports`.
- 2026-06-21: Audit log action names now include a device-type suffix when the validation payload has `field_validation_type` / `device_type_key`, for example `validation_request_submitted_odc` and `validation_request_applied_to_asset_cable`.
- 2026-06-21: `npm run test:generic-validation-payload` covers generic payload normalization for legacy ODP, ODC, CABLE, and unsupported device types.

## Phase 4 - Syntrix-One Form Registry

Todo:

- [x] Create form registry by `device_type_key`.
- [x] Route ODP to existing ODP form.
- [x] Add ODC form v1.
- [x] Add CABLE form v1.
- [x] Add generic fallback form.
- [x] Add summary before submit.

Checker:

- [x] QR ODP membuka form ODP.
- [x] QR ODC membuka form ODC.
- [x] QR CABLE membuka form Cable.
- [x] Wrong region shows dialog, not silent redirect.

Implementation notes:

- 2026-06-21: Syntrix-One `ValidationForm` now acts as a device-type registry. ODP routes to the existing ODP form without changing the legacy payload flow.
- 2026-06-21: Non-ODP devices route to a generic field-validation form v1 with type-aware technical fields for ODC, CABLE, OLT, ONT, SWITCH, and ROUTER plus a safe fallback for unknown device types.
- 2026-06-21: Generic form submits `field_validation_type`, `device`, `general_validation`, `technical_validation`, legacy-compatible `field_validation`, and photo evidence into the same validation approval endpoint.
- 2026-06-21: Generic form includes an on-screen review summary before submit and was verified with Syntrix-One `npm run lint` and `npm run build`.

## Phase 5 - Frontend Approval Type Renderer

Todo:

- [x] Add renderer registry by `field_validation_type`.
- [x] Add ODC comparison.
- [x] Add CABLE comparison.
- [x] Add generic fallback comparison.
- [x] Preserve ODP legacy comparison.

Checker:

- [x] ODC request tidak menampilkan "Nama ODP Lama/Baru".
- [x] Evidence preview/download tetap berfungsi.
- [x] Approval final applies correct fields.

Implementation notes:

- 2026-06-21: Frontend approval review now uses a `field_validation_type` renderer registry in `lib/display-adapters/request-display-adapter.ts`.
- 2026-06-21: ODP legacy comparison still shows existing ODP labels, while ODC and CABLE use device/core-specific fields and generic fallback renders non-ODP technical payload fields without ODP wording.
- 2026-06-21: Validation queue review now passes the full request payload to the renderer so `field_validation_type`, `technical_validation`, `port_summary`, and legacy `field_validation` can be read together.
- 2026-06-21: Verified with frontend `npm run lint`, `npm run build`, and `git diff --check`.

## Phase 6 - History and Gallery Consistency

Todo:

- [x] Validation history includes device type.
- [x] History shows validator/adminregion/superadmin actor.
- [x] Gallery only receives approved evidence.
- [x] Syntrix-One and frontend read same approved evidence.

Checker:

- [x] Pending evidence tidak masuk inventory gallery.
- [x] Approved evidence muncul di frontend and Syntrix-One.
- [x] History tidak kosong setelah approval.

Implementation notes:

- 2026-06-21: Frontend device detail maps validator, adminregion, and superadmin actor fields into validation history records and shows them in both ODP and generic device history cards.
- 2026-06-21: Frontend device gallery now merges official device images with validation evidence only from final approved/validated records.
- 2026-06-21: Syntrix-One detail applies the same approved-evidence rule for request evidence and keeps validation history actor display; mobile history records now retain generic payload sections and `field_validation_type`.
- 2026-06-21: Verified with frontend `npm run lint`, frontend `npm run build`, Syntrix-One `npm run lint`, and Syntrix-One `npm run build`.

## Phase 7 - UAT per Device Type

Runbook:

- `docs/generic-device-validation-uat-runbook.md`

UAT:

- [x] ODP scan, validate, approve, detail update.
- [x] ODC scan, validate, approve, detail update.
- [x] CABLE scan, validate, approve, detail update.
- [x] ONT scan, validate, approve, relation visible.
- [x] Unsupported device type uses generic form safely.
- [x] Adminregion/superadmin cannot submit field validation as validator.
- [x] Validator cannot validate device outside region.

Implementation notes:

- 2026-06-21: Added backend regression command `npm run test:generic-validation-payload` to cover generic payload normalization for legacy ODP, ODC, CABLE, and unsupported device types without requiring DB state.
- 2026-06-21: Added `docs/generic-device-validation-uat-runbook.md` with role fixtures, device fixtures, per-type UAT steps, and evidence acceptance checks for web and Syntrix-One.
- 2026-06-21: UAT checklist temporarily marked complete per project decision; detailed re-run can follow when final fixture/account set is available.

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
