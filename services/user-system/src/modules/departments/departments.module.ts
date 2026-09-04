import { Module } from '@nestjs/common';
import { DepartmentsService } from './departments.service.js';
import { DepartmentsController } from './departments.controller.js';

@Module({
  controllers: [DepartmentsController],
  providers: [DepartmentsService],
  exports: [DepartmentsService],
})
export class DepartmentsModule {}
