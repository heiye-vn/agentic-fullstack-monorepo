import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { QueryLogDto } from './dto/query-log.dto.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 分页查询登录审计日志
   */
  async findLoginLogs(query: QueryLogDto) {
    const { page = 1, pageSize = 10, username, status } = query;
    const skip = (page - 1) * pageSize;

    const where: Prisma.LoginLogWhereInput = {
      ...(username ? { username: { contains: username, mode: 'insensitive' } } : {}),
      ...(status ? { status } : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.loginLog.count({ where }),
      this.prisma.loginLog.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { loginAt: 'desc' },
      }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 分页查询操作审计流水
   */
  async findOperationLogs(query: QueryLogDto) {
    const { page = 1, pageSize = 10, username, status, module } = query;
    const skip = (page - 1) * pageSize;

    const where: Prisma.OperationLogWhereInput = {
      ...(username ? { username: { contains: username, mode: 'insensitive' } } : {}),
      ...(status ? { status } : {}),
      ...(module ? { module: { contains: module, mode: 'insensitive' } } : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.operationLog.count({ where }),
      this.prisma.operationLog.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}
