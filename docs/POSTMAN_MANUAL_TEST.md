# Postman Manual Test (Login + Token Auto-Set)

Dokumen ini untuk uji manual collection Postman di mesin Anda.

File yang dipakai:

- Collection: `postman/Syntrix_Backend.postman_collection.json`
- Environment (pilih salah satu):
  - `postman/Syntrix_Dev.postman_environment.json`
  - `postman/Syntrix_Staging.postman_environment.json`
  - `postman/Syntrix_Prod.postman_environment.json`

## 1) Import Collection dan Environment

1. Buka Postman
2. Klik `Import`
3. Import file collection dan file environment
4. Pilih environment yang sesuai (contoh: `Syntrix Dev`)

## 2) Set Nilai Environment

Pastikan variable ini terisi:

- `base_url` contoh `http://localhost:3000`
- `admin_email`
- `admin_password`
- `access_token` biarkan kosong awalnya
- `attachment_id` biarkan kosong awalnya

## 3) Uji Login dan Auto-Set Token

1. Jalankan request `Auth -> Login`
2. Buka tab `Tests` result (opsional) untuk memastikan test pass
3. Cek environment variable `access_token`
   Harus otomatis terisi oleh script test di request login.

## 4) Validasi Token Dengan Endpoint Protected

Jalankan request berikut:

1. `Auth -> Current User`
2. `Dashboard Summary`
3. `Regions List`

Jika ketiganya sukses, berarti `Authorization: Bearer {{access_token}}` sudah bekerja.

## 5) Uji Attachment Flow

1. Jalankan `Attachments -> Upload Attachment`
   Pastikan field file dipilih (misal `README.md`)
2. Setelah upload sukses, variable `attachment_id` akan terisi otomatis
3. Jalankan `Preview Attachment`
4. Jalankan `Download Attachment`
5. Jalankan `Delete Attachment`

## 6) Uji Import Flow (Preview)

1. Jalankan `Import -> Ingest Import (Preview)`
2. Isi file valid (`xlsx/xls/csv/kml/kmz`) dan `entity_type`
3. Pastikan response sukses dan ada `preview_rows`

## Troubleshooting Cepat

- `401 Unauthorized`:
  cek login, cek `access_token`, dan pastikan token belum expired.
- `403 Forbidden`:
  cek role user dan policy storage/Hasura.
- Upload gagal:
  cek `MAX_UPLOAD_SIZE_MB`, bucket policy, dan tipe file.
- Import ditolak:
  cek `entity_type` sesuai whitelist role dan `IMPORT_MAX_ROWS`.
