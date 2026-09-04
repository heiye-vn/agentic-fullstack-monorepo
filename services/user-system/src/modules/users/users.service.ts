import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { QueryUserDto } from './dto/query-user.dto.js';
import { AssignRolesDto } from './dto/assign-roles.dto.js';
import { CommonStatus, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建用户
   */
  async create(dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (existing) {
      throw new ConflictException('用户名已存在');
    }

    const passwordHash = await argon2.hash(dto.password);

    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        passwordHash,
        realName: dto.realName,
        email: dto.email,
        phone: dto.phone,
        avatar: dto.avatar,
        departmentId: dto.departmentId,
        status: dto.status ?? CommonStatus.ACTIVE,
        userRoles: dto.roleIds && dto.roleIds.length > 0
          ? {
              create: dto.roleIds.map((roleId) => ({ roleId })),
            }
          : undefined,
      },
      select: {
        id: true,
        username: true,
        realName: true,
        email: true,
        phone: true,
        avatar: true,
        status: true,
        departmentId: true,
        createdAt: true,
      },
    });

    return user;
  }

  /**
   * 分页查询用户列表 (支持关键字、部门、状态筛选，自动排除已软删除)
   */
  async findAll(query: QueryUserDto) {
    const { page = 1, pageSize = 10, keyword, departmentId, status } = query;
    const skip = (page - 1) * pageSize;

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
    };

    if (keyword) {
      where.OR = [
        { username: { contains: keyword, mode: 'insensitive' } },
        { realName: { contains: keyword, mode: 'insensitive' } },
        { email: { contains: keyword, mode: 'insensitive' } },
        { phone: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    if (departmentId) {
      where.departmentId = departmentId;
    }

    if (status) {
      where.status = status;
    }

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          username: true,
          realName: true,
          email: true,
          phone: true,
          avatar: true,
          status: true,
          tokenVersion: true,
          lastLoginAt: true,
          createdAt: true,
          department: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          userRoles: {
            select: {
              role: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const items = users.map((u) => ({
      ...u,
      roles: u.userRoles.map((ur) => ur.role),
    }));

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 根据 ID 查询用户详情
   */
  async findById(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        username: true,
        realName: true,
        email: true,
        phone: true,
        avatar: true,
        status: true,
        tokenVersion: true,
        lastLoginAt: true,
        createdAt: true,
        department: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        userRoles: {
          select: {
            role: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('用户不存在或已被删除');
    }

    return {
      ...user,
      roles: user.userRoles.map((ur) => ur.role),
    };
  }

  /**
   * 更新用户信息
   */
  async update(id: string, dto: UpdateUserDto) {
    await this.findById(id);

    return this.prisma.user.update({
      where: { id },
      data: {
        realName: dto.realName,
        email: dto.email,
        phone: dto.phone,
        avatar: dto.avatar,
        departmentId: dto.departmentId,
        status: dto.status,
      },
      select: {
        id: true,
        username: true,
        realName: true,
        email: true,
        phone: true,
        status: true,
        updatedAt: true,
      },
    });
  }

  /**
   * 分配用户角色 (事务中更新，并递增 tokenVersion 强制在线会话懒失效)
   */
  async assignRoles(id: string, dto: AssignRolesDto) {
    await this.findById(id);

    await this.prisma.$transaction(async (tx) => {
      // 1. 清除原有角色关联
      await tx.userRole.deleteMany({
        where: { userId: id },
      });

      // 2. 插入新角色关联
      if (dto.roleIds && dto.roleIds.length > 0) {
        await tx.userRole.createMany({
          data: dto.roleIds.map((roleId) => ({
            userId: id,
            roleId,
          })),
        });
      }

      // 3. 关键安全联动：递增 tokenVersion，使旧 Token 失效
      await tx.user.update({
        where: { id },
        data: {
          tokenVersion: { increment: 1 },
        },
      });
    });

    return this.findById(id);
  }

  /**
   * 重置密码
   */
  async resetPassword(id: string, newPlainPassword: string) {
    await this.findById(id);
    const passwordHash = await argon2.hash(newPlainPassword);

    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash,
        tokenVersion: { increment: 1 }, // 密码修改也自增版本踢出旧登录态
      },
    });

    return { message: '密码重置成功' };
  }

  /**
   * 变更用户状态
   */
  async updateStatus(id: string, status: CommonStatus) {
    await this.findById(id);

    await this.prisma.user.update({
      where: { id },
      data: {
        status,
        ...(status === CommonStatus.DISABLED ? { tokenVersion: { increment: 1 } } : {}),
      },
    });

    return { message: `用户状态已更新为 ${status}` };
  }

  /**
   * 软删除用户
   */
  async remove(id: string) {
    await this.findById(id);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          tokenVersion: { increment: 1 },
        },
      }),
      // 吊销该用户所有活跃会话凭证
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { message: '用户已删除' };
  }
}
