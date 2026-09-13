import { Module } from '@nestjs/common';
import { UIChatController } from './ui-chat.controller.js';
import { UIResponseService } from './ui-response.service.js';
import { UIFlowService } from './ui-flow.service.js';

@Module({
  controllers: [UIChatController],
  providers: [UIResponseService, UIFlowService],
  exports: [UIResponseService, UIFlowService],
})
export class UIProtocolModule {}
