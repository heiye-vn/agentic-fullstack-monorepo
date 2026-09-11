import { Module } from '@nestjs/common';
import { ConversationService } from './conversation.service.js';
import { ConversationController } from './conversation.controller.js';
import { MessageModule } from '../message/message.module.js';
import { AdvancedModule } from '../llm/advanced.module.js';

@Module({
  imports: [MessageModule, AdvancedModule],
  controllers: [ConversationController],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
