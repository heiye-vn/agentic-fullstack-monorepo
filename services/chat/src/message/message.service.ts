import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MessageRole, type Prisma } from '../prisma/index.js';
import { HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';

@Injectable()
export class MessageService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 向指定会话添加一条消息，并同步更新会话的 updatedAt
   *
   * @param conversationId 会话 ID
   * @param role 消息角色（USER 或 ASSISTANT）
   * @param content 消息文本内容
   * @param metadata 可选结构化元数据
   */
  async addMessage(
    conversationId: string,
    role: MessageRole | string,
    content: string,
    metadata?: Record<string, unknown> | Prisma.InputJsonValue,
  ) {
    // 明确 role 映射：USER / human -> USER，其余（AIMessage、system 等）均映射为 ASSISTANT
    const dbRole =
      role === MessageRole.USER || role === 'USER' || role === 'human'
        ? MessageRole.USER
        : MessageRole.ASSISTANT;

    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId,
          role: dbRole,
          content,
          metadata: metadata ? (metadata as Prisma.InputJsonValue) : undefined,
        },
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      }),
    ]);

    return message;
  }

  /**
   * 获取指定会话的历史消息列表
   *
   * @param conversationId 会话 ID
   * @param limit 可选截取最近的 N 条消息
   */
  async getHistory(conversationId: string, limit?: number) {
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      ...(limit ? { take: limit } : {}),
    });
  }

  /**
   * 将会话历史转换为 LangChain 标准 BaseMessage 数组
   *
   * 角色映射：
   * - USER -> HumanMessage
   * - 其余（ASSISTANT 等） -> AIMessage
   */
  async getHistoryAsLangChainMessages(
    conversationId: string,
  ): Promise<BaseMessage[]> {
    const messages = await this.getHistory(conversationId);

    return messages.map((msg) => {
      if (msg.role === MessageRole.USER) {
        return new HumanMessage({
          content: msg.content,
          id: msg.id,
        });
      }
      return new AIMessage({
        content: msg.content,
        id: msg.id,
      });
    });
  }

  /**
   * 清空指定会话的全部消息
   */
  async clearHistory(conversationId: string) {
    return this.prisma.message.deleteMany({
      where: { conversationId },
    });
  }
}
