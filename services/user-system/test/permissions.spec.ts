import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PermissionsService } from '../src/modules/permissions/permissions.service.js';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { PermissionType } from '@prisma/client';

describe('Permissions Module Integration Test', () => {
  let prisma: PrismaService;
  let permissionsService: PermissionsService;
  const suffix = Date.now().toString();

  let rootCatalogId: string;
  let subMenuId: string;
  let actionButtonId: string;

  let testRole: any;
  let testUser: any;
  let superAdminUser: any;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    permissionsService = new PermissionsService(prisma);

    // 准备普通角色与测试用户
    testRole = await prisma.role.create({
      data: {
        name: `业务角色_${suffix}`,
        code: `role_p_${suffix}`,
      },
    });

    testUser = await prisma.user.create({
      data: {
        username: `user_p_${suffix}`,
        passwordHash: 'placeholder',
        realName: '普通权限用户',
        userRoles: {
          create: [{ roleId: testRole.id }],
        },
      },
    });

    // 准备超管角色与超管用户
    const superRole = await prisma.role.upsert({
      where: { code: 'super_admin' },
      update: {},
      create: {
        name: '超级管理员',
        code: 'super_admin',
      },
    });

    superAdminUser = await prisma.user.create({
      data: {
        username: `super_u_${suffix}`,
        passwordHash: 'placeholder',
        realName: '超级管理员用户',
        userRoles: {
          create: [{ roleId: superRole.id }],
        },
      },
    });
  });

  afterAll(async () => {
    // 清理测试数据
    await prisma.userRole.deleteMany({
      where: { user: { username: { in: [`user_p_${suffix}`, `super_u_${suffix}`] } } },
    });
    await prisma.user.deleteMany({
      where: { username: { in: [`user_p_${suffix}`, `super_u_${suffix}`] } },
    });
    await prisma.rolePermission.deleteMany({
      where: { roleId: testRole.id },
    });
    await prisma.role.deleteMany({
      where: { id: testRole.id },
    });

    // 递归清理创建的权限节点
    if (actionButtonId) await prisma.permission.deleteMany({ where: { id: actionButtonId } });
    if (subMenuId) await prisma.permission.deleteMany({ where: { id: subMenuId } });
    if (rootCatalogId) await prisma.permission.deleteMany({ where: { id: rootCatalogId } });

    await prisma.$disconnect();
  });

  it('1. should create catalog, menu, and button in a hierarchy', async () => {
    // 1. 根目录
    const catalog = await permissionsService.create({
      name: `系统管理_${suffix}`,
      code: `sys_${suffix}`,
      type: PermissionType.CATALOG,
      icon: 'settings',
      sortOrder: 1,
    });
    rootCatalogId = catalog.id;

    // 2. 二级菜单
    const menu = await permissionsService.create({
      name: `用户管理_${suffix}`,
      code: `sys:user:menu_${suffix}`,
      type: PermissionType.MENU,
      parentId: rootCatalogId,
      path: `/system/users_${suffix}`,
      component: 'system/users',
      sortOrder: 1,
    });
    subMenuId = menu.id;

    // 3. 按钮
    const button = await permissionsService.create({
      name: `新增用户_${suffix}`,
      code: `sys:user:create_${suffix}`,
      type: PermissionType.BUTTON,
      parentId: subMenuId,
      sortOrder: 1,
    });
    actionButtonId = button.id;

    expect(catalog.id).toBeDefined();
    expect(menu.parentId).toBe(catalog.id);
    expect(button.parentId).toBe(menu.id);
  });

  it('2. should reject duplicate permission code', async () => {
    await expect(
      permissionsService.create({
        name: '重复权限',
        code: `sys_${suffix}`,
        type: PermissionType.CATALOG,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('3. should build nested permission tree with children', async () => {
    const tree = await permissionsService.findTree();
    const rootNode = tree.find((t) => t.id === rootCatalogId);

    expect(rootNode).toBeDefined();
    expect(rootNode?.children.length).toBeGreaterThanOrEqual(1);

    const menuNode = rootNode?.children.find((c) => c.id === subMenuId);
    expect(menuNode).toBeDefined();
    expect(menuNode?.children.length).toBeGreaterThanOrEqual(1);

    const buttonNode = menuNode?.children.find((b) => b.id === actionButtonId);
    expect(buttonNode).toBeDefined();
  });

  it('4. should return authorized permissions and menu tree for normal user', async () => {
    // 授权二级菜单与按钮给 testRole
    await prisma.rolePermission.createMany({
      data: [
        { roleId: testRole.id, permissionId: rootCatalogId },
        { roleId: testRole.id, permissionId: subMenuId },
        { roleId: testRole.id, permissionId: actionButtonId },
      ],
    });

    const res = await permissionsService.getCurrentUserPermissions(testUser.id);
    expect(res.permissions).toContain(`sys:user:create_${suffix}`);
    expect(res.permissions).not.toContain('*:*:*'); // 普通用户无通配

    // 检查菜单树仅包含目录和菜单，不包含纯按钮
    const foundMenu = res.menus.find((m) => m.id === rootCatalogId);
    expect(foundMenu).toBeDefined();
    expect(foundMenu?.children.some((c) => c.id === subMenuId)).toBe(true);
  });

  it('5. should return wildcard *:*:* and all active menus for super admin', async () => {
    const res = await permissionsService.getCurrentUserPermissions(superAdminUser.id);
    expect(res.permissions).toContain('*:*:*');
    expect(res.menus.some((m) => m.id === rootCatalogId)).toBe(true);
  });

  it('6. should reject self-referential parentId update', async () => {
    await expect(
      permissionsService.update(rootCatalogId, { parentId: rootCatalogId }),
    ).rejects.toThrow(BadRequestException);
  });

  it('7. should reject deleting a parent node that has children', async () => {
    await expect(permissionsService.remove(rootCatalogId)).rejects.toThrow(
      BadRequestException,
    );
  });
});
