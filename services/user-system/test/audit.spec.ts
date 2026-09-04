import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { AuditStatus } from '@prisma/client';

describe('Audit Module Integration Test', () => {
  let prisma: PrismaService;
  let auditService: AuditService;
  const suffix = Date.now().toString();

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    auditService = new AuditService(prisma);

    // 预置一条登录日志
    await prisma.loginLog.create({
      data: {
        username: `audit_user_${suffix}`,
        ip: '192.168.1.100',
        userAgent: 'Mozilla/5.0 TestBrowser',
        status: AuditStatus.SUCCESS,
        message: '登录成功',
      },
    });

    // 预置一条操作日志
    await prisma.operationLog.create({
      data: {
        username: `audit_user_${suffix}`,
        module: '用户管理',
        action: 'POST /api/v1/users',
        method: 'POST',
        path: '/api/v1/users',
        params: JSON.stringify({ username: 'newbie', password: '******' }), // 验证脱敏存储
        status: AuditStatus.SUCCESS,
        duration: 42,
      },
    });
  });

  afterAll(async () => {
    await prisma.loginLog.deleteMany({ where: { username: `audit_user_${suffix}` } });
    await prisma.operationLog.deleteMany({ where: { username: `audit_user_${suffix}` } });
    await prisma.$disconnect();
  });

  it('1. should query login logs with pagination and username filter', async () => {
    const res = await auditService.findLoginLogs({
      page: 1,
      pageSize: 10,
      username: `audit_user_${suffix}`,
    });

    expect(res.items.length).toBe(1);
    expect(res.items[0].username).toBe(`audit_user_${suffix}`);
    expect(res.items[0].status).toBe(AuditStatus.SUCCESS);
  });

  it('2. should query operation logs with module and parameter masking check', async () => {
    const res = await auditService.findOperationLogs({
      page: 1,
      pageSize: 10,
      username: `audit_user_${suffix}`,
      module: '用户管理',
    });

    expect(res.items.length).toBe(1);
    const op = res.items[0];
    expect(op.method).toBe('POST');
    expect(op.duration).toBe(42);
    expect(op.params).toContain('******'); // 核心安全断言：密码字段被有效脱敏！
  });
});
