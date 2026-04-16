# Bearer Token Guide (Create + Testing)

Panduan ini menjelaskan cara membuat bearer token dan mengetes endpoint backend Syntrix.

## 1) Generate Bearer Token

Endpoint login:

```text
POST /api/v1/auth/login
```

Contoh base URL production:

```text
https://syntrix-backend.vercel.app/api/v1
```

Body login:

```json
{
  "email": "admin@syntrix.local",
  "password": "AdminKuat123!"
}
```

Jika berhasil, ambil nilai:

- `data.session.accessToken` -> ini bearer token
- `data.session.accessTokenExpiresIn` -> masa berlaku token (detik, default 900)

## 2) Pakai Bearer Token di Request API

Gunakan header:

```http
Authorization: Bearer <accessToken>
```

Contoh endpoint test:

```text
GET /api/v1/pops?page=1&limit=5
```

## 3) Contoh Testing via cURL

### 3.1 Login (ambil token)

```bash
curl -X POST "https://syntrix-backend.vercel.app/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@syntrix.local\",\"password\":\"AdminKuat123!\"}"
```

### 3.2 Test endpoint protected

```bash
curl "https://syntrix-backend.vercel.app/api/v1/pops?page=1&limit=5" \
  -H "Authorization: Bearer <TOKEN_DI_SINI>"
```

## 4) Contoh Testing via PowerShell

### 4.1 Login

```powershell
$base = "https://syntrix-backend.vercel.app/api/v1"
$loginBody = @{
  email = "admin@syntrix.local"
  password = "AdminKuat123!"
} | ConvertTo-Json

$login = Invoke-RestMethod -Method POST -Uri "$base/auth/login" -ContentType "application/json" -Body $loginBody
$token = $login.data.session.accessToken
$token
```

### 4.2 Call endpoint protected

```powershell
$headers = @{ Authorization = "Bearer $token" }
Invoke-RestMethod -Method GET -Uri "$base/pops?page=1&limit=5" -Headers $headers
```

## 5) Testing via Postman

1. Buat request `POST /api/v1/auth/login`.
2. Di `Body` pilih `raw` JSON dan isi email/password.
3. Klik `Send`, copy `data.session.accessToken`.
4. Buka request endpoint protected (mis. `/pops`).
5. Tab `Authorization` -> pilih `Bearer Token`.
6. Paste token -> `Send`.

## 6) Validasi Sukses / Gagal

Sukses:

- Login: HTTP `200`
- Endpoint protected: HTTP `200`

Gagal umum:

- `401 Missing bearer token` -> header belum dikirim
- `401/403` -> token expired / token invalid
- `500 Origin is not allowed by CORS` -> `CORS_ORIGINS` belum benar di env deploy

## 7) Security Notes (Penting)

- Jangan commit bearer token ke GitHub.
- Jangan share token di chat publik.
- Token berlaku singkat (default 15 menit), generate ulang jika expired.
- Jika token bocor, lakukan login ulang dan pertimbangkan rotasi kredensial user.
