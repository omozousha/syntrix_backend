# Syntrix Backend API Endpoints

Dokumen ini merangkum endpoint yang saat ini sudah tersedia di backend Syntrix, termasuk metode HTTP dan kebutuhan autentikasinya.

Base URL lokal:

```text
http://localhost:3000/api/v1
```

Jika port `3000` bentrok dengan aplikasi lain, jalankan backend dengan port lain, misalnya `3010`, `3020`, dan seterusnya.

## Status Umum

Endpoint di bawah ini sudah tersedia dan bisa digunakan berdasarkan implementasi backend saat ini:

- health check
- auth
- dashboard summary
- CRUD resource generik untuk entity utama
- upload file attachment ke Nhost Storage
- delete attachment beserta file fisik di Nhost Storage
- preview dan download attachment via backend proxy
- import `Excel/KML/KMZ` dengan mode preview/apply
- pembatasan import berdasarkan role dan limit jumlah baris
- resource config introspection untuk admin

## Public Endpoint

### Health Check

- `GET /health`
  - auth: tidak perlu
  - fungsi: mengecek apakah service backend hidup

Contoh response:

```json
{
  "success": true,
  "service": "syntrix-backend",
  "environment": "development",
  "timestamp": "2026-04-14T09:00:00.000Z"
}
```

## Auth Endpoint

Base path:

```text
/api/v1/auth
```

### Login

- `POST /api/v1/auth/login`
  - auth: tidak perlu
  - fungsi: login user melalui Nhost Auth
  - body:

```json
{
  "email": "admin@syntrix.local",
  "password": "AdminKuat123!"
}
```

### Bootstrap Admin

- `POST /api/v1/auth/bootstrap-admin`
  - auth: tidak memakai bearer token
  - header wajib:
    - `x-bootstrap-secret`
  - fungsi: membuat admin pertama saat `app_users` masih kosong
  - body:

```json
{
  "email": "admin@syntrix.local",
  "password": "AdminKuat123!",
  "full_name": "Syntrix Super Admin"
}
```

Catatan:

- endpoint ini hanya bisa dipakai ketika belum ada user Syntrix
- endpoint ini memakai `BOOTSTRAP_ADMIN_SECRET` dari `.env`

### Register User

- `POST /api/v1/auth/register`
  - auth: bearer token wajib
  - role: `admin`
  - fungsi: membuat user baru setelah sistem memiliki admin
  - body contoh:

```json
{
  "email": "user.region@syntrix.local",
  "password": "UserRegion123!",
  "full_name": "User Region",
  "role_name": "user_region",
  "default_region_id": "uuid-region",
  "region_ids": ["uuid-region"]
}
```

### Current User

- `GET /api/v1/auth/me`
  - auth: bearer token wajib
  - role: `admin`, `user_region`, `user_all_region`
  - fungsi: mengambil profil user yang sedang login

### Logout

- `POST /api/v1/auth/logout`
  - auth: tidak memakai bearer token backend
  - fungsi: signout session Nhost
  - body:

```json
{
  "refresh_token": "refresh-token-dari-login"
}
```

### Audit Avatar Orphans (Admin)

- `GET /api/v1/auth/avatar-orphans`
  - auth: bearer token wajib
  - role: `admin`
  - fungsi: audit attachment avatar yang sudah tidak direferensikan user
  - query opsional:
    - `limit` (default `100`, max `1000`)

### Cleanup Avatar Orphans (Admin)

- `POST /api/v1/auth/avatar-orphans/cleanup`
  - auth: bearer token wajib
  - role: `admin`
  - fungsi: hapus metadata + file storage untuk avatar orphan
  - body/query opsional:
    - `limit` (default `100`, max `1000`)

## Dashboard Endpoint

Base path:

```text
/api/v1/dashboard
```

### Dashboard Summary

- `GET /api/v1/dashboard/summary`
  - auth: bearer token wajib
  - role: `admin`, `user_region`, `user_all_region`
  - fungsi: ringkasan jumlah data utama seperti device, POP, project, customer, validation, monitoring

## Resource CRUD Endpoint

Base path:

```text
/api/v1/{resource}
```

Setiap resource di bawah ini saat ini mendukung metode:

- `GET /api/v1/{resource}`
- `GET /api/v1/{resource}/:id`
- `POST /api/v1/{resource}`
- `PATCH /api/v1/{resource}/:id`
- `DELETE /api/v1/{resource}/:id`

## Daftar Resource Yang Sudah Ada

### Regions

- resource: `regions`
- metode tersedia:
  - `GET`
  - `POST`
  - `PATCH`
  - `DELETE`
- akses:
  - baca: `admin`, `user_region`, `user_all_region`
  - tulis: `admin`

### POPs

- resource: `pops`
- metode tersedia:
  - `GET`
  - `POST`
  - `PATCH`
  - `DELETE`
- akses:
  - baca: `admin`, `user_region`, `user_all_region`
  - tulis: `admin`, `user_all_region`

### Projects

- resource: `projects`
- metode tersedia:
  - `GET`
  - `POST`
  - `PATCH`
  - `DELETE`
- akses:
  - baca: `admin`, `user_region`, `user_all_region`
  - tulis: `admin`, `user_all_region`

### Poles

- resource: `poles`
- metode tersedia:
  - `GET`
  - `POST`
  - `PATCH`
  - `DELETE`
- akses:
  - baca: `admin`, `user_region`, `user_all_region`
  - tulis: `admin`, `user_all_region`

### Customers

- resource: `customers`
- metode tersedia:
  - `GET`
  - `POST`
  - `PATCH`
  - `DELETE`
- akses:
  - baca: `admin`, `user_region`, `user_all_region`
  - tulis: `admin`, `user_all_region`

### Devices

- resource: `devices`
- metode tersedia:
  - `GET`
  - `POST`
  - `PATCH`
  - `DELETE`
- akses:
  - baca: `admin`, `user_region`, `user_all_region`
  - tulis: `admin`, `user_region`, `user_all_region`

### Routes

- resource: `routes`
- metode tersedia:
  - `GET`
  - `POST`
  - `PATCH`
  - `DELETE`
- akses:
  - baca: `admin`, `user_region`, `user_all_region`
  - tulis: `admin`, `user_region`, `user_all_region`

### Device Links

- resource: `deviceLinks`
- metode tersedia:
  - `GET`
  - `POST`
  - `PATCH`
  - `DELETE`
- akses:
  - baca: `admin`, `user_region`, `user_all_region`
  - tulis: `admin`, `user_region`, `user_all_region`

### Device Ports

- resource: `devicePorts`
- metode tersedia:
  - `GET`
  - `POST`
  - `PATCH`
  - `DELETE`
- akses:
  - baca: `admin`, `user_region`, `user_all_region`
  - tulis: `admin`, `user_region`, `user_all_region`

### Port Connections

- resource: `portConnections`
- metode tersedia:
  - `GET`
  - `POST`
  - `PATCH`
  - `DELETE`
- akses:
  - baca: `admin`, `user_region`, `user_all_region`
  - tulis: `admin`, `user_region`, `user_all_region`

### Core Management

- resource: `coreManagement`
- metode tersedia:
  - `GET`
  - `POST`
  - `PATCH`
  - `DELETE`
- akses:
  - baca: `admin`, `user_region`, `user_all_region`
  - tulis: `admin`, `user_region`, `user_all_region`

### Manufacturers

- resource: `manufacturers`
- metode tersedia:
  - `GET`
  - `POST`
  - `PATCH`
  - `DELETE`
- akses:
  - baca: `admin`, `user_region`, `user_all_region`
  - tulis: `admin`

### Brands

- resource: `brands`
- metode tersedia:
  - `GET`
  - `POST`
  - `PATCH`
  - `DELETE`
- akses:
  - baca: `admin`, `user_region`, `user_all_region`
  - tulis: `admin`

### Asset Types

- resource: `assetTypes`
- metode tersedia:
  - `GET`
  - `POST`
  - `PATCH`
  - `DELETE`
- akses:
  - baca: `admin`, `user_region`, `user_all_region`
  - tulis: `admin`

### Asset Models

- resource: `assetModels`
- metode tersedia:
  - `GET`
  - `POST`
  - `PATCH`
  - `DELETE`
- akses:
  - baca: `admin`, `user_region`, `user_all_region`
  - tulis: `admin`

### Custom Fields

- resource: `customFields`
- metode tersedia:
  - `GET`
  - `POST`
  - `PATCH`
  - `DELETE`
- akses:
  - baca: `admin`, `user_region`, `user_all_region`
  - tulis: `admin`

### Attachments

- resource: `attachments`
- metode tersedia:
  - `GET`
  - `POST`
  - `PATCH`
  - `DELETE`
- akses:
  - baca: `admin`, `user_region`, `user_all_region`
  - tulis: `admin`, `user_region`, `user_all_region`

### Import Jobs

- resource: `imports`
- metode tersedia:
  - `GET`
  - `POST`
  - `PATCH`
  - `DELETE`
- akses:
  - baca: `admin`, `user_region`, `user_all_region`
  - tulis: `admin`, `user_region`, `user_all_region`

### Users

- resource: `users`
- metode tersedia:
  - `GET`
  - `POST`
  - `PATCH`
  - `DELETE`
- akses:
  - baca: `admin`
  - tulis: `admin`

### Validations

- resource: `validations`
- metode tersedia:
  - `GET`
  - `POST`
  - `PATCH`
  - `DELETE`
- akses:
  - baca: `admin`, `user_region`, `user_all_region`
  - tulis: `admin`, `user_region`, `user_all_region`

## Endpoint Tambahan Resource

### Upload Attachment

- `POST /api/v1/attachments/upload`
  - auth: bearer token wajib
  - role: `admin`, `user_region`, `user_all_region`
  - fungsi: upload file ke Nhost Storage dan simpan metadata ke tabel `attachments`
  - content type:
    - `multipart/form-data`
  - field yang dipakai:
    - `file`
    - `bucket_id` opsional
    - `entity_type` opsional
    - `entity_id` opsional
    - `file_category` opsional
    - `is_public` opsional

Catatan implementasi saat ini:

- endpoint ini sudah teruji berhasil
- file diupload ke bucket `default` bila `bucket_id` tidak dikirim
- metadata upload akan disimpan ke tabel `attachments`
- contoh file yang sudah diuji: `README.md`

### Delete Attachment

- `DELETE /api/v1/attachments/:id`
  - auth: bearer token wajib
  - role: `admin`, `user_region`, `user_all_region`
  - fungsi:
    - menghapus metadata attachment dari database
    - menghapus file fisik dari Nhost Storage bila `storage_file_id` tersedia

Catatan implementasi saat ini:

- endpoint ini sudah teruji berhasil
- perilaku delete sekarang bersifat full cleanup
- jika file di storage sudah tidak ada, metadata attachment tetap akan dibersihkan

### Preview Attachment

- `GET /api/v1/attachments/:id/preview`
  - auth: bearer token wajib
  - role: `admin`, `user_region`, `user_all_region`
  - fungsi: menampilkan konten file attachment dengan mode inline

### Download Attachment

- `GET /api/v1/attachments/:id/download`
  - auth: bearer token wajib
  - role: `admin`, `user_region`, `user_all_region`
  - fungsi: mengunduh konten file attachment sebagai berkas

### Resource Config

- `GET /api/v1/resource-config/:resourceName`
  - auth: bearer token wajib
  - role: `admin`
  - fungsi: melihat konfigurasi internal resource registry backend

### Device Trace

- `GET /api/v1/devices/:id/trace`
  - auth: bearer token wajib
  - role: `admin`, `user_region`, `user_all_region`
  - fungsi:
    - melihat graph koneksi perangkat dari titik device tertentu
    - ringkasan upstream/downstream berdasarkan `device_type_key`
  - query opsional:
    - `max_depth` (default `6`, minimum `1`, maksimum `12`)

## Import Endpoint

### Ingest Import File

- `POST /api/v1/imports/ingest`
  - auth: bearer token wajib
  - role: `admin`, `user_region`, `user_all_region`
  - content type: `multipart/form-data`
  - field:
    - `file` wajib, format: `xlsx`, `xls`, `csv`, `kml`, `kmz`
    - `entity_type` wajib
    - `apply` opsional (`true` atau `false`, default `false`)
    - `region_id`, `pop_id`, `project_id` opsional sebagai default mapping
    - `bucket_id` opsional

Mode endpoint:

- `apply=false`: hanya parsing + preview + simpan import job
- `apply=true`: parsing + insert ke entity target + update import job

Entity yang didukung di import saat ini:

- `devices`
- `pops`
- `projects`
- `regions`

Limit keamanan import:

- dibatasi `IMPORT_MAX_ROWS` dari env
- whitelist entity import dibatasi per role:
  - `IMPORT_ALLOWED_ENTITIES_ADMIN`
  - `IMPORT_ALLOWED_ENTITIES_USER_ALL_REGION`
  - `IMPORT_ALLOWED_ENTITIES_USER_REGION`

## Query Param Yang Didukung Pada List Endpoint

Semua `GET /api/v1/{resource}` mendukung parameter dasar berikut:

- `page`
- `limit`
- `q`

Sebagian resource juga mendukung filter kolom sesuai konfigurasi resource. Contoh:

- `region_id`
- `pop_id`
- `project_id`
- `status`
- `asset_group`
- `device_type_key`
- `entity_type`

Contoh:

```text
GET /api/v1/devices?page=1&limit=20&q=OLT&region_id=<uuid>&status=active
```

## Header Auth

Untuk endpoint yang membutuhkan autentikasi, gunakan:

```http
Authorization: Bearer <access_token>
```

Token bisa diperoleh dari response endpoint:

- `POST /api/v1/auth/login`

## Environment Security Config

Variabel env penting untuk hardening yang sudah diimplementasikan:

- `CORS_ORIGINS`
- `API_BODY_LIMIT`
- `AUTH_RATE_LIMIT_WINDOW_MS`
- `AUTH_RATE_LIMIT_MAX`
- `API_RATE_LIMIT_WINDOW_MS`
- `API_RATE_LIMIT_MAX`
- `IMPORT_MAX_ROWS`
- `IMPORT_ALLOWED_ENTITIES_ADMIN`
- `IMPORT_ALLOWED_ENTITIES_USER_ALL_REGION`
- `IMPORT_ALLOWED_ENTITIES_USER_REGION`

## Endpoint Yang Sudah Diuji

Endpoint berikut sudah diuji langsung dan berhasil:

- `GET /health`
- `POST /api/v1/auth/bootstrap-admin`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `GET /api/v1/dashboard/summary`
- `GET /api/v1/regions`
- `POST /api/v1/attachments/upload`
- `DELETE /api/v1/attachments/:id`
- `GET /api/v1/attachments/:id/preview`
- `GET /api/v1/attachments/:id/download`
- `POST /api/v1/imports/ingest` (excel apply dan kmz preview)

## Hasil Uji Penting

- bootstrap admin pertama berhasil dibuat
- login admin berhasil
- endpoint protected dengan bearer token berhasil diakses
- upload attachment berhasil ke Nhost Storage dan metadata masuk ke tabel `attachments`
- delete attachment sekarang juga menghapus file fisik dari Nhost Storage
- endpoint preview/download attachment sudah berjalan dengan proxy backend
- import `xlsx/xls/csv/kml/kmz` sudah berjalan untuk preview dan apply (entity tertentu)

## Automated Smoke Test

Script smoke test otomatis tersedia:

```bash
npm run smoke
```

Environment opsional untuk script smoke:

- `SMOKE_BASE_URL` default `http://127.0.0.1:3000`
- `SMOKE_ADMIN_EMAIL` default `admin@syntrix.local`
- `SMOKE_ADMIN_PASSWORD` default `AdminKuat123!`

## Postman Collection

Collection siap pakai tersedia di:

- `postman/Syntrix_Backend.postman_collection.json`

Collection ini mencakup:

- health check
- login + auto set `access_token`
- current user
- dashboard summary
- regions list
- attachment upload/preview/download/delete
- import ingest preview

Variable collection yang tersedia:

- `base_url`
- `admin_email`
- `admin_password`
- `access_token`
- `attachment_id`

## CI Smoke Workflow

Workflow CI tersedia di:

- `.github/workflows/smoke.yml`

Alur workflow:

1. install dependency dengan `npm ci`
2. validasi secrets wajib
3. start backend
4. jalankan `npm run smoke`
5. tampilkan log backend jika gagal

Secrets yang wajib diset pada GitHub repository:

- `HASURA_URL`
- `HASURA_ADMIN_SECRET`
- `NHOST_AUTH_URL`
- `NHOST_STORAGE_URL`
- `SMOKE_ADMIN_EMAIL`
- `SMOKE_ADMIN_PASSWORD`

Secrets opsional:

- `BOOTSTRAP_ADMIN_SECRET`

## Catatan

- Semua resource CRUD saat ini memakai layer generik Hasura GraphQL di backend Node.js.
- Relasi dan permission level tetap ditentukan oleh middleware backend serta data role pada `app_users`.
- Untuk `user_region`, akses tulis dan baca dibatasi oleh `region_id` yang ada di `user_region_scopes`.
