# Aturan Project zoom-me

- **WAJIB, tanpa terkecuali:** setiap perubahan kode (fitur, perbaikan bug, konfigurasi, event socket, cara deploy) harus disertai pembaruan `README.md` pada bagian yang relevan, dalam perubahan yang sama.
- Mode production = satu port: backend NestJS menyajikan `frontend/dist` + REST `/api` + Socket.IO dari port yang sama (`npm run build && npm start` dari root).
- Semua aksi moderasi host harus divalidasi **di server** (meeting.gateway.ts), jangan hanya disembunyikan di UI.
- Bahasa UI dan komentar kode: Bahasa Indonesia.
- Setelah perubahan selesai & teruji, **sarankan commit git** kepada user — pekerjaan yang tidak di-commit pernah hilang saat working tree ter-reset (16 Jul 2026).
