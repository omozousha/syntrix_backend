# Broadcast Announcement / Event Notification Plan

Tanggal: 25 Mei 2026

## Tujuan

Membuat fitur broadcast pengumuman/pemberitahuan yang dapat dikirim dari Syntrix Frontend dan diterima oleh Syntrix-One Mobile App sebagai:

- Push notification Android melalui FCM.
- In-app notification inbox di app.
- Dialog in-app untuk event penting/urgent jika diperlukan.

Fitur ini dipakai untuk maintenance, pengumuman operasional, reminder validasi, pemberitahuan SOP, update APK, urgent incident, atau informasi regional.

## Prinsip Utama

- Backend menjadi sumber kebenaran target penerima.
- Frontend hanya mengirim intent broadcast, bukan menentukan user final secara bebas.
- Semua target wajib role-aware dan region-aware.
- Superadmin dapat mengirim global atau scoped.
- Adminregion hanya dapat mengirim ke validator di region yang dia kelola.
- Semua broadcast harus tersimpan sebagai audit/inbox, bukan hanya push sekali lewat.
- FCM failure tidak boleh menggagalkan penyimpanan inbox.
- Event urgent boleh tampil sebagai blocking dialog di app.

## Role Dan Scope

### Superadmin

Hak:

- Kirim ke semua region.
- Kirim ke region tertentu.
- Kirim ke role tertentu:
  - `adminregion`
  - `validator`
  - keduanya
- Kirim event severity apa pun termasuk `urgent`.
- Cancel/deactivate broadcast.
- Melihat riwayat semua broadcast.

Contoh:

- Maintenance server nasional.
- Update APK wajib.
- Perubahan SOP validasi nasional.
- Incident urgent lintas region.

### Adminregion

Hak:

- Kirim hanya ke validator di region yang dia punya aksesnya.
- Tidak bisa memilih region lain.
- Tidak bisa target superadmin.
- Tidak bisa target adminregion lain.
- Severity maksimal dapat dibatasi jika diperlukan, misalnya `info`, `warning`, `maintenance`.

Contoh:

- Reminder validasi Jabar.
- Maintenance POP regional.
- Instruksi lapangan untuk validator region terkait.

### Validator

Hak:

- Menerima push notification dan inbox.
- Membaca detail event.
- Acknowledge event, terutama untuk urgent/maintenance.
- Tidak bisa membuat broadcast.

## Jenis Event

Severity yang disarankan:

- `info`: Informasi umum.
- `maintenance`: Jadwal maintenance atau downtime.
- `warning`: Peringatan operasional.
- `urgent`: Pemberitahuan penting yang perlu perhatian segera.
- `force_update`: Khusus update APK wajib.

Perilaku app:

- `info`: masuk inbox dan push normal.
- `maintenance`: push high priority, tampil jelas di inbox.
- `warning`: push high priority, badge warning.
- `urgent`: push high priority, boleh munculkan dialog tengah saat app dibuka.
- `force_update`: blocking dialog sampai app diperbarui.

## Data Model Backend

### Table: `broadcast_events`

Kolom yang disarankan:

| Kolom | Tipe | Catatan |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `title` | text | Judul broadcast |
| `message` | text | Isi broadcast |
| `severity` | text | `info`, `maintenance`, `warning`, `urgent`, `force_update` |
| `target_scope` | text | `all`, `regions`, `roles`, `region_roles` |
| `target_region_ids` | uuid[] / jsonb | Region target |
| `target_roles` | text[] / jsonb | Role target |
| `created_by_user_id` | uuid | Pembuat event |
| `created_by_role` | text | Snapshot role pembuat |
| `created_by_region_id` | uuid | Snapshot region pembuat jika ada |
| `starts_at` | timestamptz | Waktu mulai aktif |
| `expires_at` | timestamptz | Waktu expired |
| `is_active` | boolean | Status aktif |
| `cancelled_at` | timestamptz | Jika dibatalkan |
| `cancelled_by_user_id` | uuid | Pembatal |
| `created_at` | timestamptz | Timestamp create |
| `updated_at` | timestamptz | Timestamp update |

### Table: `broadcast_event_recipients`

Opsional tapi direkomendasikan untuk traceability.

| Kolom | Tipe | Catatan |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `broadcast_event_id` | uuid | FK ke `broadcast_events` |
| `recipient_user_id` | uuid | User penerima |
| `recipient_role` | text | Snapshot role |
| `recipient_region_id` | uuid | Snapshot region |
| `notification_id` | uuid | FK ke `app_notifications`, optional |
| `pushed_at` | timestamptz | Push delivery timestamp |
| `read_at` | timestamptz | Read timestamp jika ingin mirror |
| `acknowledged_at` | timestamptz | Untuk urgent/maintenance |
| `created_at` | timestamptz | Timestamp create |

### Reuse Table: `app_notifications`

Event broadcast juga masuk ke `app_notifications` dengan:

- `notification_type`: `broadcast_event`
- `entity_type`: `broadcast_event`
- `entity_id`: `broadcast_events.id`
- `region_id`: region target jika single region, atau null untuk global
- `data`: payload tambahan seperti severity, route, expires_at, target scope

## Backend Endpoint

Base path yang disarankan: `/api/v1/broadcast-events`

| Method | Endpoint | Role | Fungsi |
| --- | --- | --- | --- |
| `POST` | `/` | superadmin, adminregion | Buat broadcast event |
| `GET` | `/` | superadmin, adminregion | List event sesuai akses |
| `GET` | `/:id` | superadmin, adminregion | Detail event |
| `PATCH` | `/:id/cancel` | superadmin, adminregion owner | Cancel event aktif |
| `POST` | `/:id/resend` | superadmin | Kirim ulang push jika perlu |
| `POST` | `/:id/ack` | validator, adminregion | Acknowledge event urgent |

Endpoint app dapat tetap memakai:

- `GET /api/v1/me/notifications`
- `PATCH /api/v1/me/notifications/:id/read`
- `PATCH /api/v1/me/notifications/read-all`

## Target Resolver Backend

### Superadmin Target

Input:

- `target_region_ids`: optional
- `target_roles`: optional, default `["adminregion", "validator"]`

Rules:

- Jika region kosong dan scope `all`, ambil semua user aktif dengan role target.
- Jika region terisi, ambil user aktif yang `default_region_id` atau `user_region_scopes` sesuai region.
- Role legacy tetap dipetakan:
  - `admin` -> `superadmin`
  - `user_all_region` -> `adminregion`
  - `user_region` -> `validator`

### Adminregion Target

Input:

- Adminregion tidak boleh override keluar region.
- Backend ambil allowed region dari `req.auth.regions`.
- Target role dipaksa `validator`.

Rules:

- Jika request mengirim `target_region_ids`, semua id harus termasuk `req.auth.regions`.
- Jika kosong, gunakan semua region milik adminregion.
- Ambil hanya user validator aktif di region tersebut.

## Payload FCM

Contoh payload:

```json
{
  "notification": {
    "title": "Maintenance POP Jabar",
    "body": "Maintenance dimulai pukul 22:00 WIB. Validasi dapat tertunda."
  },
  "data": {
    "type": "broadcast_event",
    "severity": "maintenance",
    "entity_type": "broadcast_event",
    "entity_id": "uuid",
    "route": "broadcast_detail",
    "region_id": "uuid",
    "expires_at": "2026-05-25T23:59:00.000Z"
  }
}
```

## Frontend Web

### Halaman Superadmin: Broadcast Center

Komponen/fitur:

- List broadcast event.
- Create broadcast dialog/form.
- Preview notifikasi.
- Filter severity, status, region, role, date range.
- Cancel event.
- Delivery summary:
  - total recipient
  - pushed
  - read
  - acknowledged

Form field:

- Title
- Message
- Severity
- Target role
- Target region
- Starts at
- Expires at
- Optional: require acknowledge
- Optional: action link / route

### Halaman Adminregion: Regional Announcement

Komponen/fitur:

- UI sama, tapi target region dikunci ke region adminregion.
- Target role dikunci validator.
- Tidak ada opsi global.
- Preview tetap tersedia.

## Mobile App

### Status Bar Notification

Menggunakan FCM yang sudah ada:

- Channel high priority `syntrix_high_priority`.
- Notification masuk status bar.
- Tap notification membuka detail broadcast atau inbox.

### In-App Inbox

Popup bell sudah membaca `GET /me/notifications`, sehingga broadcast akan otomatis tampil jika backend memasukkan row ke `app_notifications`.

Yang perlu ditambah:

- Mapping icon/severity untuk broadcast.
- Detail screen broadcast.
- Badge urgent/maintenance.
- Mark read tetap pakai endpoint yang sudah ada.

### Urgent Dialog

Untuk severity `urgent` atau `force_update`:

- Saat app boot/resume, cek unread active urgent broadcast.
- Jika ada, tampilkan dialog tengah.
- Dialog urgent biasa dapat ditutup dengan tombol `Saya Mengerti`.
- Dialog `force_update` tidak bisa ditutup dan harus membuka update URL.

## Audit Trail

Setiap action penting harus masuk audit:

- Broadcast dibuat.
- Broadcast dikirim.
- Broadcast dibatalkan.
- Broadcast dikirim ulang.
- Broadcast urgent di-acknowledge.

Audit minimal:

- actor user
- actor role
- target scope
- target region ids
- target roles
- recipient count
- severity

## Security & Validation

- Title wajib, maksimal 120 karakter.
- Message wajib, maksimal 1000 karakter.
- Severity wajib dan harus enum valid.
- `expires_at` harus lebih besar dari `starts_at`.
- Adminregion tidak boleh target keluar region.
- Adminregion tidak boleh target `adminregion` atau `superadmin`.
- Superadmin harus eksplisit memilih global atau scoped agar tidak salah kirim.
- Backend tidak boleh percaya target user list dari frontend.
- FCM failure hanya dicatat, inbox tetap dibuat.

## Dampak Ke Sistem

### Backend

- Migration table broadcast.
- Service target resolver.
- Service delivery yang reuse notification service.
- Endpoint broadcast.
- Audit trail.
- Update endpoint recap.

### Frontend

- Menu/halaman Broadcast Center untuk superadmin.
- Menu/halaman Regional Announcement untuk adminregion.
- Form create broadcast.
- List/detail/cancel broadcast.
- Preview notification.

### Mobile App

- Inbox sudah reusable, perlu mapping broadcast.
- Detail broadcast screen.
- Urgent dialog.
- Optional acknowledge.

## Todo Implementasi

### Phase 1 - Backend Foundation

- [ ] Buat migration `broadcast_events`.
- [ ] Buat migration `broadcast_event_recipients`.
- [ ] Buat enum/check constraint severity.
- [ ] Buat service `broadcast.service.js`.
- [ ] Buat target resolver superadmin.
- [ ] Buat target resolver adminregion.
- [ ] Reuse `sendNotificationToUsers` untuk FCM + inbox.
- [ ] Simpan recipient snapshot.
- [ ] Tambahkan audit log create/cancel/resend.
- [ ] Tambahkan endpoint CRUD minimal.
- [ ] Update `backend-endpoint-recap.md`.

### Phase 2 - Frontend Web UI

- [ ] Tambahkan menu Broadcast Center untuk superadmin.
- [ ] Tambahkan menu Regional Announcement untuk adminregion.
- [ ] Buat form create broadcast dengan shadcn UI.
- [ ] Tambahkan preview notification.
- [ ] Tambahkan validation form.
- [ ] Tambahkan list event.
- [ ] Tambahkan detail event.
- [ ] Tambahkan cancel event.
- [ ] Tambahkan delivery summary.
- [ ] Pastikan adminregion tidak melihat opsi global.

### Phase 3 - Mobile App Inbox & Dialog

- [ ] Tambahkan mapping notification type `broadcast_event`.
- [ ] Tambahkan severity style di inbox.
- [ ] Tambahkan broadcast detail screen.
- [ ] Tambahkan urgent dialog saat boot/resume.
- [ ] Tambahkan acknowledge action untuk urgent.
- [ ] Pastikan tap FCM membuka broadcast detail.
- [ ] Pastikan notification tetap region-scoped.

### Phase 4 - Verification

- [ ] Test superadmin kirim global ke adminregion + validator.
- [ ] Test superadmin kirim ke satu region.
- [ ] Test adminregion kirim ke validator region sendiri.
- [ ] Test adminregion gagal kirim ke region lain.
- [ ] Test validator Banten tidak menerima broadcast Jabar.
- [ ] Test FCM status bar muncul.
- [ ] Test in-app inbox muncul.
- [ ] Test urgent dialog muncul dan blocking.
- [ ] Test read/read-all.
- [ ] Test cancel event.
- [ ] Test audit trail.

## Checklist Acceptance

- [ ] Broadcast dari superadmin dapat target all region.
- [ ] Broadcast dari superadmin dapat target role tertentu.
- [ ] Broadcast dari adminregion hanya terkirim ke validator region terkait.
- [ ] Tidak ada region menerima broadcast region lain.
- [ ] Broadcast masuk status bar Android.
- [ ] Broadcast masuk in-app inbox.
- [ ] Broadcast urgent tampil sebagai dialog di tengah.
- [ ] Dialog urgent dapat acknowledge.
- [ ] Event expired tidak muncul sebagai urgent aktif.
- [ ] Semua event tersimpan dan dapat diaudit.
- [ ] Push failure tidak menghapus inbox.
- [ ] UI frontend konsisten dengan shadcn UI dan role access.
- [ ] Mobile app tetap ringan dan inbox tidak memuat data berlebihan.

## Catatan Pengembangan

Prioritas implementasi sebaiknya:

1. Backend target resolver dan inbox delivery.
2. Frontend create/list broadcast.
3. Mobile mapping broadcast di inbox.
4. Urgent dialog dan acknowledge.

Alasan:

- Target resolver adalah bagian paling penting agar tidak ada salah kirim lintas region.
- In-app inbox sudah tersedia, jadi broadcast bisa cepat memanfaatkan fondasi FCM saat ini.
- Urgent dialog bisa dibuat setelah event dasar terbukti stabil.
