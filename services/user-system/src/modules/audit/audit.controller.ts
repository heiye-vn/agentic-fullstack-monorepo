import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { QueryLogDto } from './dto/query-log.dto.js';
import { JwtAuthGuard, PermissionsGuard, RequirePermissions } from '../../common/index.js';

@Controller('api/v1/audit')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('login-logs')
  @RequirePermissions('sys:log:list')
  async getLoginLogs(@Query() query: QueryLogDto) {
    return this.auditService.findLoginLogs(query);
  }

  @Get('operation-logs')
  @RequirePermissions('sys:log:list')
  async getOperationLogs(@Query() query: QueryLogDto) {
    return this.auditService.findOperationLogs(query);
  }
}
