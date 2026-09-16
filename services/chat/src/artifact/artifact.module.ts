import { Module } from '@nestjs/common';
import { ArtifactController } from './artifact.controller.js';
import { ArtifactService } from './artifact.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ConversationModule } from '../conversation/conversation.module.js';

@Module({
  imports: [PrismaModule, ConversationModule],
  controllers: [ArtifactController],
  providers: [ArtifactService],
  exports: [ArtifactService],
})
export class ArtifactModule {}
