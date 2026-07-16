import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
// basicSsl hanya dipakai di luar Codespaces (untuk akses kamera via HTTPS di LAN).
// Di Codespaces, forwarder GitHub sudah menyediakan HTTPS sehingga SSL lokal justru bentrok.
//
// MODE PRODUCTION: jalankan `npm run build` — hasilnya (folder dist) disajikan
// langsung oleh backend NestJS di port 3000 (frontend + API + WebSocket satu port).
//
// MODE DEV: `npm run dev` di port 5173; request /socket.io & /api diproxy ke
// backend port 3000 sehingga kode frontend tetap cukup memakai io() satu origin.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(process.env.CODESPACE_NAME ? [] : [basicSsl()])
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:3000',
      },
    },
  }
})
