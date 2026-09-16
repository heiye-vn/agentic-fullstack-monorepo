import { Module, forwardRef } from '@nestjs/common';
import { ArtifactController } from './artifact.controller.js';
import { ArtifactService } from './artifact.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ConversationModule } from '../conversation/conversation.module.js';

@Module({
  // ConversationModule 也要注入 ArtifactService 来生成会话产物，双向依赖 → forwardRef
  imports: [PrismaModule, forwardRef(() => ConversationModule)],
  controllers: [ArtifactController],
  providers: [ArtifactService],
  exports: [ArtifactService],
})
export class ArtifactModule {}
