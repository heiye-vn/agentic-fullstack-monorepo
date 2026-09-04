import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateRoleDto } from './dto/create-role.dto.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';
import { QueryRoleDto } from './dto/query-role.dto.js';
import { AssignPermissionsDto } from './dto/assign-permissions.dto.js';
import { CommonStatus, Prisma } from '@prisma/client';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建角色
   */
  async create(dto: CreateRoleDto) {
    const existing = await this.prisma.role.findUnique({
      where: { code: dto.code },
    });
    if (existing) {
      throw new ConflictException(`角色编码 [${dto.code}] 已存在`);
    }

    return this.prisma.role.create({
      data: {
        name: dto.name,
        code: dto.code,
        description: dto.description,
        sortOrder: dto.sortOrder ?? 0,
        status: dto.status ?? CommonStatus.ACTIVE,
      },
    });
  }

  /**
   * 查询角色列表 (支持分页与模糊检索)
   */
  async findAll(query: QueryRoleDto) {
    const { page = 1, pageSize = 10, keyword, status } = query;
    const skip = (page - 1) * pageSize;

    const where: Prisma.RoleWhereInput = {
      deletedAt: null,
    };

    if (keyword) {
      where.OR = [
        { name: { contains: keyword, mode: 'insensitive' } },
        { code: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    if (status) {
      where.status = status;
    }

    const [total, roles] = await Promise.all([
      this.prisma.role.count({ where }),
      this.prisma.role.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        include: {
          _count: {
            select: {
              userRoles: true,
              rolePermissions: true,
            },
          },
        },
      }),
    ]);

    const items = roles.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      description: r.description,
      sortOrder: r.sortOrder,
      status: r.status,
      userCount: r._count.userRoles,
      permissionCount: r._count.rolePermissions,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
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
   * 根据 ID 获取角色详情
   */
  async findById(id: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, deletedAt: null },
      include: {
        rolePermissions: {
          include: {
            permission: true,
          },
        },
      },
    });

    if (!role) {
      throw new NotFoundException('角色不存在或已被删除');
    }

    return {
      ...role,
      permissions: role.rolePermissions.map((rp) => rp.permission),
    };
  }

  /**
   * 更新角色基础信息
   */
  async update(id: string, dto: UpdateRoleDto) {
    await this.findById(id);

    return this.prisma.role.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        sortOrder: dto.sortOrder,
        status: dto.status,
      },
    });
  }

  /**
   * 为角色分配权限 (事务处理，并联动自增关联用户的 tokenVersion 强制旧 Token 懒失效)
   */
  async assignPermissions(id: string, dto: AssignPermissionsDto) {
    const role = await this.findById(id);

    await this.prisma.$transaction(async (tx) => {
      // 1. 删除旧权限映射
      await tx.rolePermission.deleteMany({
        where: { roleId: id },
      });

      // 2. 批量创建新权限映射
      if (dto.permissionIds && dto.permissionIds.length > 0) {
        await tx.rolePermission.createMany({
          data: dto.permissionIds.map((permissionId) => ({
            roleId: id,
            permissionId,
          })),
        });
      }

      // 3. 核心安全联动：查询所有分配了该角色的活跃用户，并自增其 tokenVersion
      const userRoles = await tx.userRole.findMany({
        where: { roleId: id },
        select: { userId: true },
      });

      if (userRoles.length > 0) {
        const userIds = userRoles.map((ur) => ur.userId);
        await tx.user.updateMany({
          where: { id: { in: userIds } },
          data: {
            tokenVersion: { increment: 1 },
          },
        });
      }
    });

    return this.findById(id);
  }

  /**
   * 软删除角色 (内置超管保护)
   */
  async remove(id: string) {
    const role = await this.findById(id);

    if (role.code === 'super_admin') {
      throw new BadRequestException('系统内置超级管理员角色禁止删除');
    }

    await this.prisma.$transaction([
      this.prisma.role.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
      // 解除与用户的关联
      this.prisma.userRole.deleteMany({
        where: { roleId: id },
      }),
    ]);

    return { message: `角色 [${role.name}] 已成功删除` };
  }
}
