# GitHub Secrets For Smoke Workflow

Workflow smoke test berada di:

- `.github/workflows/smoke.yml`

Agar workflow bisa jalan, set repository secrets berikut di:

- `GitHub Repository -> Settings -> Secrets and variables -> Actions`

## Wajib

- `DATABASE_URL`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_WEB_API_KEY`
- `JWT_SECRET`
- `SMOKE_ADMIN_EMAIL`
- `SMOKE_ADMIN_PASSWORD`

## Opsional

- `BOOTSTRAP_ADMIN_SECRET`

## Contoh Nilai

```text
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
R2_ACCOUNT_ID=xxxxxxxx
R2_ACCESS_KEY_ID=xxxxxxxx
R2_SECRET_ACCESS_KEY=xxxxxxxx
R2_BUCKET_NAME=syntrix-storage
FIREBASE_PROJECT_ID=xxxxxxxx
FIREBASE_CLIENT_EMAIL=xxxxxxxx
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_WEB_API_KEY=xxxxxxxx
JWT_SECRET=xxxxxxxx
SMOKE_ADMIN_EMAIL=admin@syntrix.local
SMOKE_ADMIN_PASSWORD=your_admin_password
BOOTSTRAP_ADMIN_SECRET=optional_bootstrap_secret
```

## Catatan Keamanan

- Jangan commit nilai secret ke repository.
- Gunakan akun admin khusus smoke test yang scope aksesnya terkendali.
- Ganti password smoke user secara berkala.
- Batasi pemakaian workflow smoke hanya untuk branch/review yang diperlukan.
