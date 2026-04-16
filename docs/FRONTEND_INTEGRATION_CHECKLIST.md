# Frontend Integration Checklist (Next.js -> Syntrix Backend)

Checklist ini dipakai saat menghubungkan frontend Next.js ke backend production:

- Base API: `https://syntrix-backend.vercel.app/api/v1`

## 1) Environment Frontend

1. Set env frontend:
- `NEXT_PUBLIC_API_BASE_URL=https://syntrix-backend.vercel.app/api/v1`
2. Pastikan domain frontend sudah masuk `CORS_ORIGINS` backend.
3. Jangan hardcode URL API di komponen/page.

## 2) Auth Flow

1. Login pakai `POST /auth/login`.
2. Simpan `accessToken` dengan aman (memory/session storage sesuai kebijakan aplikasi).
3. Kirim header:
- `Authorization: Bearer <token>`
4. Handle token expired:
- jika `401/403`, redirect ke login + clear session.

## 3) Endpoint Minimum untuk MVP

1. Auth:
- `POST /auth/login`
- `GET /auth/me`
2. Region & POP:
- `GET /regions`
- `GET /pops`
- `POST /pops`
- `PATCH /pops/:id`
- `DELETE /pops/:id`
3. File & Import:
- `POST /attachments/upload`
- `DELETE /attachments/:id`
- `POST /imports/ingest`

## 4) UAT Scenario Wajib

1. Login sukses (admin dan user_region).
2. List POP tampil.
3. Add POP sukses (`pop_code` 3 huruf).
4. Edit inline POP sukses.
5. Delete POP sukses.
6. Export POP XLSX sukses.
7. Upload attachment sukses.
8. Import sample XLSX POP sukses.
9. Boundary test user_region:
- create region => `403`
- create device di region assigned => `201`
- create device di region lain => `403`

## 5) Error Handling Frontend

1. Tampilkan pesan API `message` ke user.
2. Khusus `429` (rate limit): tampilkan retry message.
3. Khusus `500`: tampilkan generic error + id/log waktu kejadian.
4. Jangan tampilkan detail secret atau stacktrace di UI.

## 6) Security Frontend

1. Jangan commit token/kredensial ke repo.
2. Jangan expose secret backend di `NEXT_PUBLIC_*`.
3. Batasi akses halaman dengan guard berdasarkan status login.
4. Gunakan akun operasional (bukan akun default dev).

## 7) Contoh Helper Request (Fetch)

```ts
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL!;

export async function apiFetch(path: string, options: RequestInit = {}, token?: string) {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.message || `Request failed: ${res.status}`);
  }

  return data;
}
```

## 8) Go-Live Frontend

1. Build frontend production.
2. Verifikasi env production benar.
3. Jalankan UAT skenario wajib.
4. Monitor log 24 jam pertama (login/import/upload/error rate).
