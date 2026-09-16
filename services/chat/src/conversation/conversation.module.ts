import { Module, forwardRef } from '@nestjs/common';
import { ConversationService } from './conversation.service.js';
import { ConversationController } from './conversation.controller.js';
import { ChatStreamService } from './chat-stream.service.js';
import { UIActionParser } from './ui-action.parser.js';
import { MessageModule } from '../message/message.module.js';
import { AdvancedModule } from '../llm/advanced.module.js';
import { UIProtocolModule } from '../llm/ui-protocol/ui-protocol.module.js';
import { ModelConfigModule } from '../model-config/model-config.module.js';
import { DocumentModule } from '../document/document.module.js';
import { ArtifactModule } from '../artifact/artifact.module.js';

@Module({
  imports: [
    MessageModule,
    AdvancedModule,
    UIProtocolModule,
    ModelConfigModule,
    DocumentModule,
    // ArtifactModule 的控制器反过来要注入 ConversationService 做归属校验，
    // 两边互引成环，必须用 forwardRef 打破初始化时序死锁（对侧同样加了）。
    forwardRef(() => ArtifactModule),
  ],
  controllers: [ConversationController],
  providers: [ConversationService, ChatStreamService, UIActionParser],
  exports: [ConversationService, ChatStreamService],
})
export class ConversationModule {}
