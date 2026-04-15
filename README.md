# Syntrix Backend

Backend RESTful API untuk aplikasi asset inventory fiber optik dengan fokus pada monitoring, validasi, dan integrasi data region, POP, project, route, customer, serta perangkat aktif dan passive.

## CI Status

Gunakan badge berikut setelah mengganti `OWNER/REPO` sesuai repository Anda:

```md
[![Smoke Test](https://github.com/OWNER/REPO/actions/workflows/smoke.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/smoke.yml)
```

## Stack

- Node.js + Express
- Nhost Auth
- Hasura GraphQL di atas PostgreSQL
- Nhost Storage untuk file upload

## Struktur Utama

- `app.js` entrypoint Express
- `src/config` konfigurasi env, Hasura, dan Nhost
- `src/middleware` auth dan error handling
- `src/modules/auth` login, register, current user
- `src/modules/dashboard` ringkasan dashboard
- `src/modules/resource` CRUD generik untuk entity inti
- `src/modules/import` endpoint import Excel/KML/KMZ
- `database/schema.sql` skema PostgreSQL siap import ke Nhost/Hasura
- `API_ENDPOINTS.md` dokumentasi endpoint detail
- `postman/` collection + environment Postman
- `.github/workflows/smoke.yml` pipeline smoke test

## Resource API

- `regions`
- `pops`
- `projects`
- `poles`
- `customers`
- `devices`
- `routes`
- `coreManagement`
- `manufacturers`
- `brands`
- `assetTypes`
- `assetModels`
- `customFields`
- `attachments`
- `imports`
- `users`
- `validations`

Semua resource mendukung:

- `GET /api/v1/{resource}`
- `GET /api/v1/{resource}/:id`
- `POST /api/v1/{resource}`
- `PATCH /api/v1/{resource}/:id`
- `DELETE /api/v1/{resource}/:id`

Tambahan:

- `POST /api/v1/attachments/upload`
- `GET /api/v1/dashboard/summary`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/register`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/logout`

## Role User

- `admin`
- `user_region`
- `user_all_region`

`user_region` dibatasi otomatis ke region yang terdaftar pada tabel `user_region_scopes`.

## Fitur Data

- ID POP dan device mengikuti format inventory seperti `INV-POP-XXXXXXX`, `INV-OLT-XXXXXXX`
- `device_code` dibedakan berdasarkan jenis perangkat
- `custom_fields` berbasis `jsonb` untuk region, POP, device, project, customer, route, dan pole
- file seperti foto, KML/KMZ, Excel, dan dokumen referensi disimpan melalui Nhost Storage dan direferensikan ke tabel `attachments`
- monitoring snapshot tersimpan di `monitoring_snapshots`
- aktivitas validasi tersimpan di `validation_records`
- core management tersimpan di tabel `core_management`

## Menjalankan

1. Salin `.env.example` menjadi `.env`
2. Isi variabel `HASURA_URL`, `HASURA_ADMIN_SECRET`, `NHOST_AUTH_URL`, `NHOST_STORAGE_URL`
3. Jalankan SQL pada `database/schema.sql`
4. Jalankan backend dengan `npm start`

## Dokumentasi API

Lihat daftar endpoint lengkap di:

- [API_ENDPOINTS.md](API_ENDPOINTS.md)

## Postman

File Postman yang tersedia:

- collection:
  - `postman/Syntrix_Backend.postman_collection.json`
- environments:
  - `postman/Syntrix_Dev.postman_environment.json`
  - `postman/Syntrix_Staging.postman_environment.json`
  - `postman/Syntrix_Prod.postman_environment.json`

## CI Smoke Test

Jalankan smoke test lokal:

```bash
npm run smoke
```

Panduan set GitHub Secrets untuk workflow smoke:

- `docs/GITHUB_SECRETS.md`
- `docs/GITHUB_SECRETS_MAPPING.md`

Panduan uji manual Postman:

- `docs/POSTMAN_MANUAL_TEST.md`

Panduan push dan deploy ke Vercel:

- `docs/DEPLOY_GITHUB_VERCEL.md`
