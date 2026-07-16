// src/app.module.ts
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MeetingController } from './meeting/meeting.controller';
import { MeetingService } from './meeting/meeting.service';
import { MeetingGateway } from './meeting/meeting.gateway'; // 1. Import gateway yang telah dibuat

@Module({
  imports: [],
  controllers: [AppController, MeetingController],
  providers: [
    AppService,
    MeetingService,
    MeetingGateway, // 2. Daftarkan di sini agar server WebSocket aktif saat NestJS running
  ],
})
export class AppModule {}
