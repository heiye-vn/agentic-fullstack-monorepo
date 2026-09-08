import { Module } from '@nestjs/common';
import { LlmController } from './llm.controller.js';
import { LlmService } from './llm.service.js';
import { RequirementService } from './requirement.service.js';

@Module({
  controllers: [LlmController],
  providers: [LlmService, RequirementService],
  exports: [LlmService, RequirementService],
})
export class LlmModule {}

