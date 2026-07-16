# Zoom-Me — Aplikasi Video Meeting (ala Google Meet / Zoom)

Aplikasi rapat video lengkap berbasis **WebRTC**: video/audio peer-to-peer, berbagi layar, chat, reaksi, dan moderasi host — dibangun dengan **NestJS** (backend + signaling) dan **React + Vite + Tailwind** (frontend).

Dalam mode production, **satu server / satu port** melayani semuanya: halaman web, REST API, dan WebSocket signaling. Tidak ada konfigurasi alamat server di frontend — otomatis mengikuti alamat halaman, sehingga bisa di-deploy di mana saja (VPS, Docker, Railway/Render, Codespaces, atau LAN kantor) tanpa mengubah kode.

## ✨ Fitur

**Rapat**
- Video & audio banyak peserta (mesh P2P WebRTC, STUN + TURN)
- Berbagi layar (dengan audio tab bila didukung browser) — berfungsi juga bagi peserta yang bergabung tanpa kamera (renegosiasi otomatis)
- Halaman pra-gabung ala Meet: pratinjau kamera, atur mic/kamera & nama sebelum masuk
- **Pemilih perangkat**: pilih kamera & mikrofon di pra-gabung maupun di tengah rapat (ikon ⚙️) tanpa memutus koneksi; pilihan tersimpan di perangkat
- **Indikator sedang berbicara**: bingkai hijau pada video peserta yang bersuara
- Bergabung tetap bisa walau kamera/mic ditolak (mode lihat + chat); tombol mic/kamera akan meminta ulang izin saat ditekan
- Pin video (spotlight), layar penuh, timer durasi, indikator koneksi + sambung ulang otomatis
- **PWA**: bisa di-install ke layar utama HP/desktop seperti aplikasi asli

**Kolaborasi**
- Chat dengan timestamp, hapus pesan (pemilik/host), badge pesan belum dibaca
- **Riwayat chat**: peserta yang bergabung belakangan ikut melihat s.d. 100 pesan sebelumnya (pesan terhapus tidak disertakan)
- Reaksi emoji melayang 👍❤️😂😮👏🎉 dan angkat tangan ✋
- Link undangan siap salin (`/?room=kode`) — penerima langsung masuk pra-gabung; kolom "Gabung" juga menerima link utuh yang ditempel
- Status mic/kamera/berbagi layar tiap peserta tersinkron real-time

**Moderasi (host = pembuat room, ditegakkan di server)**
- Bisukan peserta / bisukan semua; minta peserta menyalakan mic (dengan persetujuan, ala Zoom)
- Matikan kamera peserta; minta menyalakan kamera (dengan persetujuan)
- Keluarkan peserta, kunci/buka rapat (tolak peserta baru), akhiri rapat untuk semua
- **Ruang tunggu (waiting room)**: saat aktif, peserta baru menunggu dan host mengklik Izinkan/Tolak; mematikan ruang tunggu otomatis memasukkan semua yang menunggu
- Host pindah otomatis ke peserta tertua bila host keluar (antrean ruang tunggu ikut diwariskan ke host baru)

## 📋 Struktur Project

```
zoom-me/
├── package.json          # Skrip root: setup, build, start, dev, lint
├── Dockerfile            # Build production multi-stage (satu image)
├── docker-compose.yml
├── .env.example          # Contoh konfigurasi (PORT, ICE_SERVERS)
├── backend/              # NestJS: REST API + Socket.IO signaling + static serving
│   └── src/
│       ├── main.ts               # Bootstrap; menyajikan frontend/dist (SPA)
│       ├── app.controller.ts     # GET /api/config (ICE servers runtime)
│       └── meeting/
│           ├── meeting.gateway.ts    # Semua event realtime (join, WebRTC, chat, moderasi)
│           ├── meeting.controller.ts # REST /api/meetings
│           └── meeting.service.ts
└── frontend/             # React 19 + Vite + Tailwind 4
    ├── public/           # manifest.webmanifest, icon.svg, sw.js (PWA)
    └── src/
        ├── App.jsx                   # Landing (beranda) + routing + link undangan
        └── components/
            ├── PreJoin.jsx           # Halaman pra-gabung (pratinjau kamera + pilih perangkat)
            └── RoomView.jsx          # Halaman rapat (video, chat, panel, kontrol)
```

## 🚀 Menjalankan (Production — direkomendasikan)

Prasyarat: **Node.js ≥ 18** (atau cukup Docker, lihat bawah).

```bash
npm run setup     # install dependensi backend + frontend
npm run build     # build frontend (vite) + backend (nest)
npm start         # jalankan server di port 3000
```

Buka `http://localhost:3000`. Selesai — frontend, API, dan WebSocket semuanya di port itu.

Ganti port dengan environment variable: `PORT=8080 npm start`.

### 🐳 Docker (jalan di mana pun tanpa install Node)

```bash
docker compose up -d --build
# atau tanpa compose:
docker build -t zoom-me . && docker run -d -p 3000:3000 zoom-me
```

### 🧑‍💻 Mode Development (hot-reload)

Jalankan di dua terminal:

```bash
npm run dev:backend    # NestJS watch-mode di port 3000
npm run dev:frontend   # Vite di port 5173 (proxy /socket.io & /api → 3000)
```

Buka `http://localhost:5173`. Di luar Codespaces, Vite dev memakai HTTPS self-signed (plugin basicSsl) supaya kamera bisa diakses dari perangkat lain di LAN.

## ⚙️ Konfigurasi (environment variable)

Salin `.env.example` menjadi `.env` atau set langsung di platform deploy:

| Variabel | Default | Fungsi |
|---|---|---|
| `PORT` | `3000` | Port server (semua layanan) |
| `ICE_SERVERS` | STUN Google + TURN openrelay | JSON array `RTCIceServer[]` — STUN/TURN sendiri, dibaca frontend saat runtime via `GET /api/config` (tanpa rebuild) |

Contoh:

```bash
ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.domainanda.com:3478","username":"user","credential":"rahasia"}]'
```

> ⚠️ **Penting untuk production:** default TURN memakai relay publik gratis (openrelay.metered.ca) yang tidak dijamin ketersediaannya. Agar video antar jaringan (mis. HP via 4G) selalu tersambung, jalankan TURN sendiri ([coturn](https://github.com/coturn/coturn)) atau layanan TURN berbayar, lalu isi `ICE_SERVERS`.

## 🌐 Catatan Deploy

- **Wajib HTTPS** di internet publik — browser hanya mengizinkan kamera/mikrofon pada halaman aman (pengecualian: `http://localhost`). Pasang reverse proxy (Caddy/Nginx + Let's Encrypt) di depan port aplikasi; pastikan proxy meneruskan **WebSocket** (header `Upgrade`).
- **LAN tanpa internet**: bisa — akses via `http://IP-server:3000` hanya memberi kamera di mesin server sendiri (localhost); untuk perangkat lain gunakan HTTPS (self-signed pun cukup) karena aturan browser di atas.
- **Railway / Render / Fly.io**: deploy repo ini apa adanya — ada `Dockerfile`; platform menyediakan HTTPS otomatis. Set `PORT` sesuai platform bila diminta.
- **GitHub Codespaces**: jalankan production (`npm run build && npm start`), jadikan port 3000 *Public* di tab Ports.
- Data rapat disimpan **di memori** — restart server = semua room hilang. Untuk skala besar (>6–8 peserta per room), arsitektur mesh P2P mulai berat; pertimbangkan SFU (mediasoup/LiveKit) sebagai pengembangan lanjutan.

## 🔌 Ringkasan Event Socket.IO

| Arah | Event | Fungsi |
|---|---|---|
| klien → server | `join-room`, `send-offer/answer/ice-candidate` | Gabung & jabat tangan WebRTC |
| klien → server | `chat-message`, `delete-message`, `reaction`, `raise-hand`, `media-state`, `screen-share` | Kolaborasi |
| host → server | `mute-participant`, `mute-all`, `request-unmute`, `camera-off-participant`, `request-camera-on`, `kick-participant`, `lock-meeting`, `toggle-waiting-room`, `admit-participant`, `deny-participant`, `end-meeting` | Moderasi (divalidasi server) |
| server → klien | `joined`, `user-joined`, `participants-updated`, `host-changed`, `user-disconnected`, `chat-history` | Status room |
| server → klien | `force-mute`, `force-camera-off`, `unmute-requested`, `camera-on-requested`, `kicked`, `meeting-locked`, `waiting-approval`, `join-request`, `join-request-cancelled`, `waiting-room-changed`, `join-denied`, `meeting-ended` | Aksi moderasi & ruang tunggu |

## 🧪 Pengujian

Lint semua: `npm run lint`. Alur realtime (join/host, chat & hapus & riwayat, izin moderasi, kunci rapat, ruang tunggu, dll.) diuji dengan skrip e2e multi-klien Socket.IO — 41 skenario, semuanya lulus pada rilis ini.

## 🛠️ Troubleshooting

| Gejala | Penyebab umum | Solusi |
|---|---|---|
| Kamera/mic tidak diminta | Halaman bukan HTTPS/localhost | Akses via HTTPS (lihat Catatan Deploy) |
| Peserta terlihat tapi video hitam | TURN tidak terjangkau | Set `ICE_SERVERS` dengan TURN sendiri |
| Tombol bagi layar tidak merespons di HP | Browser mobile tidak mendukung `getDisplayMedia` | Berbagi layar dari komputer; HP tetap bisa menonton |
| "Rapat ini telah dikunci host" | Host mengunci rapat | Minta host membuka kunci (panel peserta) |
| Tertahan di "Menunggu izin dari host" | Ruang tunggu aktif | Host membuka panel Peserta lalu klik **Izinkan** |
| Nama perangkat tidak muncul di dropdown | Izin media belum diberikan | Izinkan kamera/mic dulu, lalu buka lagi setelannya |
| Halaman kosong setelah `npm start` | Frontend belum di-build | Jalankan `npm run build` dulu |

---

> 📝 **Kebijakan dokumentasi:** README ini adalah dokumentasi hidup — **setiap perubahan kode (fitur, perbaikan bug, konfigurasi) wajib disertai pembaruan README** pada commit/PR yang sama, tanpa terkecuali.
