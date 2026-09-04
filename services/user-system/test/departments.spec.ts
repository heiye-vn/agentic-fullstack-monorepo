import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { DepartmentsService } from '../src/modules/departments/departments.service.js';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

describe('Departments Module Integration Test', () => {
  let prisma: PrismaService;
  let deptService: DepartmentsService;
  const suffix = Date.now().toString();

  let parentDeptId: string;
  let subDeptId: string;
  let testUserId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    deptService = new DepartmentsService(prisma);
  });

  afterAll(async () => {
    // 清理测试数据
    if (testUserId) {
      await prisma.user.deleteMany({ where: { id: testUserId } });
    }
    if (subDeptId) {
      await prisma.department.deleteMany({ where: { id: subDeptId } });
    }
    if (parentDeptId) {
      await prisma.department.deleteMany({ where: { id: parentDeptId } });
    }
    await prisma.$disconnect();
  });

  it('1. should create parent department and sub-department', async () => {
    const parent = await deptService.create({
      name: `研发总部_${suffix}`,
      code: `rd_hq_${suffix}`,
      leader: '张总',
      sortOrder: 1,
    });
    parentDeptId = parent.id;

    const sub = await deptService.create({
      name: `前端开发组_${suffix}`,
      code: `rd_fe_${suffix}`,
      parentId: parentDeptId,
      leader: '李组长',
      sortOrder: 2,
    });
    subDeptId = sub.id;

    expect(parent.id).toBeDefined();
    expect(sub.parentId).toBe(parent.id);
  });

  it('2. should reject duplicate department code', async () => {
    await expect(
      deptService.create({
        name: '重名部门',
        code: `rd_hq_${suffix}`,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('3. should return nested department tree with active user count', async () => {
    // 在子部门挂载一个测试用户
    const user = await prisma.user.create({
      data: {
        username: `dept_user_${suffix}`,
        passwordHash: 'hash',
        departmentId: subDeptId,
      },
    });
    testUserId = user.id;

    const tree = await deptService.findTree();
    const parentNode = tree.find((d) => d.id === parentDeptId);
    expect(parentNode).toBeDefined();
    expect(parentNode?.children.length).toBe(1);

    const subNode = parentNode?.children[0];
    expect(subNode?.id).toBe(subDeptId);
    expect(subNode?.userCount).toBe(1);
  });

  it('4. should prevent deleting parent department when sub-departments exist', async () => {
    await expect(deptService.remove(parentDeptId)).rejects.toThrow(BadRequestException);
  });

  it('5. should prevent deleting department when active users belong to it', async () => {
    await expect(deptService.remove(subDeptId)).rejects.toThrow(BadRequestException);
  });

  it('6. should allow soft deleting department after user is removed/transferred', async () => {
    // 移除子部门的用户绑定
    await prisma.user.delete({ where: { id: testUserId } });
    testUserId = '';

    // 删除子部门
    await deptService.remove(subDeptId);
    const subInDb = await prisma.department.findUnique({ where: { id: subDeptId } });
    expect(subInDb?.deletedAt).not.toBeNull();

    // 此时父部门已无子部门，可以正常删除
    await deptService.remove(parentDeptId);
    const parentInDb = await prisma.department.findUnique({ where: { id: parentDeptId } });
    expect(parentInDb?.deletedAt).not.toBeNull();

    // 再次查询详情抛出 404
    await expect(deptService.findById(parentDeptId)).rejects.toThrow(NotFoundException);
  });
});
