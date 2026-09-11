import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtModule } from '@nestjs/jwt';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { LlmModule } from './llm/llm.module.js';
import { AdvancedModule } from './llm/advanced.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { MessageModule } from './message/message.module.js';
import { ConversationModule } from './conversation/conversation.module.js';
import { DocumentModule } from './document/document.module.js';
import { SseModule } from './sse/sse.module.js';

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
    SseModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
