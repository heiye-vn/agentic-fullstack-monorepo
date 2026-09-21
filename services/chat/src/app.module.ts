import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtModule } from '@nestjs/jwt';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { LlmModule } from './llm/llm.module.js';
import { AdvancedModule } from './llm/advanced.module.js';
import { UIProtocolModule } from './llm/ui-protocol/ui-protocol.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { MessageModule } from './message/message.module.js';
import { ConversationModule } from './conversation/conversation.module.js';
import { DocumentModule } from './document/document.module.js';
import { SseModule } from './sse/sse.module.js';
import { ArtifactModule } from './artifact/artifact.module.js';
import { ModelConfigModule } from './model-config/model-config.module.js';
import { TraceMiddleware, UsageSinkBootstrap } from './observability/index.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    JwtModule.register({
      global: true,
      secret:
        process.env.JWT_SECRET ||
        'autix_rbac_jwt_secret_key_2026_super_secure',
    }),
    PrismaModule,
    MessageModule,
    ConversationModule,
    DocumentModule,
    LlmModule,
    AdvancedModule,
    UIProtocolModule,
    SseModule,
    ArtifactModule,
    ModelConfigModule,
  ],
  controllers: [AppController],
  providers: [AppService, UsageSinkBootstrap],
})
export class AppModule implements NestModule {
  /**
   * 第十六章：在请求入口建立 traceId 上下文（ALS），让同一次请求的
   * HTTP access 日志、LangGraph 节点日志、LLM 调用日志共用同一个 traceId。
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceMiddleware).forRoutes('*');
  }
}
