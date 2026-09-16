import { Module } from '@nestjs/common';
import { ModelConfigController } from './model-config.controller.js';
import { ModelConfigService } from './model-config.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [ModelConfigController],
  providers: [ModelConfigService],
  exports: [ModelConfigService],
})
export class ModelConfigModule {}
