import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RolesService } from '../src/modules/roles/roles.service.js';
import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { PermissionType } from '@prisma/client';

describe('Roles Module Integration Test', () => {
  let prisma: PrismaService;
  let rolesService: RolesService;
  const suffix = Date.now().toString();

  let testPerm1: any;
  let testPerm2: any;
  let testUser: any;
  let createdRoleId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    rolesService = new RolesService(prisma);

    // 准备测试权限节点
    testPerm1 = await prisma.permission.create({
      data: {
        name: `权限1_${suffix}`,
        code: `sys:test1:${suffix}`,
        type: PermissionType.BUTTON,
      },
    });

    testPerm2 = await prisma.permission.create({
      data: {
        name: `权限2_${suffix}`,
        code: `sys:test2:${suffix}`,
        type: PermissionType.BUTTON,
      },
    });

    // 准备测试用户
    testUser = await prisma.user.create({
      data: {
        username: `role_user_${suffix}`,
        passwordHash: 'hash_placeholder',
        realName: '角色联动测试用户',
      },
    });
  });

  afterAll(async () => {
    // 清理测试数据
    if (createdRoleId) {
      await prisma.userRole.deleteMany({ where: { roleId: createdRoleId } });
      await prisma.rolePermission.deleteMany({ where: { roleId: createdRoleId } });
      await prisma.role.deleteMany({ where: { id: createdRoleId } });
    }
    await prisma.user.deleteMany({ where: { id: testUser.id } });
    await prisma.permission.deleteMany({
      where: { code: { in: [`sys:test1:${suffix}`, `sys:test2:${suffix}`] } },
    });
    // 清理可能遗留的 super_admin 软删角色（如果有）
    await prisma.role.deleteMany({ where: { code: `role_${suffix}` } });
    await prisma.$disconnect();
  });

  it('1. should create a new role and reject duplicate code', async () => {
    const role = await rolesService.create({
      name: `运营专员_${suffix}`,
      code: `role_${suffix}`,
      description: '负责平台内容运营',
      sortOrder: 10,
    });

    expect(role.id).toBeDefined();
    expect(role.code).toBe(`role_${suffix}`);
    createdRoleId = role.id;

    // 查重验证
    await expect(
      rolesService.create({
        name: `重复角色_${suffix}`,
        code: `role_${suffix}`,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('2. should query roles with pagination and keyword filtering', async () => {
    const res = await rolesService.findAll({
      page: 1,
      pageSize: 10,
      keyword: `运营专员_${suffix}`,
    });

    expect(res.items.length).toBeGreaterThanOrEqual(1);
    const found = res.items.find((r) => r.id === createdRoleId);
    expect(found).toBeDefined();
    expect(found?.code).toBe(`role_${suffix}`);
  });

  it('3. should update role basic info', async () => {
    const updated = await rolesService.update(createdRoleId, {
      name: `高级运营专员_${suffix}`,
      description: '负责核心活动运营',
    });

    expect(updated.name).toBe(`高级运营专员_${suffix}`);
    expect(updated.description).toBe('负责核心活动运营');
  });

  it('4. should assign permissions to role and increment tokenVersion for users with this role', async () => {
    // 首先为测试用户绑定该角色
    await prisma.userRole.create({
      data: {
        userId: testUser.id,
        roleId: createdRoleId,
      },
    });

    const userBefore = await prisma.user.findUniqueOrThrow({
      where: { id: testUser.id },
    });
    const versionBefore = userBefore.tokenVersion;

    // 为角色分配权限
    const assignedRole = await rolesService.assignPermissions(createdRoleId, {
      permissionIds: [testPerm1.id, testPerm2.id],
    });

    expect(assignedRole.permissions.length).toBe(2);
    expect(assignedRole.permissions.some((p) => p.id === testPerm1.id)).toBe(true);

    // 核心断言：关联用户的 tokenVersion 必须自增，确保旧 Token 失效！
    const userAfter = await prisma.user.findUniqueOrThrow({
      where: { id: testUser.id },
    });
    expect(userAfter.tokenVersion).toBe(versionBefore + 1);
  });

  it('5. should protect built-in super_admin role from deletion', async () => {
    // 确保存在一个 super_admin 记录用于测试保护
    const superAdminRole = await prisma.role.upsert({
      where: { code: 'super_admin' },
      update: {},
      create: {
        name: '超级管理员',
        code: 'super_admin',
        description: '系统内置最高权限',
      },
    });

    await expect(rolesService.remove(superAdminRole.id)).rejects.toThrow(BadRequestException);
  });

  it('6. should soft delete custom role and unlink from users', async () => {
    await rolesService.remove(createdRoleId);

    const deletedRole = await prisma.role.findUnique({ where: { id: createdRoleId } });
    expect(deletedRole?.deletedAt).not.toBeNull();

    // 检查关联用户关系已解除
    const userRoles = await prisma.userRole.findMany({ where: { roleId: createdRoleId } });
    expect(userRoles.length).toBe(0);

    // 查询详情抛出 404
    await expect(rolesService.findById(createdRoleId)).rejects.toThrow(NotFoundException);
  });
});
