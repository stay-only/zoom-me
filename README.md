# Zoom Lokal - Aplikasi Video Meeting di Jaringan Lokal

Aplikasi video meeting seperti Google Meet yang berjalan di jaringan lokal tanpa koneksi internet. 

## 📋 Struktur Project

```
zoom-lokal/
├── backend/          # NestJS Backend
│   ├── src/
│   │   ├── app.module.ts
│   │   ├── main.ts
│   │   └── meeting/
│   │       ├── meeting.controller.ts
│   │       └── meeting.service.ts
│   └── package.json
│
└── frontend/         # React + Tailwind CSS Frontend
    ├── src/
    │   ├── App.jsx
    │   ├── components/
    │   │   ├── Header.jsx
    │   │   ├── MainSection.jsx
    │   │   ├── StartMeetingCard.jsx
    │   │   ├── JoinMeetingCard.jsx
    │   │   └── GoogleMeetLogo.jsx
    │   ├── pages/
    │   │   └── HomePage.jsx
    │   └── services/
    │       └── meetingAPI.js
    └── package.json
```

## 🚀 Cara Menjalankan

### 1. Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Jalankan dalam mode development
npm run start:dev
```

Backend akan berjalan di `http://localhost:3000`

### 2. Frontend Setup

Buka terminal baru:

```bash
cd frontend

# Install dependencies  
npm install

# Jalankan dalam mode development
npm run dev
```

Frontend akan berjalan di `http://localhost:5173` (atau port lain jika 5173 sudah digunakan)

## 🎨 Fitur Halaman Awal

### Bagian Kiri - Welcome Message
- Judul "Tetap terhubung"
- Deskripsi aplikasi
- Tombol untuk memilih antara "Mulai Rapat" atau "Ikuti Rapat"
- Tip untuk memastikan semua perangkat terhubung ke jaringan yang sama

### Bagian Kanan - Meeting Cards

#### Start Meeting Card
- Form untuk membuat rapat baru
- Checkbox untuk mengaktifkan video saat bergabung
- Checkbox untuk mengaktifkan mikrofon saat bergabung
- Tombol "Mulai Rapat Sekarang"
- Informasi bahwa kode akses dibuat otomatis

#### Join Meeting Card
- Input field untuk memasukkan kode akses (format: XXXX-XXXX)
- Validasi input real-time
- Tombol "Bergabung Sekarang"
- Panduan 3 langkah untuk bergabung
- Warning message untuk double-check kode

## 🔌 API Endpoints

### Create Meeting
```
POST /api/meetings/create
Body: { userId: string }
Response: { success: boolean, data: { id, code }, message: string }
```

### Join Meeting
```
POST /api/meetings/join
Body: { code: string, userId: string }
Response: { success: boolean, message: string, meetingId?: string }
```

### Get Meeting
```
GET /api/meetings/:id
Response: { success: boolean, data: Meeting, message?: string }
```

### End Meeting
```
POST /api/meetings/:id/end
Response: { success: boolean, message: string }
```

## 📦 Dependencies

### Backend (NestJS)
- @nestjs/common
- @nestjs/core
- @nestjs/platform-express
- rxjs

### Frontend (React)
- react 19.2.5
- react-dom 19.2.5
- tailwindcss 4.2.4
- @tailwindcss/vite 4.2.4

## 🎯 Tahapan Development (Roadmap)

1. ✅ **Halaman Awal** - Home page dengan start/join meeting
2. 🔄 **Video Room** - Halaman untuk video meeting dengan WebRTC
3. 📝 **Database** - Simpan meeting history
4. 🔐 **Authentication** - Login/Register user
5. 🎤 **Audio/Video** - Implementasi WebRTC untuk streaming
6. 💬 **Chat** - Chat dalam meeting
7. 📱 **Screen Share** - Share layar
8. 📊 **Recording** - Rekam meeting

## 🔧 Konfigurasi

### Frontend API URL
Edit di `src/services/meetingAPI.js`:
```javascript
const API_BASE_URL = 'http://localhost:3000/api'
```

### Backend Port
Edit di `backend/src/main.ts` atau set environment variable:
```bash
PORT=3000 npm run start:dev
```

## 📝 Catatan

- User ID disimpan di localStorage untuk sesi saat ini
- Meeting code format: XXXX-XXXX (random alphanumeric)
- Semua perangkat harus terhubung ke jaringan yang sama
- Backend menggunakan CORS untuk allow request dari frontend

## 🐛 Troubleshooting

### Frontend tidak bisa connect ke backend
- Pastikan backend sedang berjalan di port 3000
- Check CORS configuration di backend
- Buka browser console untuk melihat error detail

### Build Error
```bash
# Clear cache dan reinstall
rm -rf node_modules package-lock.json
npm install
```

## 📧 Support

Jika ada pertanyaan atau issue, silakan buat issue di repository ini.
