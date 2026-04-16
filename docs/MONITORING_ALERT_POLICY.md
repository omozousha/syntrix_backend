# Monitoring & Alert Policy (Syntrix Backend)

Dokumen ini menutup item monitoring pada go-live checklist.

## Scope

- Backend API: `https://syntrix-backend.vercel.app`
- Endpoint utama:
  - `/health`
  - `/api/v1/auth/login`
  - `/api/v1/pops`
  - `/api/v1/devices`
  - `/api/v1/imports/ingest`
  - `/api/v1/attachments/upload`

## Severity Level

- `P1` Critical: layanan down / login massal gagal
- `P2` High: fitur inti degrade signifikan (import/upload sering gagal)
- `P3` Medium: error sporadis, masih ada workaround

## Alert Rules (Minimum)

1. Health Check Failure (`P1`)
- Kondisi: `/health` non-`200` selama 2 kali check berturut-turut (1 menit interval).
- Aksi awal:
  - cek deployment status Vercel
  - cek runtime logs 15 menit terakhir
  - rollback jika perlu

2. Login Error Rate (`P1`/`P2`)
- Kondisi:
  - `5xx` pada `/api/v1/auth/login` >= 5 kali dalam 5 menit -> `P1`
  - `4xx` spike >= 30 kali dalam 5 menit -> `P2` (cek brute-force/CORS/config)
- Aksi awal:
  - validasi env `CORS_ORIGINS`
  - validasi auth provider (Nhost Auth)
  - cek rate limiter behavior

3. Import Failure Spike (`P2`)
- Kondisi: `/api/v1/imports/ingest` response non-2xx >= 5 kali dalam 10 menit.
- Aksi awal:
  - cek payload sample gagal
  - cek limit import/env
  - cek storage/auth upstream

4. Upload Failure Spike (`P2`)
- Kondisi: `/api/v1/attachments/upload` non-2xx >= 5 kali dalam 10 menit.
- Aksi awal:
  - cek bucket permission Nhost
  - cek size limit (`MAX_UPLOAD_SIZE_MB`)
  - cek token/auth user role

5. Unauthorized Spike (`P3` -> `P2`)
- Kondisi: `401/403` gabungan > 100 kali dalam 10 menit.
- Aksi awal:
  - cek token expiry flow frontend
  - cek perubahan role/scope user
  - cek kemungkinan misuse

## Dashboard Minimum (Ops)

Pantau metrik berikut per 5 menit:

- total request
- success rate (`2xx`)
- client error (`4xx`)
- server error (`5xx`)
- latency p95 endpoint login/import/upload

## Response SLA

- `P1`: acknowledge <= 5 menit, mitigasi awal <= 15 menit
- `P2`: acknowledge <= 15 menit, mitigasi awal <= 60 menit
- `P3`: acknowledge <= 1 hari kerja

## Escalation Path

1. On-call engineer
2. Tech lead/backend owner
3. Product owner (jika berdampak user)

## Incident Update Template

- Waktu:
- Severity:
- Endpoint terdampak:
- Dampak user:
- Root cause sementara:
- Mitigasi sementara:
- Perbaikan permanen:
- PIC:

## Daily Ops Checklist (5 Menit)

1. Cek `GET /health` = `200`.
2. Cek log runtime 24 jam terakhir untuk `5xx`.
3. Cek login error trend.
4. Cek import/upload failure trend.
5. Catat temuan di log harian ops.
