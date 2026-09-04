import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreatePermissionDto } from './dto/create-permission.dto.js';
import { UpdatePermissionDto } from './dto/update-permission.dto.js';
import { CommonStatus, PermissionType } from '@prisma/client';

export interface PermissionTreeNode {
  id: string;
  parentId: string | null;
  name: string;
  code: string;
  type: PermissionType;
  path: string | null;
  component: string | null;
  icon: string | null;
  sortOrder: number;
  status: CommonStatus;
  children: PermissionTreeNode[];
}

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建权限节点
   */
  async create(dto: CreatePermissionDto) {
    const existing = await this.prisma.permission.findUnique({
      where: { code: dto.code },
    });
    if (existing) {
      throw new ConflictException(`权限编码 [${dto.code}] 已存在`);
    }

    if (dto.parentId) {
      const parent = await this.prisma.permission.findUnique({
        where: { id: dto.parentId },
      });
      if (!parent) {
        throw new BadRequestException('指定的父级权限节点不存在');
      }
    }

    return this.prisma.permission.create({
      data: {
        name: dto.name,
        code: dto.code,
        type: dto.type,
        parentId: dto.parentId,
        path: dto.path,
        component: dto.component,
        icon: dto.icon,
        sortOrder: dto.sortOrder ?? 0,
        status: dto.status ?? CommonStatus.ACTIVE,
      },
    });
  }

  /**
   * 查询权限列表 (扁平列表)
   */
  async findAll(keyword?: string) {
    return this.prisma.permission.findMany({
      where: keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' } },
              { code: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * 获取全量权限树 (用于前端角色授权勾选)
   */
  async findTree(): Promise<PermissionTreeNode[]> {
    const all = await this.prisma.permission.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return this.buildTree(all);
  }

  /**
   * 根据 ID 查询详情
   */
  async findById(id: string) {
    const perm = await this.prisma.permission.findUnique({
      where: { id },
      include: {
        parent: true,
        children: true,
      },
    });

    if (!perm) {
      throw new NotFoundException('权限节点不存在');
    }

    return perm;
  }

  /**
   * 更新权限节点
   */
  async update(id: string, dto: UpdatePermissionDto) {
    await this.findById(id);

    if (dto.parentId === id) {
      throw new BadRequestException('父级节点不能是自身');
    }

    return this.prisma.permission.update({
      where: { id },
      data: {
        name: dto.name,
        type: dto.type,
        parentId: dto.parentId,
        path: dto.path,
        component: dto.component,
        icon: dto.icon,
        sortOrder: dto.sortOrder,
        status: dto.status,
      },
    });
  }

  /**
   * 删除权限节点
   */
  async remove(id: string) {
    await this.findById(id);

    // 检查是否有子节点
    const childCount = await this.prisma.permission.count({
      where: { parentId: id },
    });
    if (childCount > 0) {
      throw new BadRequestException('存在下级子节点，请先删除或转移子节点');
    }

    await this.prisma.permission.delete({
      where: { id },
    });

    return { message: '权限节点已删除' };
  }

  /**
   * 获取当前登录用户授权的权限码与菜单路由树
   */
  async getCurrentUserPermissions(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const isSuperAdmin = user.userRoles.some(
      (ur) => ur.role.code === 'super_admin' && ur.role.status === CommonStatus.ACTIVE && !ur.role.deletedAt,
    );

    let permissionsList: string[] = [];
    let menuPermissions: any[] = [];

    if (isSuperAdmin) {
      // 超管赋予通配符及全量权限
      const allActive = await this.prisma.permission.findMany({
        where: { status: CommonStatus.ACTIVE },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
      permissionsList = ['*:*:*', ...allActive.map((p) => p.code)];
      menuPermissions = allActive.filter(
        (p) => p.type === PermissionType.CATALOG || p.type === PermissionType.MENU,
      );
    } else {
      const permMap = new Map<string, any>();
      for (const ur of user.userRoles) {
        if (ur.role.status === CommonStatus.ACTIVE && !ur.role.deletedAt) {
          for (const rp of ur.role.rolePermissions) {
            if (rp.permission.status === CommonStatus.ACTIVE) {
              permMap.set(rp.permission.id, rp.permission);
            }
          }
        }
      }

      const userPerms = Array.from(permMap.values());
      permissionsList = userPerms.map((p) => p.code);
      menuPermissions = userPerms.filter(
        (p) => p.type === PermissionType.CATALOG || p.type === PermissionType.MENU,
      );
    }

    const menuTree = this.buildTree(menuPermissions);

    return {
      permissions: permissionsList,
      menus: menuTree,
    };
  }

  /**
   * 递归组装树形结构算法
   */
  private buildTree(nodes: any[], parentId: string | null = null): PermissionTreeNode[] {
    return nodes
      .filter((node) => node.parentId === parentId)
      .map((node) => ({
        id: node.id,
        parentId: node.parentId,
        name: node.name,
        code: node.code,
        type: node.type,
        path: node.path,
        component: node.component,
        icon: node.icon,
        sortOrder: node.sortOrder,
        status: node.status,
        children: this.buildTree(nodes, node.id),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
}
