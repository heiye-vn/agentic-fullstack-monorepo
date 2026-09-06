import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { RolesModule } from './modules/roles/roles.module.js';
import { PermissionsModule } from './modules/permissions/permissions.module.js';
import { DepartmentsModule } from './modules/departments/departments.module.js';
import { AuditModule } from './modules/audit/audit.module.js';

@Module({
  imports: [
    // 限流模块：为 AuthController 中的 @UseGuards(ThrottlerGuard) 提供 DI 依赖
    // （options/storage token），未注册会导致服务启动即抛 UnknownDependenciesException。
    // 此处注册全局兜底阈值，login/refresh 路由通过 @Throttle 装饰器单独收紧。
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
      },
    ]),
    PrismaModule,
    AuthModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    DepartmentsModule,
    AuditModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
