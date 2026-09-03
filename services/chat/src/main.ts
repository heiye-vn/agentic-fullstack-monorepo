import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: ['http://localhost:3002'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });
  const port = process.env.PORT ?? 4001;
  await app.listen(port);
  console.log(`Chat service is running on http://localhost:${port}`);
}
await bootstrap();
