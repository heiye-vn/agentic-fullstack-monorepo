import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CommonStatus, PermissionType, AuditStatus } from '@prisma/client';

describe('RBAC Database Schema Integration Test', () => {
  let prisma: PrismaService;
  const testSuffix = Date.now().toString();

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    // 清理测试数据
    await prisma.operationLog.deleteMany({ where: { username: `user_${testSuffix}` } });
    await prisma.loginLog.deleteMany({ where: { username: `user_${testSuffix}` } });
    await prisma.refreshToken.deleteMany({ where: { user: { username: `user_${testSuffix}` } } });
    await prisma.userRole.deleteMany({ where: { user: { username: `user_${testSuffix}` } } });
    await prisma.rolePermission.deleteMany({ where: { role: { code: `role_${testSuffix}` } } });
    await prisma.user.deleteMany({ where: { username: `user_${testSuffix}` } });
    await prisma.role.deleteMany({ where: { code: `role_${testSuffix}` } });
    await prisma.permission.deleteMany({ where: { code: `perm:${testSuffix}` } });
    await prisma.department.deleteMany({ where: { code: `dept_${testSuffix}` } });
    await prisma.$disconnect();
  });

  it('1. should create department with tree hierarchy', async () => {
    const parentDept = await prisma.department.create({
      data: {
        name: '总部机构',
        code: `dept_${testSuffix}`,
        status: CommonStatus.ACTIVE,
      },
    });
    expect(parentDept.id).toBeDefined();
    expect(parentDept.deletedAt).toBeNull();
  });

  it('2. should create permission resource', async () => {
    const perm = await prisma.permission.create({
      data: {
        name: '用户查询',
        code: `perm:${testSuffix}`,
        type: PermissionType.BUTTON,
        status: CommonStatus.ACTIVE,
      },
    });
    expect(perm.id).toBeDefined();
    expect(perm.code).toBe(`perm:${testSuffix}`);
  });

  it('3. should create role and assign permission', async () => {
    const perm = await prisma.permission.findUniqueOrThrow({
      where: { code: `perm:${testSuffix}` },
    });

    const role = await prisma.role.create({
      data: {
        name: '测试管理员',
        code: `role_${testSuffix}`,
        status: CommonStatus.ACTIVE,
        rolePermissions: {
          create: [{ permissionId: perm.id }],
        },
      },
      include: {
        rolePermissions: true,
      },
    });

    expect(role.id).toBeDefined();
    expect(role.rolePermissions.length).toBe(1);
    expect(role.rolePermissions[0].permissionId).toBe(perm.id);
  });

  it('4. should create user, associate department & assign role', async () => {
    const dept = await prisma.department.findUniqueOrThrow({
      where: { code: `dept_${testSuffix}` },
    });
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: `role_${testSuffix}` },
    });

    const user = await prisma.user.create({
      data: {
        username: `user_${testSuffix}`,
        passwordHash: 'argon2id_mock_hash_string',
        realName: '测试员',
        departmentId: dept.id,
        userRoles: {
          create: [{ roleId: role.id }],
        },
      },
      include: {
        department: true,
        userRoles: {
          include: {
            role: true,
          },
        },
      },
    });

    expect(user.id).toBeDefined();
    expect(user.department?.name).toBe('总部机构');
    expect(user.userRoles.length).toBe(1);
    expect(user.userRoles[0].role.code).toBe(`role_${testSuffix}`);
    expect(user.tokenVersion).toBe(0);
  });

  it('5. should record login log and operation log', async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { username: `user_${testSuffix}` },
    });

    const loginLog = await prisma.loginLog.create({
      data: {
        username: user.username,
        ip: '127.0.0.1',
        userAgent: 'Vitest/4.1',
        status: AuditStatus.SUCCESS,
        message: '登录成功',
      },
    });
    expect(loginLog.id).toBeDefined();

    const opLog = await prisma.operationLog.create({
      data: {
        userId: user.id,
        username: user.username,
        module: '用户管理',
        action: '创建用户',
        method: 'POST',
        path: '/api/v1/users',
        status: AuditStatus.SUCCESS,
        duration: 25,
      },
    });
    expect(opLog.id).toBeDefined();
  });
});
