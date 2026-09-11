import { BaseListChatMessageHistory } from '@langchain/core/chat_history';
import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { MessageRole } from '../prisma/index.js';
import type { MessageService } from './message.service.js';

/**
 * 基于 PostgreSQL 的自定义 LangChain ChatMessageHistory
 * 继承 BaseListChatMessageHistory，与 RunnableWithMessageHistory 完全兼容
 */
export class DbChatMessageHistory extends BaseListChatMessageHistory {
  lc_namespace = ['langchain', 'stores', 'message', 'postgres'];

  constructor(
    readonly conversationId: string,
    private readonly messageService: MessageService,
  ) {
    super();
  }

  /**
   * 从 PostgreSQL 读取当前会话的历史消息，并转换为 LangChain BaseMessage[]
   */
  async getMessages(): Promise<BaseMessage[]> {
    return this.messageService.getHistoryAsLangChainMessages(this.conversationId);
  }

  /**
   * 向 PostgreSQL 写入一条消息
   *
   * 角色严格映射：
   * - HumanMessage -> USER
   * - 其余（AIMessage 等） -> ASSISTANT
   */
  async addMessage(message: BaseMessage): Promise<void> {
    const isHuman =
      message instanceof HumanMessage ||
      message._getType() === 'human' ||
      (typeof message.getType === 'function' && message.getType() === 'human');

    const role = isHuman ? MessageRole.USER : MessageRole.ASSISTANT;
    const content =
      typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content);

    await this.messageService.addMessage(this.conversationId, role, content);
  }

  /**
   * 清空当前会话在数据库中的全部历史消息
   */
  async clear(): Promise<void> {
    await this.messageService.clearHistory(this.conversationId);
  }
}
