import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { PrismaService } from './prisma/prisma.service.js';
import { AuditLogInterceptor } from './common/index.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const prisma = app.get(PrismaService);
  app.useGlobalInterceptors(new AuditLogInterceptor(prisma));

  app.enableCors({
    origin: ['http://localhost:3100', 'http://localhost:3003', 'http://localhost:3002'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
  });

  const port = process.env.PORT ?? 4002;
  await app.listen(port);
  console.log(`🚀 User & RBAC service is running on http://localhost:${port}`);
}

await bootstrap();
