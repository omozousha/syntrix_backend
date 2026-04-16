# Runbook Operations (Syntrix Backend)

Runbook singkat untuk operasi harian dan incident response.

## 1) Rollback Deployment (Vercel)

1. Buka project `syntrix-backend` di Vercel.
2. Pilih deployment sebelumnya yang status `READY`.
3. Klik `Promote to Production` (atau Redeploy commit stabil terakhir).
4. Verifikasi:
- `GET /health` -> `200`
- login admin ops -> `200`

## 2) Rotate Secret

Secret utama:

- `HASURA_ADMIN_SECRET`
- `BOOTSTRAP_ADMIN_SECRET`

Langkah:

1. Generate secret baru.
2. Update di sumber asli (Hasura / env manager).
3. Update di Vercel Environment Variables.
4. Redeploy.
5. Test endpoint inti (`/health`, `/auth/login`, `/pops`).

## 3) Disable User Darurat

Gunakan SQL (Hasura SQL Console):

```sql
update public.app_users
set is_active = false
where email = 'target@domain.com';
```

Efek:

- user masih bisa ada di auth provider,
- tapi akses backend ditolak (`403`) oleh middleware Syntrix.

## 4) Re-enable User

```sql
update public.app_users
set is_active = true
where email = 'target@domain.com';
```

## 5) Cek Boundary User Region

Ekspektasi:

- `user_region` tidak boleh create `regions` -> `403`
- `user_region` hanya write data pada region scope

Jika gagal:

1. cek `user_region_scopes`
2. cek role `app_users.role_name`
3. cek middleware auth terbaru sudah terdeploy

## 6) Restore Backup (Outline)

1. Ambil snapshot backup PostgreSQL terbaru.
2. Restore ke environment staging terlebih dulu.
3. Jalankan smoke test.
4. Jika valid, restore ke production window yang disetujui.
5. Re-verify endpoint inti.

## 7) Quick Health Commands

```bash
curl https://syntrix-backend.vercel.app/health
```

```bash
curl -X POST https://syntrix-backend.vercel.app/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin.ops@syntrix.local\",\"password\":\"<PASSWORD>\"}"
```

## 8) Incident Notes Template

- Waktu kejadian:
- Dampak:
- Endpoint terpengaruh:
- Root cause:
- Mitigasi sementara:
- Permanent fix:
- PIC:
