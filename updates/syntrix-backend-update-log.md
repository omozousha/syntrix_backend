# Syntrix Backend Update Log

## Current Release

- App: Syntrix Backend
- Version: 1.0.0
- Platform focus: REST API, workflow persistence, notification service, dan master data
- Update date: 29 Mei 2026

## Release Summary

Syntrix Backend saat ini menjadi pusat kontrak data untuk Syntrix Frontend dan Syntrix-One. Fokus utama perubahan ada pada workflow validasi QR-first, approval berlapis, push notification region-aware, tenant master data, dan enrichment actor agar UI dapat menampilkan nama user yang relevan.

## Main Changes

- Menambahkan dukungan FCM push notification untuk Syntrix-One.
- Menambahkan tabel `user_push_tokens` untuk menyimpan token device user.
- Menambahkan tabel `app_notifications` sebagai durable notification inbox.
- Menambahkan endpoint health FCM untuk membantu verifikasi konfigurasi Firebase.
- Menambahkan notification routing berdasarkan region device.
- Mengecualikan device CUSTOMER dan ONT dari notifikasi task validasi.
- Mengirim notifikasi task validasi ketika device dibuat oleh superadmin sesuai region device.
- Mengirim notifikasi validasi setelah request adminregion/superadmin diproses sesuai workflow.
- Menambahkan validation reminder dari frontend ke validator region terkait.
- Menyesuaikan notifikasi agar memakai nama device jika tersedia, bukan hanya device id.
- Menambahkan actor enrichment untuk submitted by, reviewer, validator, dan approval history.
- Menambahkan status ongoing pada device saat validator submit dan request masih menunggu approval.
- Menjaga hasil validasi validator sebagai request snapshot sampai approval selesai.
- Menambahkan public QR device endpoint untuk browser fallback Syntrix-One.
- Menambahkan tenant master schema dan relasi `devices.tenant_id`.
- Menambahkan endpoint tenant master data untuk frontend.
- Menambahkan tenant pada response detail device dan public QR fallback.
- Menambahkan dukungan field longitude/latitude/status pada validation payload jika dikirim dari app.
- Menyesuaikan validasi redaman agar tidak wajib.

## Database Changes

- `user_push_tokens`
- `app_notifications`
- `tenants`
- `devices.tenant_id`
- Index aktif untuk tenant, push token, notification inbox, dan relasi device tenant.

## Environment Variables

- `FCM_ENABLED`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

## API Areas

- Auth dan profile.
- Device CRUD dan device detail.
- Public QR fallback.
- Tenant master data.
- Validation requests.
- Validation approval workflow.
- Notification inbox.
- Push token registration.
- Validation reminder.
- FCM health.

## Release Checklist

- [ ] Jalankan `npm test`.
- [ ] Jalankan smoke test jika environment tersedia.
- [ ] Pastikan migration database sudah diterapkan di production.
- [ ] Pastikan env Firebase sudah benar di Vercel.
- [ ] Uji FCM health.
- [ ] Uji register push token dari Syntrix-One.
- [ ] Uji create device superadmin dan notifikasi validator region terkait.
- [ ] Uji create device adminregion dan approval sampai notifikasi validator.
- [ ] Uji reminder validasi dari detail ODP frontend.
- [ ] Uji tenant list, create, update, dan device detail.
- [ ] Uji public QR fallback endpoint.

## Notes

File ini adalah update log utama untuk Syntrix Backend. Untuk perubahan schema besar berikutnya, sertakan file migration dan file manual apply jika production database perlu patch terpisah.
