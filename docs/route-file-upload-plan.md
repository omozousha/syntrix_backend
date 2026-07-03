# Plan: KMZ/KML Upload untuk Aset Kabel Fiber Optik

## 1. Latar Belakang

Kabel fiber optik adalah **aset jaringan linear** (Line/Polyline), bukan titik tunggal (Node).
Input koordinat manual (Lat/Lng) tidak efisien dan tidak akurat untuk menggambarkan jalur kabel
yang berbelok mengikuti jalan, rel kereta, atau kontur tanah.

**Solusi:** Upload file KMZ/KML yang berisi data spasial polyline.

---

## 2. Database Schema

### 2a. Opsi: PostGIS (Direkomendasikan)

PostGIS menyediakan kalkulasi spasial native (`ST_Length`, `ST_Transform`, dll).
Perlu aktivasi ekstensi PostGIS di database.

```sql
-- Aktivasi ekstensi (sekali)
create extension if not exists postgis;

-- Kolom baru di tabel devices
alter table public.devices
  add column if not exists route_geometry geometry(LineString, 4326),
  add column if not exists route_file_url text; -- URL file KML/KMZ yang diupload
```

**Keuntungan:**
- Kalkulasi panjang geodesic akurat via `ST_Length(route_geometry::geography)`
- Query spasial: `ST_Intersects`, `ST_DWithin`, `ST_Buffer`
- Output GeoJSON untuk frontend map

### 2b. Opsi: Tanpa PostGIS (Sederhana)

```sql
alter table public.devices
  add column if not exists route_coordinates jsonb,  -- [[lng,lat], [lng,lat], ...]
  add column if not exists route_file_url text;
```

**Kekurangan:** Kalkulasi panjang harus manual di backend (Haversine).

---

## 3. Backend — Upload & Parse KMZ/KML

### 3a. Endpoint Baru

```
POST /api/cables/upload-route
Content-Type: multipart/form-data

Request:
  file: File (KMZ atau KML)

Response:
  {
    "success": true,
    "data": {
      "coordinates": [[106.123, -6.123], ...],  // array koordinat
      "length_m": 12450.5,                       // panjang dalam meter
      "point_count": 342,                         // jumlah titik polyline
      "route_file_url": "/uploads/routes/kbl-123.kml"
    }
  }
```

### 3b. Parser KML

```javascript
// KML structure:
// <Document>
//   <Placemark>
//     <LineString>
//       <coordinates>lng1,lat1,alt1 lng2,lat2,alt2 ...</coordinates>
//     </LineString>
//   </Placemark>
// </Document>

function parseKML(xmlContent) {
  // Parse XML
  // Extract <LineString> → <coordinates>
  // Parse "lng,lat,alt lng,lat,alt ..." menjadi array [lng, lat]
  // Return array koordinat
}
```

### 3c. Parser KMZ

KMZ adalah ZIP yang berisi file KML (biasanya `doc.kml`).

```javascript
function parseKMZ(buffer) {
  // Unzip buffer
  // Cari file *.kml di dalam ZIP
  // Parse KML content
}
```

### 3d. Kalkulasi Panjang (Haversine)

Jika tanpa PostGIS:

```javascript
function haversineDistance(coord1, coord2) {
  const [lng1, lat1] = coord1;
  const [lng2, lat2] = coord2;
  const R = 6371000; // radius bumi dalam meter
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function calculateTotalLength(coordinates) {
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    total += haversineDistance(coordinates[i-1], coordinates[i]);
  }
  return Math.round(total * 100) / 100; // dalam meter
}
```

### 3e. File Storage

- Simpan file KML/KMZ di `uploads/routes/` (atau cloud storage S3/GCS)
- Simpan URL di kolom `route_file_url`
- Konversi KML ke GeoJSON untuk frontend map preview

---

## 4. Frontend — Form CABLE Baru

### 4a. Struktur Section Form

```
┌───────────────────────────────────────────────────┐
│  1. Informasi Route                                │
│  ┌───────────────────────────────────────────────┐ │
│  │ Nama Kabel           │ Route Name             │ │
│  │ Kategori Kabel ▾     │ Tipe Kabel ▾           │ │
│  └───────────────────────────────────────────────┘ │
├───────────────────────────────────────────────────┤
│  2. Upload Route File (KML/KMZ)                    │
│  ┌───────────────────────────────────────────────┐ │
│  │ [ Drag & drop KML/KMZ ]                      │ │
│  │ atau [ Pilih File ]                          │ │
│  │                                               │ │
│  │ ✅ Terupload: route-backbone.kml              │ │
│  │    📍 342 titik  |  📏 12.45 km              │ │
│  │    🗺️ [Peta Preview]                         │ │
│  └───────────────────────────────────────────────┘ │
│  Panjang Kabel (m): [12450.5] ← auto-fill         │
├───────────────────────────────────────────────────┤
│  3. Spesifikasi Kabel                              │
│  ┌───────────────────────────────────────────────┐ │
│  │ Manufacturer ▾  │ Model ▾                     │ │
│  └───────────────────────────────────────────────┘ │
├───────────────────────────────────────────────────┤
│  4. Core Fiber                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │ Capacity Core ▾  │ Used Core [42]             │ │
│  └───────────────────────────────────────────────┘ │
├───────────────────────────────────────────────────┤
│  5. Afiliasi Jaringan                              │
│  ┌───────────────────────────────────────────────┐ │
│  │ POP ▾  │ Tenant ▾  │ Project ▾               │ │
│  └───────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────┘
```

### 4b. Conditional Logic

```typescript
type CableFormState = {
  // ... existing fields
  uploadMode: "file" | "manual";       // mode input
  routeFile: File | null;               // file KML/KMZ
  routeCoordinates: number[][] | null;  // hasil parse
  routeFileUrl: string;                 // URL file tersimpan
  cable_length_m: string;               // auto-fill dari kalkulasi
};
```

**Behavior:**
- Default: `uploadMode = "file"`
- Jika **upload file**: `cable_length_m` terisi otomatis + **disabled**
- Jika user pilih **manual**: field `cable_length_m` bisa diedit manual
- Jika file diupload: tampilkan **preview map** dengan polyline (Leaflet/MapLibre)

### 4c. Komponen Upload (RouteFileUpload.tsx)

```tsx
function RouteFileUpload({
  onFileParsed,    // callback: (coordinates, length_m) => void
  disabled,
}: {
  onFileParsed: (data: { coordinates: number[][]; length_m: number }) => void;
  disabled: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState<{ points: number; length: number } | null>(null);

  const handleUpload = async (file: File) => {
    setParsing(true);
    const formData = new FormData();
    formData.append("file", file);
    const res = await apiFetch("/cables/upload-route", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    onFileParsed(data.coordinates, data.length_m);
    setPreview({ points: data.point_count, length: data.length_m });
    setParsing(false);
  };

  return (
    <div className="border-2 border-dashed rounded-lg p-6 text-center">
      {!file ? (
        <>
          <UploadIcon className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            Drag & drop file KML/KMZ, atau klik untuk pilih file
          </p>
          <input type="file" accept=".kml,.kmz" onChange={(e) => ...} />
        </>
      ) : (
        <div>
          <FileCheckIcon className="mx-auto h-8 w-8 text-green-500" />
          <p className="font-medium">{file.name}</p>
          <p className="text-xs text-muted-foreground">
            📍 {preview?.points} titik  |  📏 {(preview?.length / 1000).toFixed(2)} km
          </p>
          <Button variant="ghost" onClick={() => setFile(null)}>Ganti file</Button>
        </div>
      )}
    </div>
  );
}
```

### 4d. Map Preview (Opsional — Phase 2)

Untuk visual feedback, bisa integrasi **Leaflet** atau **MapLibre GL**:

```tsx
import { MapContainer, Polyline, TileLayer } from "react-leaflet";

function RouteMapPreview({ coordinates }: { coordinates: number[][] }) {
  return (
    <MapContainer center={centerPoint} zoom={13} className="h-48 rounded-md">
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Polyline positions={latLngs} color="blue" weight={3} />
    </MapContainer>
  );
}
```

---

## 5. Dependencies

### Backend (Node.js)
| Package | Fungsi |
|:--------|:-------|
| `multer` | File upload handling |
| `xml2js` atau `fast-xml-parser` | Parse XML KML file |
| `adm-zip` atau `yauzl` | Unzip KMZ file |
| `pg` | PostgreSQL connection (atau existing ORM) |

### Frontend (React/Next.js)
| Package | Fungsi |
|:--------|:-------|
| (shadcn/ui) | Upload component (sudah ada) |
| `leaflet`, `react-leaflet` | Map preview (Phase 2) |
| atau `maplibre-gl` | Map preview alternatif (Phase 2) |

---

## 6. Tahapan Implementasi

### Phase 1 — Core (Minimum Viable)
- [ ] Backend: Parser KML + kalkulasi panjang (Haversine)
- [ ] Backend: Endpoint `POST /api/cables/upload-route`
- [ ] Backend: Schema `route_coordinates` (JSONB) + `route_file_url`
- [ ] Frontend: Komponen `RouteFileUpload` (tanpa map preview)
- [ ] Frontend: Restrukturisasi form CABLE — section baru
- [ ] Frontend: Auto-fill `cable_length_m` dari response

### Phase 2 — Enhancement
- [ ] Backend: Dukungan KMZ (unzip)
- [ ] Backend: PostGIS integration (jika tersedia)
- [ ] Frontend: Map preview dengan Leaflet
- [ ] Frontend: Validasi file (max size, format)

### Phase 3 — Advanced
- [ ] Backend: GeoJSON export untuk integrasi GIS external
- [ ] Backend: Route snapping ke jalan (Map Matching API)
- [ ] Frontend: Edit polyline langsung di map
- [ ] Frontend: Multiple segment route

---

## 7. Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|:-------|:-------|:---------|
| File KMZ/KML sangat besar (>10MB) | Upload lambat | Batasi ukuran file, parsing di server |
| PostGIS tidak tersedia | Harus kalkulasi manual | Haversine sebagai fallback, upgrade ke PostGIS nanti |
| KML format complex (NetworkLink, Folder) | Parsing gagal | Handle multiple Placemark; merge semua LineString |
| Validasi koordinat invalid | Data rusak | Validasi bounds: lat -90..90, lng -180..180 |

---

## 8. Kesimpulan

**Prioritas pertama:** Endpoint upload + parser + auto-fill panjang kabel.
**Prioritas kedua:** Map preview + KMZ support.
**Prioritas ketiga:** PostGIS + advanced features.

Setelah implementasi, CABLE tidak lagi membutuhkan koordinat manual — cukup upload file rute.
