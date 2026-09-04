import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { UsersService } from "../src/modules/users/users.service.js";
import { CommonStatus } from "@prisma/client";
import { ConflictException, NotFoundException } from "@nestjs/common";

describe("Users Module Integration Test", () => {
  let prisma: PrismaService;
  let usersService: UsersService;
  const suffix = Date.now().toString();

  let testRole1: any;
  let testRole2: any;
  let testDept: any;
  let createdUserId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    usersService = new UsersService(prisma);

    // 准备测试部门与测试角色
    testDept = await prisma.department.create({
      data: {
        name: `测试部门_${suffix}`,
        code: `dept_u_${suffix}`,
      },
    });

    testRole1 = await prisma.role.create({
      data: {
        name: `角色1_${suffix}`,
        code: `role1_u_${suffix}`,
      },
    });

    testRole2 = await prisma.role.create({
      data: {
        name: `角色2_${suffix}`,
        code: `role2_u_${suffix}`,
      },
    });
  });

  afterAll(async () => {
    // 级联清理测试数据
    if (createdUserId) {
      await prisma.userRole.deleteMany({ where: { userId: createdUserId } });
      await prisma.refreshToken.deleteMany({
        where: { userId: createdUserId },
      });
      await prisma.user.deleteMany({ where: { id: createdUserId } });
    }
    await prisma.role.deleteMany({
      where: { code: { in: [`role1_u_${suffix}`, `role2_u_${suffix}`] } },
    });
    await prisma.department.deleteMany({ where: { code: `dept_u_${suffix}` } });
    await prisma.$disconnect();
  });

  it("1. should create a user with hashed password and initial role", async () => {
    const user = await usersService.create({
      username: `user_${suffix}`,
      password: "InitialPassword123!",
      realName: "张三测试员",
      email: `user_${suffix}@test.com`,
      phone: "13800000000",
      departmentId: testDept.id,
      roleIds: [testRole1.id],
    });

    expect(user.id).toBeDefined();
    expect(user.username).toBe(`user_${suffix}`);
    createdUserId = user.id;

    // 检查密码散列
    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(dbUser?.passwordHash).not.toBe("InitialPassword123!");
  });

  it("2. should reject duplicate username with ConflictException", async () => {
    await expect(
      usersService.create({
        username: `user_${suffix}`,
        password: "AnotherPassword123!",
      }),
    ).rejects.toThrow(ConflictException);
  });

  it("3. should query user list with pagination and keyword filtering", async () => {
    const res = await usersService.findAll({
      page: 1,
      pageSize: 10,
      keyword: "张三测试员",
    });

    expect(res.items.length).toBeGreaterThanOrEqual(1);
    const found = res.items.find((u) => u.id === createdUserId);
    expect(found).toBeDefined();
    expect(found?.department?.name).toBe(`测试部门_${suffix}`);
    expect(found?.roles.some((r) => r.id === testRole1.id)).toBe(true);
  });

  it("4. should update user basic information", async () => {
    const updated = await usersService.update(createdUserId, {
      realName: "李四修改后",
      phone: "13911112222",
    });

    expect(updated.realName).toBe("李四修改后");
    expect(updated.phone).toBe("13911112222");
  });

  it("5. should assign new roles and increment tokenVersion for session revocation", async () => {
    const userBefore = await prisma.user.findUniqueOrThrow({
      where: { id: createdUserId },
    });
    const oldVersion = userBefore.tokenVersion;

    const assigned = await usersService.assignRoles(createdUserId, {
      roleIds: [testRole2.id],
    });

    expect(assigned.roles.length).toBe(1);
    expect(assigned.roles[0].id).toBe(testRole2.id);

    const userAfter = await prisma.user.findUniqueOrThrow({
      where: { id: createdUserId },
    });
    expect(userAfter.tokenVersion).toBe(oldVersion + 1); // 校验版本号递增
  });

  it("6. should reset user password and increment tokenVersion", async () => {
    const userBefore = await prisma.user.findUniqueOrThrow({
      where: { id: createdUserId },
    });
    const oldVersion = userBefore.tokenVersion;

    await usersService.resetPassword(createdUserId, "NewSecurePassword666!");

    const userAfter = await prisma.user.findUniqueOrThrow({
      where: { id: createdUserId },
    });
    expect(userAfter.tokenVersion).toBe(oldVersion + 1);
  });

  it("7. should toggle user status", async () => {
    await usersService.updateStatus(createdUserId, CommonStatus.DISABLED);
    const disabledUser = await prisma.user.findUniqueOrThrow({
      where: { id: createdUserId },
    });
    expect(disabledUser.status).toBe(CommonStatus.DISABLED);

    await usersService.updateStatus(createdUserId, CommonStatus.ACTIVE);
    const activeUser = await prisma.user.findUniqueOrThrow({
      where: { id: createdUserId },
    });
    expect(activeUser.status).toBe(CommonStatus.ACTIVE);
  });

  it("8. should soft delete user and exclude from general queries", async () => {
    await usersService.remove(createdUserId);

    const deletedInDb = await prisma.user.findUnique({
      where: { id: createdUserId },
    });
    expect(deletedInDb?.deletedAt).not.toBeNull();

    // 列表检索时应该被过滤排除
    const listRes = await usersService.findAll({ page: 1, pageSize: 10, keyword: `user_${suffix}` });
    const found = listRes.items.find((u) => u.id === createdUserId);
    expect(found).toBeUndefined();

    // findById 应该抛出 NotFoundException
    await expect(usersService.findById(createdUserId)).rejects.toThrow(
      NotFoundException,
    );
  });
});
