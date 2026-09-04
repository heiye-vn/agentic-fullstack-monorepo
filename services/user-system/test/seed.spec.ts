import { describe, it, expect } from 'vitest';
import { PrismaClient, PermissionType } from '@prisma/client';
import * as argon2 from 'argon2';

describe('Seed Database RBAC Data', () => {
  it('should successfully seed initial departments, roles, permissions and users', async () => {
    const prisma = new PrismaClient();
    await prisma.$connect();

    // 1. 初始化部门 (唯一键是 code)
    const headDept = await prisma.department.upsert({
      where: { code: 'dept_head' },
      update: {},
      create: {
        code: 'dept_head',
        name: '集团总部',
        leader: '总经办',
        phone: '010-88888888',
        sortOrder: 1,
      },
    });

    const devDept = await prisma.department.upsert({
      where: { code: 'dept_dev' },
      update: {},
      create: {
        code: 'dept_dev',
        name: '研发技术中心',
        parentId: headDept.id,
        leader: '技术总监',
        phone: '010-88888881',
        sortOrder: 2,
      },
    });

    const opsDept = await prisma.department.upsert({
      where: { code: 'dept_ops' },
      update: {},
      create: {
        code: 'dept_ops',
        name: '运维交付中心',
        parentId: headDept.id,
        leader: '运维主管',
        phone: '010-88888882',
        sortOrder: 3,
      },
    });

    // 2. 初始化角色 (唯一键是 code)
    const superAdminRole = await prisma.role.upsert({
      where: { code: 'super_admin' },
      update: {},
      create: {
        name: '超级管理员',
        code: 'super_admin',
        description: '拥有系统所有资源的最高完全支配权，防删除锁定',
      },
    });

    const adminRole = await prisma.role.upsert({
      where: { code: 'admin' },
      update: {},
      create: {
        name: '系统运维主管',
        code: 'admin',
        description: '负责用户、组织架构日常运维与权限资源配置',
      },
    });

    // 3. 初始化全量系统权限树 (唯一键是 code)
    const sysRoot = await prisma.permission.upsert({
      where: { code: 'sys' },
      update: {},
      create: {
        name: '系统管理',
        code: 'sys',
        type: PermissionType.MENU,
        path: '/system',
        sortOrder: 1,
      },
    });

    const modules = [
      {
        name: '用户管理',
        code: 'sys:user',
        path: '/users',
        children: [
          { name: '用户查询', code: 'sys:user:list', type: PermissionType.BUTTON },
          { name: '用户创建', code: 'sys:user:create', type: PermissionType.BUTTON },
          { name: '用户编辑', code: 'sys:user:update', type: PermissionType.BUTTON },
          { name: '用户删除', code: 'sys:user:delete', type: PermissionType.BUTTON },
          { name: '分配角色', code: 'sys:user:assign', type: PermissionType.BUTTON },
        ],
      },
      {
        name: '角色管理',
        code: 'sys:role',
        path: '/roles',
        children: [
          { name: '角色查询', code: 'sys:role:list', type: PermissionType.BUTTON },
          { name: '角色创建', code: 'sys:role:create', type: PermissionType.BUTTON },
          { name: '角色编辑', code: 'sys:role:update', type: PermissionType.BUTTON },
          { name: '角色删除', code: 'sys:role:delete', type: PermissionType.BUTTON },
          { name: '分配权限', code: 'sys:role:assign', type: PermissionType.BUTTON },
        ],
      },
      {
        name: '权限配置中心',
        code: 'sys:permission',
        path: '/permission-center',
        children: [
          { name: '权限查询', code: 'sys:permission:list', type: PermissionType.BUTTON },
          { name: '权限创建', code: 'sys:permission:create', type: PermissionType.BUTTON },
          { name: '权限编辑', code: 'sys:permission:update', type: PermissionType.BUTTON },
          { name: '权限删除', code: 'sys:permission:delete', type: PermissionType.BUTTON },
        ],
      },
      {
        name: '部门架构',
        code: 'sys:dept',
        path: '/departments',
        children: [
          { name: '部门查询', code: 'sys:dept:list', type: PermissionType.BUTTON },
          { name: '部门创建', code: 'sys:dept:create', type: PermissionType.BUTTON },
          { name: '部门修改', code: 'sys:dept:update', type: PermissionType.BUTTON },
          { name: '部门删除', code: 'sys:dept:delete', type: PermissionType.BUTTON },
        ],
      },
      {
        name: '审计中心',
        code: 'sys:log',
        path: '/logs',
        children: [
          { name: '日志查询', code: 'sys:log:list', type: PermissionType.BUTTON },
        ],
      },
    ];

    const allPermIds: string[] = [sysRoot.id];

    for (let i = 0; i < modules.length; i++) {
      const mod = modules[i];
      const modNode = await prisma.permission.upsert({
        where: { code: mod.code },
        update: { parentId: sysRoot.id },
        create: {
          name: mod.name,
          code: mod.code,
          type: PermissionType.MENU,
          path: mod.path,
          parentId: sysRoot.id,
          sortOrder: (i + 1) * 10,
        },
      });
      allPermIds.push(modNode.id);

      for (let j = 0; j < mod.children.length; j++) {
        const btn = mod.children[j];
        const btnNode = await prisma.permission.upsert({
          where: { code: btn.code },
          update: { parentId: modNode.id },
          create: {
            name: btn.name,
            code: btn.code,
            type: btn.type,
            parentId: modNode.id,
            sortOrder: (j + 1) * 10,
          },
        });
        allPermIds.push(btnNode.id);
      }
    }

    // 4. 将全量权限赋予 superAdminRole 和 adminRole
    for (const permId of allPermIds) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: superAdminRole.id,
            permissionId: permId,
          },
        },
        update: {},
        create: {
          roleId: superAdminRole.id,
          permissionId: permId,
        },
      });

      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: adminRole.id,
            permissionId: permId,
          },
        },
        update: {},
        create: {
          roleId: adminRole.id,
          permissionId: permId,
        },
      });
    }

    // 5. 初始化超级管理员账号 admin / Admin123!
    const adminPasswordHash = await argon2.hash('Admin123!');
    const adminUser = await prisma.user.upsert({
      where: { username: 'admin' },
      update: {
        passwordHash: adminPasswordHash,
        departmentId: devDept.id,
      },
      create: {
        username: 'admin',
        passwordHash: adminPasswordHash,
        realName: '超级管理员',
        email: 'admin@autix.com',
        phone: '18888888888',
        departmentId: devDept.id,
      },
    });

    // 绑定超管角色
    await prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId: adminUser.id,
          roleId: superAdminRole.id,
        },
      },
      update: {},
      create: {
        userId: adminUser.id,
        roleId: superAdminRole.id,
      },
    });

    // 6. 初始化测试运维账号 test_ops / Admin123!
    const opsUser = await prisma.user.upsert({
      where: { username: 'test_ops' },
      update: {
        passwordHash: adminPasswordHash,
        departmentId: opsDept.id,
      },
      create: {
        username: 'test_ops',
        realName: '运维专员',
        email: 'ops@autix.com',
        phone: '13999999999',
        departmentId: opsDept.id,
        passwordHash: adminPasswordHash,
      },
    });

    await prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId: opsUser.id,
          roleId: adminRole.id,
        },
      },
      update: {},
      create: {
        userId: opsUser.id,
        roleId: adminRole.id,
      },
    });

    await prisma.$disconnect();
    expect(adminUser.id).toBeDefined();
    expect(opsUser.id).toBeDefined();
  });
});
