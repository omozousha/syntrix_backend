# Go-Live Checklist (Syntrix Backend)

Gunakan checklist ini sebelum backend dianggap production-ready.

## Security

1. Pastikan akun default tidak aktif (`admin@syntrix.local` di `app_users.is_active=false`).
2. Simpan hanya akun operasional (admin + user_region) dan pastikan password kuat.
3. Rotasi `HASURA_ADMIN_SECRET` dan `BOOTSTRAP_ADMIN_SECRET` jika pernah terekspos.
4. Set `CORS_ORIGINS` hanya ke domain resmi frontend (tanpa wildcard).
5. Set `NODE_ENV=production` dan `SERVE_TEST_UI=false` di environment production.

## Data & DB

6. Jalankan semua migration penting ID format (`INV-*`) dan audit hasilnya.
7. Verifikasi tidak ada ID legacy pada `pops` dan `devices`.
8. Uji import file (xlsx/kml/kmz) di production dengan 1 file sample valid.
9. Pastikan backup database aktif dan lakukan 1x uji restore.

## API & Access

10. Uji endpoint inti: `/health`, `/api/v1/auth/login`, `/api/v1/pops`, `/api/v1/devices`.
11. Uji role boundary:
- `user_region` tidak boleh create `regions` (403).
- `user_region` hanya boleh write data dalam region scope.
12. Uji upload attachment + delete attachment end-to-end.

## Deploy & Ops

13. Pastikan deployment Vercel terbaru status `READY` tanpa error kritis di runtime logs.
14. Pastikan env di Vercel sudah lengkap sesuai `.env.example` (key list sinkron).
15. Jalankan smoke test setelah deploy (`npm run smoke`) dan simpan hasilnya.

## Post Go-Live

16. Aktifkan monitoring log harian (login error rate, import failure, upload failure).
17. Buat runbook singkat: rollback deployment, rotate secret, disable user, restore backup.
