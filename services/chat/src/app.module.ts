import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { LlmModule } from './llm/llm.module.js';
import { AdvancedModule } from './llm/advanced.module.js';

@Module({
  imports: [LlmModule, AdvancedModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
