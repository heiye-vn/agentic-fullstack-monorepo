import { PermissionType, CommonStatus } from "@prisma/client";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as argon2 from "argon2";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres123@localhost:5432/autix_rbac?schema=public",
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 正在开始 RBAC 数据初始化 (Seed)...");

  // 1. 初始化部门架构
  const headDept = await prisma.department.upsert({
    where: { code: "DEPT_HEAD" },
    update: {
      name: "集团总部",
      leader: "总经办",
      phone: "010-88888888",
      sortOrder: 1,
    },
    create: {
      name: "集团总部",
      code: "DEPT_HEAD",
      leader: "总经办",
      phone: "010-88888888",
      sortOrder: 1,
      status: CommonStatus.ACTIVE,
    },
  });

  const devDept = await prisma.department.upsert({
    where: { code: "DEPT_DEV" },
    update: {
      name: "研发技术中心",
      parentId: headDept.id,
      leader: "技术总监",
      phone: "010-88888881",
      sortOrder: 2,
    },
    create: {
      name: "研发技术中心",
      code: "DEPT_DEV",
      parentId: headDept.id,
      leader: "技术总监",
      phone: "010-88888881",
      sortOrder: 2,
      status: CommonStatus.ACTIVE,
    },
  });

  const opsDept = await prisma.department.upsert({
    where: { code: "DEPT_OPS" },
    update: {
      name: "运维交付中心",
      parentId: headDept.id,
      leader: "运维主管",
      phone: "010-88888882",
      sortOrder: 3,
    },
    create: {
      name: "运维交付中心",
      code: "DEPT_OPS",
      parentId: headDept.id,
      leader: "运维主管",
      phone: "010-88888882",
      sortOrder: 3,
      status: CommonStatus.ACTIVE,
    },
  });

  // 2. 初始化核心角色
  const superAdminRole = await prisma.role.upsert({
    where: { code: "super_admin" },
    update: {
      name: "超级管理员",
      description: "拥有系统所有资源的最高完全支配权，防删除锁定",
      sortOrder: 1,
    },
    create: {
      name: "超级管理员",
      code: "super_admin",
      description: "拥有系统所有资源的最高完全支配权，防删除锁定",
      sortOrder: 1,
      status: CommonStatus.ACTIVE,
    },
  });

  const adminRole = await prisma.role.upsert({
    where: { code: "admin" },
    update: {
      name: "系统运维主管",
      description: "负责用户、组织架构日常运维与权限资源配置",
      sortOrder: 2,
    },
    create: {
      name: "系统运维主管",
      code: "admin",
      description: "负责用户、组织架构日常运维与权限资源配置",
      sortOrder: 2,
      status: CommonStatus.ACTIVE,
    },
  });

  const generalUserRole = await prisma.role.upsert({
    where: { code: "general_user" },
    update: {
      name: "普通员工",
      description: "仅具备基础查看权限的用户角色",
      sortOrder: 3,
    },
    create: {
      name: "普通员工",
      code: "general_user",
      description: "仅具备基础查看权限的用户角色",
      sortOrder: 3,
      status: CommonStatus.ACTIVE,
    },
  });

  // 3. 初始化全量系统权限树
  const sysRoot = await prisma.permission.upsert({
    where: { code: "sys" },
    update: {
      name: "系统管理",
      type: PermissionType.CATALOG,
      path: "/system",
      sortOrder: 1,
    },
    create: {
      name: "系统管理",
      code: "sys",
      type: PermissionType.CATALOG,
      path: "/system",
      sortOrder: 1,
      status: CommonStatus.ACTIVE,
    },
  });

  // 全局通配符权限
  const wildcardPerm = await prisma.permission.upsert({
    where: { code: "*:*:*" },
    update: {
      name: "全局完全权限",
      type: PermissionType.API,
      sortOrder: 999,
    },
    create: {
      name: "全局完全权限",
      code: "*:*:*",
      type: PermissionType.API,
      sortOrder: 999,
      status: CommonStatus.ACTIVE,
    },
  });

  const modules = [
    {
      name: "用户管理",
      code: "sys:user",
      path: "/users",
      children: [
        {
          name: "用户查询",
          code: "sys:user:list",
          type: PermissionType.BUTTON,
        },
        {
          name: "用户创建",
          code: "sys:user:create",
          type: PermissionType.BUTTON,
        },
        {
          name: "用户编辑",
          code: "sys:user:update",
          type: PermissionType.BUTTON,
        },
        {
          name: "用户删除",
          code: "sys:user:delete",
          type: PermissionType.BUTTON,
        },
        {
          name: "分配角色",
          code: "sys:user:assign",
          type: PermissionType.BUTTON,
        },
      ],
    },
    {
      name: "角色管理",
      code: "sys:role",
      path: "/roles",
      children: [
        {
          name: "角色查询",
          code: "sys:role:list",
          type: PermissionType.BUTTON,
        },
        {
          name: "角色创建",
          code: "sys:role:create",
          type: PermissionType.BUTTON,
        },
        {
          name: "角色编辑",
          code: "sys:role:update",
          type: PermissionType.BUTTON,
        },
        {
          name: "角色删除",
          code: "sys:role:delete",
          type: PermissionType.BUTTON,
        },
        {
          name: "分配权限",
          code: "sys:role:assign",
          type: PermissionType.BUTTON,
        },
      ],
    },
    {
      name: "权限配置中心",
      code: "sys:permission",
      path: "/permission-center",
      children: [
        {
          name: "权限查询",
          code: "sys:permission:list",
          type: PermissionType.BUTTON,
        },
        {
          name: "权限创建",
          code: "sys:permission:create",
          type: PermissionType.BUTTON,
        },
        {
          name: "权限编辑",
          code: "sys:permission:update",
          type: PermissionType.BUTTON,
        },
        {
          name: "权限删除",
          code: "sys:permission:delete",
          type: PermissionType.BUTTON,
        },
      ],
    },
    {
      name: "部门架构",
      code: "sys:dept",
      path: "/departments",
      children: [
        {
          name: "部门查询",
          code: "sys:dept:list",
          type: PermissionType.BUTTON,
        },
        {
          name: "部门创建",
          code: "sys:dept:create",
          type: PermissionType.BUTTON,
        },
        {
          name: "部门修改",
          code: "sys:dept:update",
          type: PermissionType.BUTTON,
        },
        {
          name: "部门删除",
          code: "sys:dept:delete",
          type: PermissionType.BUTTON,
        },
      ],
    },
    {
      name: "审计中心",
      code: "sys:log",
      path: "/logs",
      children: [
        { name: "日志查询", code: "sys:log:list", type: PermissionType.BUTTON },
      ],
    },
  ];

  const allPermIds: string[] = [sysRoot.id, wildcardPerm.id];
  const generalPermIds: string[] = [sysRoot.id];

  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i];
    const modNode = await prisma.permission.upsert({
      where: { code: mod.code },
      update: {
        name: mod.name,
        parentId: sysRoot.id,
        path: mod.path,
        sortOrder: (i + 1) * 10,
      },
      create: {
        name: mod.name,
        code: mod.code,
        type: PermissionType.MENU,
        path: mod.path,
        parentId: sysRoot.id,
        sortOrder: (i + 1) * 10,
        status: CommonStatus.ACTIVE,
      },
    });
    allPermIds.push(modNode.id);

    // 给普通员工开放系统菜单访问
    generalPermIds.push(modNode.id);

    for (let j = 0; j < mod.children.length; j++) {
      const btn = mod.children[j];
      const btnNode = await prisma.permission.upsert({
        where: { code: btn.code },
        update: {
          name: btn.name,
          parentId: modNode.id,
          sortOrder: (j + 1) * 10,
        },
        create: {
          name: btn.name,
          code: btn.code,
          type: btn.type,
          parentId: modNode.id,
          sortOrder: (j + 1) * 10,
          status: CommonStatus.ACTIVE,
        },
      });
      allPermIds.push(btnNode.id);

      // 普通员工仅赋予 list 查询权限
      if (btn.code.endsWith(":list")) {
        generalPermIds.push(btnNode.id);
      }
    }
  }

  // 4. 将全量权限赋给 superAdminRole 和 adminRole，只读权限赋给 generalUserRole
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

  for (const permId of generalPermIds) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: generalUserRole.id,
          permissionId: permId,
        },
      },
      update: {},
      create: {
        roleId: generalUserRole.id,
        permissionId: permId,
      },
    });
  }

  // 5. 初始化用户
  const defaultPasswordHash = await argon2.hash("Admin123!");
  const userPasswordHash = await argon2.hash("User123!");

  // 5.1 超级管理员账号 admin / Admin123!
  const adminUser = await prisma.user.upsert({
    where: { username: "admin" },
    update: {
      passwordHash: defaultPasswordHash,
      departmentId: devDept.id,
      realName: "超级管理员",
      status: CommonStatus.ACTIVE,
    },
    create: {
      username: "admin",
      passwordHash: defaultPasswordHash,
      realName: "超级管理员",
      email: "admin@autix.com",
      phone: "18888888888",
      status: CommonStatus.ACTIVE,
      departmentId: devDept.id,
    },
  });

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

  // 5.2 运维专员账号 test_ops / Admin123!
  const opsUser = await prisma.user.upsert({
    where: { username: "test_ops" },
    update: {
      passwordHash: defaultPasswordHash,
      departmentId: opsDept.id,
      realName: "运维专员",
      status: CommonStatus.ACTIVE,
    },
    create: {
      username: "test_ops",
      passwordHash: defaultPasswordHash,
      realName: "运维专员",
      email: "ops@autix.com",
      phone: "13999999999",
      status: CommonStatus.ACTIVE,
      departmentId: opsDept.id,
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

  // 5.3 普通用户账号 test_user / User123!
  const testUser = await prisma.user.upsert({
    where: { username: "test_user" },
    update: {
      passwordHash: userPasswordHash,
      departmentId: opsDept.id,
      realName: "测试普通员工",
      status: CommonStatus.ACTIVE,
    },
    create: {
      username: "test_user",
      passwordHash: userPasswordHash,
      realName: "测试普通员工",
      email: "test_user@autix.com",
      phone: "13800000000",
      status: CommonStatus.ACTIVE,
      departmentId: opsDept.id,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: testUser.id,
        roleId: generalUserRole.id,
      },
    },
    update: {},
    create: {
      userId: testUser.id,
      roleId: generalUserRole.id,
    },
  });

  console.log("✅ RBAC 数据种子填充成功！");
  console.log(`- 超级管理员: admin / Admin123! (角色: super_admin)`);
  console.log(`- 运维专员: test_ops / Admin123! (角色: admin)`);
  console.log(`- 普通员工: test_user / User123! (角色: general_user)`);
}

main()
  .catch((e) => {
    console.error("❌ Seed 执行失败:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
