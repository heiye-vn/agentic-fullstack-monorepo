import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ConversationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 为指定用户创建新会话
   *
   * @param userId 归属用户 ID
   * @param title 可选会话标题（默认 "新会话"）
   */
  async create(userId: string, title?: string) {
    return this.prisma.conversation.create({
      data: {
        userId,
        title: title?.trim() || '新会话',
      },
    });
  }

  /**
   * 查询当前用户的所有会话列表，按更新时间倒序
   *
   * @param userId 用户 ID
   */
  async findByUser(userId: string) {
    return this.prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: {
          select: { messages: true },
        },
      },
    });
  }

  /**
   * 查询指定会话详情，并进行数据归属权限校验
   *
   * @param conversationId 会话 ID
   * @param userId 操作人用户 ID
   * @throws NotFoundException 会话不存在时抛出
   * @throws ForbiddenException 会话不属于当前用户时抛出
   */
  async findById(conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('会话不存在');
    }

    if (conversation.userId !== userId) {
      throw new ForbiddenException('无权访问该会话');
    }

    return conversation;
  }

  /**
   * 删除指定会话（校验权限后物理删除，依托数据库外键级联清理所属 messages）
   *
   * @param conversationId 会话 ID
   * @param userId 操作人用户 ID
   */
  async delete(conversationId: string, userId: string) {
    await this.findById(conversationId, userId);

    await this.prisma.conversation.delete({
      where: { id: conversationId },
    });

    return { success: true, message: '会话已删除' };
  }
}
