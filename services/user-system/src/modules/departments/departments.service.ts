import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateDepartmentDto } from './dto/create-department.dto.js';
import { UpdateDepartmentDto } from './dto/update-department.dto.js';
import { CommonStatus } from '@prisma/client';

export interface DepartmentTreeNode {
  id: string;
  parentId: string | null;
  name: string;
  code: string;
  leader: string | null;
  phone: string | null;
  sortOrder: number;
  status: CommonStatus;
  userCount: number;
  children: DepartmentTreeNode[];
}

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建部门
   */
  async create(dto: CreateDepartmentDto) {
    const existing = await this.prisma.department.findUnique({
      where: { code: dto.code },
    });
    if (existing) {
      throw new ConflictException(`部门编码 [${dto.code}] 已存在`);
    }

    if (dto.parentId) {
      const parent = await this.prisma.department.findFirst({
        where: { id: dto.parentId, deletedAt: null },
      });
      if (!parent) {
        throw new BadRequestException('指定的父级部门不存在');
      }
    }

    return this.prisma.department.create({
      data: {
        name: dto.name,
        code: dto.code,
        parentId: dto.parentId,
        leader: dto.leader,
        phone: dto.phone,
        sortOrder: dto.sortOrder ?? 0,
        status: dto.status ?? CommonStatus.ACTIVE,
      },
    });
  }

  /**
   * 获取组织架构树
   */
  async findTree(keyword?: string): Promise<DepartmentTreeNode[]> {
    const all = await this.prisma.department.findMany({
      where: {
        deletedAt: null,
        ...(keyword ? { name: { contains: keyword, mode: 'insensitive' } } : {}),
      },
      include: {
        _count: {
          select: {
            users: {
              where: { deletedAt: null },
            },
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    return this.buildTree(all);
  }

  /**
   * 获取部门详情
   */
  async findById(id: string) {
    const dept = await this.prisma.department.findFirst({
      where: { id, deletedAt: null },
      include: {
        parent: true,
        children: {
          where: { deletedAt: null },
        },
        users: {
          where: { deletedAt: null },
          select: {
            id: true,
            username: true,
            realName: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    if (!dept) {
      throw new NotFoundException('部门不存在或已被删除');
    }

    return dept;
  }

  /**
   * 更新部门
   */
  async update(id: string, dto: UpdateDepartmentDto) {
    await this.findById(id);

    if (dto.parentId === id) {
      throw new BadRequestException('父级部门不能为自身');
    }

    return this.prisma.department.update({
      where: { id },
      data: {
        name: dto.name,
        parentId: dto.parentId,
        leader: dto.leader,
        phone: dto.phone,
        sortOrder: dto.sortOrder,
        status: dto.status,
      },
    });
  }

  /**
   * 软删除部门
   */
  async remove(id: string) {
    await this.findById(id);

    // 1. 检查是否存在活跃子部门
    const activeSubDepts = await this.prisma.department.count({
      where: { parentId: id, deletedAt: null },
    });
    if (activeSubDepts > 0) {
      throw new BadRequestException('该部门下仍存在子部门，无法直接删除');
    }

    // 2. 检查是否有在职用户
    const activeUsers = await this.prisma.user.count({
      where: { departmentId: id, deletedAt: null },
    });
    if (activeUsers > 0) {
      throw new BadRequestException(`该部门下仍有 ${activeUsers} 位在职用户，请先调整人员归属`);
    }

    return this.prisma.department.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * 递归构建部门树
   */
  private buildTree(nodes: any[], parentId: string | null = null): DepartmentTreeNode[] {
    return nodes
      .filter((node) => node.parentId === parentId)
      .map((node) => ({
        id: node.id,
        parentId: node.parentId,
        name: node.name,
        code: node.code,
        leader: node.leader,
        phone: node.phone,
        sortOrder: node.sortOrder,
        status: node.status,
        userCount: node._count ? node._count.users : 0,
        children: this.buildTree(nodes, node.id),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
}
