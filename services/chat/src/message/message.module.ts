import { Module } from '@nestjs/common';
import { MessageService } from './message.service.js';

@Module({
  providers: [MessageService],
  exports: [MessageService],
})
export class MessageModule {}
