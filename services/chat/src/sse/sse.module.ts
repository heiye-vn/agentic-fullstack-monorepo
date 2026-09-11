import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SseService } from './sse.service.js';
import { SseController } from './sse.controller.js';
import { TaskEventController } from './task-event.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [SseController, TaskEventController],
  providers: [SseService],
  exports: [SseService],
})
export class SseModule {}
