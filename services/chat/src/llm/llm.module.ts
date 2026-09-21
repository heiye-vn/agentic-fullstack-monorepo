import { Module } from '@nestjs/common';
import { LlmController } from './llm.controller.js';
import { LlmService } from './llm.service.js';
import { RequirementService } from './requirement.service.js';
import { TokenUsageService } from './cost/token-usage.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Module({
  controllers: [LlmController],
  providers: [
    LlmService,
    RequirementService,
    // 第十六章：把第十章的 Token 计量服务纳入 DI，供 UsageSinkBootstrap 接到 LLM 回调出口上
    {
      provide: TokenUsageService,
      useFactory: (prisma: PrismaService) => new TokenUsageService(prisma),
      inject: [PrismaService],
    },
  ],
  exports: [LlmService, RequirementService, TokenUsageService],
})
export class LlmModule {}
