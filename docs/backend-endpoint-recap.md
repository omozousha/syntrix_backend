# Rekap Endpoint Backend Syntrix

Dokumen ini merangkum endpoint backend Syntrix berdasarkan route yang terdaftar di kode saat ini.

Tanggal update: 24 Mei 2026

## Base URL

```text
Local      : http://localhost:3000
API Local  : http://localhost:3000/api/v1
Production : https://syntrix-backend.vercel.app/api/v1
```

Catatan:

- Sebagian besar endpoint `/api/v1/*` membutuhkan Bearer Token.
- Hak akses mengikuti role backend: `admin`, `user_region`, dan `user_all_region`.
- Endpoint resource CRUD dibuat dinamis dari `RESOURCE_CONFIG`.

## Public

| Method | Endpoint | Keterangan |
| --- | --- | --- |
| GET | `/` | Informasi service backend |
| GET | `/health` | Health check service |

## Auth

Base path: `/api/v1/auth`

| Method | Endpoint | Keterangan |
| --- | --- | --- |
| POST | `/login` | Login user |
| POST | `/bootstrap-admin` | Membuat admin pertama dengan bootstrap secret |
| POST | `/register` | Register user baru |
| GET | `/me` | Mengambil profil user aktif |
| PATCH | `/me` | Update profil user aktif |
| POST | `/logout` | Logout session |
| POST | `/refresh` | Refresh token/session |
| POST | `/change-password` | Ganti password user aktif |
| POST | `/reset-password` | Reset password |
| GET | `/avatar-orphans` | Audit avatar orphan, khusus admin |
| POST | `/avatar-orphans/cleanup` | Cleanup avatar orphan, khusus admin |

## Dashboard

Base path: `/api/v1/dashboard`

| Method | Endpoint | Keterangan |
| --- | --- | --- |
| GET | `/summary` | Ringkasan dashboard utama |
| GET | `/validation-progress` | Progress validasi per region untuk chart, mendukung query `month` dan `year` |

## Import

Base path: `/api/v1/imports`

| Method | Endpoint | Keterangan |
| --- | --- | --- |
| POST | `/ingest` | Import file `xlsx`, `xls`, `csv`, `kml`, atau `kmz`; mendukung preview/apply melalui body |

## User Inbox & Push Notification

Base path: `/api/v1/me`

| Method | Endpoint | Keterangan |
| --- | --- | --- |
| POST | `/push-tokens` | Register FCM token device user aktif |
| POST | `/push-tokens/revoke` | Revoke FCM token user aktif |
| DELETE | `/push-tokens/:token` | Revoke FCM token melalui path token |
| GET | `/notifications` | List inbox notifikasi user aktif, mendukung query `limit` |
| PATCH | `/notifications/read-all` | Tandai semua inbox user aktif sudah dibaca |
| POST | `/notifications/read-all` | Alias untuk tandai semua inbox user aktif sudah dibaca |
| PATCH | `/notifications/:id/read` | Tandai satu inbox user aktif sudah dibaca |
| POST | `/notifications/:id/read` | Alias untuk tandai satu inbox user aktif sudah dibaca |

## Validation Requests

Base path: `/api/v1/validation-requests`

| Method | Endpoint | Keterangan |
| --- | --- | --- |
| POST | `/` | Submit request validasi |
| GET | `/` | List request validasi |
| GET | `/quality-queue` | Queue validasi untuk quality review |
| GET | `/notifications` | List notifikasi request validasi |
| GET | `/notifications/digest` | Digest/ringkasan notifikasi validasi |
| POST | `/notifications/read-all` | Tandai semua notifikasi validasi sudah dibaca |
| POST | `/notifications/:id/read` | Tandai satu notifikasi validasi sudah dibaca |
| GET | `/metrics/reject-reasons` | Metrik alasan reject |
| GET | `/:id/history` | Histori request validasi |
| POST | `/:id/adminregion/approve` | Approve tahap admin region |
| POST | `/:id/adminregion/reject` | Reject tahap admin region |
| POST | `/:id/adminregion/resubmit` | Resubmit request yang ditolak admin region |
| POST | `/:id/superadmin/approve` | Approve tahap superadmin |
| POST | `/:id/superadmin/reject` | Reject tahap superadmin |

## Resource CRUD Dinamis

Base path: `/api/v1/{resource}`

Pola endpoint yang tersedia untuk setiap resource:

| Method | Endpoint | Keterangan |
| --- | --- | --- |
| GET | `/{resource}` | List data resource |
| GET | `/{resource}/:id` | Detail data resource |
| POST | `/{resource}` | Create data resource |
| PATCH | `/{resource}/:id` | Update data resource |
| DELETE | `/{resource}/:id` | Delete data resource |
| POST | `/{resource}/:id/restore` | Restore data, hanya resource yang mendukung soft delete |
| POST | `/{resource}/:id/purge` | Permanently delete data, hanya resource soft delete dan akses admin |

Daftar resource aktif:

| Resource | Table | Soft Delete | Read Role | Write Role |
| --- | --- | --- | --- | --- |
| `regions` | `regions` | Ya | admin, user_region, user_all_region | admin |
| `pops` | `pops` | Tidak | admin, user_region, user_all_region | admin, user_all_region |
| `projects` | `projects` | Tidak | admin, user_region, user_all_region | admin, user_all_region |
| `poles` | `poles` | Tidak | admin, user_region, user_all_region | admin, user_all_region |
| `customers` | `customers` | Tidak | admin, user_region, user_all_region | admin, user_all_region |
| `devices` | `devices` | Ya | admin, user_region, user_all_region | admin, user_all_region |
| `routes` | `network_routes` | Tidak | admin, user_region, user_all_region | admin, user_region, user_all_region |
| `deviceLinks` | `device_links` | Tidak | admin, user_region, user_all_region | admin, user_region, user_all_region |
| `devicePorts` | `device_ports` | Ya | admin, user_region, user_all_region | admin, user_region, user_all_region |
| `portConnections` | `port_connections` | Tidak | admin, user_region, user_all_region | admin, user_region, user_all_region |
| `devicePortTemplates` | `device_port_templates` | Tidak | admin, user_region, user_all_region | admin |
| `fiberCores` | `fiber_cores` | Tidak | admin, user_region, user_all_region | admin, user_region, user_all_region |
| `splitterProfiles` | `splitter_profiles` | Tidak | admin, user_region, user_all_region | admin |
| `coreColorProfiles` | `core_color_profiles` | Tidak | admin, user_region, user_all_region | admin |
| `coreColorMap` | `core_color_map` | Tidak | admin, user_region, user_all_region | admin |
| `coreManagement` | `core_management` | Tidak | admin, user_region, user_all_region | admin, user_region, user_all_region |
| `manufacturers` | `manufacturers` | Ya | admin, user_region, user_all_region | admin |
| `brands` | `brands` | Ya | admin, user_region, user_all_region | admin |
| `assetTypes` | `asset_types` | Tidak | admin, user_region, user_all_region | admin |
| `assetModels` | `asset_models` | Ya | admin, user_region, user_all_region | admin |
| `deviceTypes` | `device_type_catalog` | Ya | admin, user_region, user_all_region | admin |
| `popTypes` | `pop_types` | Ya | admin, user_region, user_all_region | admin |
| `routeTypes` | `route_types` | Ya | admin, user_region, user_all_region | admin |
| `odpTypes` | `odp_types` | Ya | admin, user_region, user_all_region | admin |
| `installationTypes` | `installation_types` | Ya | admin, user_region, user_all_region | admin |
| `serviceTypes` | `service_types` | Ya | admin, user_region, user_all_region | admin |
| `provinces` | `provinces` | Ya | admin, user_region, user_all_region | admin |
| `cities` | `cities` | Ya | admin, user_region, user_all_region | admin |
| `auditLogs` | `audit_logs` | Tidak | admin | admin |
| `customFields` | `custom_field_definitions` | Tidak | admin, user_region, user_all_region | admin |
| `attachments` | `attachments` | Tidak | admin, user_region, user_all_region | admin, user_region, user_all_region |
| `imports` | `import_jobs` | Tidak | admin, user_region, user_all_region | admin, user_region, user_all_region |
| `asBuiltDocuments` | `as_built_documents` | Tidak | admin, user_region, user_all_region | admin, user_region, user_all_region |
| `users` | `app_users` | Tidak | admin | admin |
| `validations` | `validation_records` | Tidak | admin, user_region, user_all_region | admin, user_region, user_all_region |

## Resource Extension

Base path: `/api/v1`

| Method | Endpoint | Keterangan |
| --- | --- | --- |
| GET | `/exports/pops.xlsx` | Export POP ke file Excel |
| GET | `/users` | List managed users |
| POST | `/users/:id/resend-verification` | Kirim ulang verifikasi user |
| PATCH | `/users/:id` | Update managed user |
| DELETE | `/users/:id` | Delete managed user |
| GET | `/devices/:id/trace` | Trace relasi device |
| GET | `/devices/:id/core-chain-summary` | Ringkasan core chain device |
| GET | `/devices/:id/core-chain-draft` | Draft core chain device |
| POST | `/devices/:id/core-chain-draft-link` | Simpan draft link core chain |
| POST | `/devices/:id/provision-ports` | Provision port device |
| GET | `/topology/quality` | Cek kualitas topology |
| GET | `/topology/integrity` | Cek integritas topology |
| POST | `/topology/transition/device-links` | Transisi topology device links |
| GET | `/topology/trace` | Trace topology |
| POST | `/attachments/upload` | Upload attachment |
| GET | `/attachments/:id/preview` | Preview attachment |
| GET | `/attachments/resolve/:identifier` | Resolve attachment berdasarkan identifier |
| GET | `/attachments/:id/download` | Download attachment |
| GET | `/qr-label-settings` | Baca konfigurasi logo/footer QR label |
| PATCH | `/qr-label-settings` | Update konfigurasi QR label, khusus superadmin |
| GET | `/resource-config/:resourceName` | Introspeksi config resource, khusus admin |

## Catatan Integrasi

- Frontend dan mobile app sebaiknya membaca master data dari resource dinamis, misalnya `odpTypes`, `installationTypes`, `serviceTypes`, `regions`, `pops`, `customers`, dan `devices`.
- Mobile validator memakai endpoint auth, dashboard, resource device/POP, attachment, dan validation request.
- Jika resource baru ditambahkan ke `RESOURCE_CONFIG`, pola CRUD otomatis ikut tersedia selama config read/write role sudah didefinisikan.
