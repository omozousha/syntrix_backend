# Mapping `.env` To GitHub Secrets

Gunakan mapping ini saat mengisi:

- `GitHub Repository -> Settings -> Secrets and variables -> Actions`

## Mapping Wajib (Smoke Workflow)

1. `HASURA_URL`
   Sumber nilai: `HASURA_URL` di `.env`
2. `HASURA_ADMIN_SECRET`
   Sumber nilai: `HASURA_ADMIN_SECRET` di `.env`
3. `NHOST_AUTH_URL`
   Sumber nilai: `NHOST_AUTH_URL` di `.env`
4. `NHOST_STORAGE_URL`
   Sumber nilai: `NHOST_STORAGE_URL` di `.env`
5. `SMOKE_ADMIN_EMAIL`
   Sumber nilai: `SMOKE_ADMIN_EMAIL` di `.env`
   Jika belum ada di `.env`, isi dengan email admin yang valid.
6. `SMOKE_ADMIN_PASSWORD`
   Sumber nilai: `SMOKE_ADMIN_PASSWORD` di `.env`
   Jika belum ada di `.env`, isi dengan password admin yang valid.

## Mapping Opsional

1. `BOOTSTRAP_ADMIN_SECRET`
   Sumber nilai: `BOOTSTRAP_ADMIN_SECRET` di `.env`

## Checklist Cepat

1. Jalankan `npm run check:ci-env`
2. Pastikan semua key wajib status `OK`
3. Isi secret satu per satu di GitHub
4. Jalankan workflow `Smoke Test` dari tab Actions

## Catatan

- Jangan commit nilai secret ke repository.
- Nilai secret boleh sama dengan `.env` local, tetapi praktik terbaik adalah pakai kredensial khusus environment CI/staging.
