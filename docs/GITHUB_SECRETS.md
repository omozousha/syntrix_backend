# GitHub Secrets For Smoke Workflow

Workflow smoke test berada di:

- `.github/workflows/smoke.yml`

Agar workflow bisa jalan, set repository secrets berikut di:

- `GitHub Repository -> Settings -> Secrets and variables -> Actions`

## Wajib

- `HASURA_URL`
- `HASURA_ADMIN_SECRET`
- `NHOST_AUTH_URL`
- `NHOST_STORAGE_URL`
- `SMOKE_ADMIN_EMAIL`
- `SMOKE_ADMIN_PASSWORD`

## Opsional

- `BOOTSTRAP_ADMIN_SECRET`

## Contoh Nilai

```text
HASURA_URL=https://your-project.hasura.ap-southeast-1.nhost.run/v1/graphql
HASURA_ADMIN_SECRET=xxxxxxxx
NHOST_AUTH_URL=https://your-project.auth.ap-southeast-1.nhost.run/v1
NHOST_STORAGE_URL=https://your-project.storage.ap-southeast-1.nhost.run/v1
SMOKE_ADMIN_EMAIL=admin@syntrix.local
SMOKE_ADMIN_PASSWORD=your_admin_password
BOOTSTRAP_ADMIN_SECRET=optional_bootstrap_secret
```

## Catatan Keamanan

- Jangan commit nilai secret ke repository.
- Gunakan akun admin khusus smoke test yang scope aksesnya terkendali.
- Ganti password smoke user secara berkala.
- Batasi pemakaian workflow smoke hanya untuk branch/review yang diperlukan.
