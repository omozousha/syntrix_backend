# Deploy Guide (GitHub + Vercel)

## 1) Prepare Push to GitHub

Pastikan berada di folder project:

```bash
cd syntrix_backend
```

Jika repository belum di-init:

```bash
git init
git branch -M main
```

Tambah remote:

```bash
git remote add origin https://github.com/<owner>/<repo>.git
```

Commit dan push:

```bash
git add .
git commit -m "chore: prepare vercel deployment"
git push -u origin main
```

## 2) Connect Repository to Vercel

1. Buka Vercel Dashboard.
2. `Add New...` -> `Project`.
3. Import repository GitHub `syntrix_backend`.
4. Framework preset: `Other`.
5. Root Directory: repository root.
6. Deploy.

`vercel.json` sudah disiapkan untuk menjalankan `app.js` sebagai Node runtime.

## 3) Set Environment Variables on Vercel

Tambahkan variabel berikut pada Vercel Project Settings -> Environment Variables:

- `NODE_ENV=production`
- `HASURA_URL`
- `HASURA_ADMIN_SECRET`
- `NHOST_AUTH_URL`
- `NHOST_STORAGE_URL`
- `DEFAULT_STORAGE_BUCKET` (contoh `default`)
- `MAX_UPLOAD_SIZE_MB` (contoh `25`)
- `AUTH_RATE_LIMIT_WINDOW_MS`
- `AUTH_RATE_LIMIT_MAX`
- `API_RATE_LIMIT_WINDOW_MS`
- `API_RATE_LIMIT_MAX`
- `IMPORT_MAX_ROWS`
- `IMPORT_ALLOWED_ENTITIES_ADMIN`
- `IMPORT_ALLOWED_ENTITIES_USER_ALL_REGION`
- `IMPORT_ALLOWED_ENTITIES_USER_REGION`
- `BOOTSTRAP_ADMIN_SECRET` (opsional setelah bootstrap bisa dikosongkan/rotasi)

Untuk CORS production:

- `CORS_ORIGINS=https://<frontend-domain-utama>,https://<preview-domain-jika-perlu>`

## 4) Verify Deployment

Setelah deploy sukses, verifikasi:

- `GET https://<your-vercel-domain>/health`
- Login endpoint:
  - `POST https://<your-vercel-domain>/api/v1/auth/login`
- Endpoint protected dengan Bearer token.

## 5) Important Notes

- `app.js` sudah dibuat kompatibel local + Vercel (`module.exports = app` dan `listen` hanya di non-Vercel).
- Jika deploy sukses tapi request 401/403, biasanya token/Auth URL atau data `app_users` belum sesuai.
- Jika upload gagal, cek permission bucket `default` di Nhost Storage.
