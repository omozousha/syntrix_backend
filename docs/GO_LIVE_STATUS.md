# Go-Live Status (Syntrix Backend)

Tanggal validasi: 2026-04-16 (Asia/Jakarta)

## Ringkasan

- Status umum: **READY (dengan catatan minor operasional)**
- Hasil uji teknis inti: **PASS**
- Item manual yang masih perlu tim infra/ops: backup-restore drill, monitoring alert policy

## Hasil Eksekusi Checklist

1. Default admin nonaktif di `app_users`: **PASS**
2. Akun operasional (`admin`, `user_region`) aktif dan login sukses: **PASS**
3. Rotasi `BOOTSTRAP_ADMIN_SECRET`: **PASS**
4. CORS origin production sudah diuji login sukses: **PASS**
5. Production root sudah non-UI testing (`SERVE_TEST_UI=false`): **PASS**
6. Migration ID format (`INV-*`) sudah diterapkan: **PASS**
7. Audit `pops` dan `devices` tidak ada legacy ID: **PASS**
8. Uji import sample production (`xlsx`, preview): **PASS**
9. Backup + restore drill: **PENDING (manual infra)**
10. Endpoint inti (`/health`, login, pops, devices): **PASS**
11. Role boundary `user_region`: **PASS**
12. Upload + preview + delete attachment: **PASS**
13. Deploy Vercel terbaru READY: **PASS**
14. Sinkronisasi key `.env` vs `.env.example`: **PASS**
15. Smoke-like validation post-deploy: **PASS**
16. Monitoring log harian: **PENDING (ops policy)**
17. Runbook operasional: **PASS** (lihat `docs/RUNBOOK_OPERATIONS.md`)

## Bukti Uji Teknis (Ringkas)

- Health: HTTP `200`
- Login admin ops: HTTP `200`
- Login user region: HTTP `200`
- Create POP (admin): HTTP `201` (ID `INV-POP-*`)
- Create device di region assigned (user_region): HTTP `201`
- Create device di region lain (user_region): HTTP `403`
- Create region (user_region): HTTP `403`
- Upload attachment: HTTP `201`
- Preview attachment: HTTP `200`
- Delete attachment: HTTP `200`
- Import preview POP sample: HTTP `201`, `job_status=completed`

## Catatan

- Karena akun default admin dinonaktifkan di `app_users`, login bisa berhasil di auth layer namun akses API backend akan ditolak (`403`) sesuai desain hardening.
