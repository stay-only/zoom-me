import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { join } from 'path';
import { existsSync } from 'fs';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Enable CORS (aman karena API tidak memakai cookie/kredensial sensitif)
  app.enableCors({ origin: '*' });

  // ---- SAJIKAN FRONTEND (hasil `vite build`) DARI SERVER YANG SAMA ----
  // Dengan satu origin: tidak perlu CORS antar port, cukup SATU port publik,
  // dan Socket.IO otomatis terhubung ke origin halaman.
  const candidates = [
    join(__dirname, '..', '..', 'frontend', 'dist'),
    join(__dirname, '..', '..', '..', 'frontend', 'dist'),
    join(process.cwd(), '..', 'frontend', 'dist'),
  ];
  const clientDist = candidates.find((p) => existsSync(p));
  if (clientDist) {
    app.useStaticAssets(clientDist);
    // SPA fallback: semua rute non-API/non-socket diarahkan ke index.html
    app.use((req: Request, res: Response, next: NextFunction) => {
      const isApi =
        req.path.startsWith('/api') || req.path.startsWith('/socket.io');
      if (req.method === 'GET' && !isApi && !req.path.includes('.')) {
        res.sendFile(join(clientDist, 'index.html'));
      } else {
        next();
      }
    });
  } else {
    console.warn(
      'Frontend build tidak ditemukan — jalankan "npm run build" di folder frontend untuk mode production.',
    );
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Aplikasi berjalan di port ${port} (HTTP + WebSocket satu port)`);
}
void bootstrap();
