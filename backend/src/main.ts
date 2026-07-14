import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Enable CORS untuk semua origins (bisa diubah ke specific origins nanti)
  app.enableCors({
    origin: '*',
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
  console.log(`Application is running on: ${process.env.PORT ?? 3000}`);
}
bootstrap();
