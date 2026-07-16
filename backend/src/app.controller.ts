import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Konfigurasi runtime untuk frontend. ICE_SERVERS diisi lewat environment
  // variable (JSON) saat deploy — mis. TURN server sendiri — tanpa perlu
  // rebuild frontend. Kosong berarti frontend memakai default bawaannya.
  @Get('api/config')
  getConfig(): { iceServers: unknown } {
    let iceServers: unknown = null;
    const raw = process.env.ICE_SERVERS;
    if (raw) {
      try {
        iceServers = JSON.parse(raw);
      } catch {
        console.warn('ICE_SERVERS bukan JSON valid — diabaikan');
      }
    }
    return { iceServers };
  }
}
