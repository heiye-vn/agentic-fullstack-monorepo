import { Injectable, Optional } from '@nestjs/common';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';
import {
  RunnableWithMessageHistory,
  type Runnable,
} from '@langchain/core/runnables';
import { InMemoryChatMessageHistory } from '@langchain/core/chat_history';
import { trimMessages, type BaseMessage } from '@langchain/core/messages';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatOpenAI } from '@langchain/openai';
import { createChatModel } from '../model.factory.js';
import {
  REQUIREMENT_ASSISTANT_SYSTEM_PROMPT,
  REQUIREMENT_ASSISTANT_USER_TEMPLATE,
} from '../prompts/requirement-assistant.prompt.js';

/**
 * 历史消息展示结构
 */
export interface HistoryMessageItem {
  role: string;
  content: string;
}

/**
 * 记忆版本类型
 * - standard: 标准版（完整保留全部多轮历史）
 * - trimmed: 裁剪版（通过 trimMessages 限制上下文在 maxTokens 内）
 */
export type MemoryVersion = 'standard' | 'trimmed';

/**
 * 对话调用配置选项
 */
export interface ChatOptions {
  /** 记忆模式版本，默认 'standard' */
  version?: MemoryVersion;
  /** 可选覆盖的 ChatModel 实例（用于单测打桩或自定义参数） */
  customModel?: ChatOpenAI;
}

@Injectable()
export class RunnableMemoryService {
  private readonly defaultModel: ChatOpenAI;

  /**
   * 需求分析助手提示模板
   * - system: 角色与多轮分析指引
   * - history: 动态注入的历史消息占位符
   * - human: 当前轮次用户输入
   */
  readonly prompt = ChatPromptTemplate.fromMessages([
    ['system', REQUIREMENT_ASSISTANT_SYSTEM_PROMPT],
    new MessagesPlaceholder('history'),
    ['human', REQUIREMENT_ASSISTANT_USER_TEMPLATE],
  ]);

  /**
   * 标准版会话历史存储（sessionId -> InMemoryChatMessageHistory）
   */
  private readonly standardStore = new Map<
    string,
    InMemoryChatMessageHistory
  >();

  /**
   * 裁剪版会话历史存储（sessionId -> InMemoryChatMessageHistory）
   */
  private readonly trimmedStore = new Map<string, InMemoryChatMessageHistory>();

  constructor(@Optional() model?: ChatOpenAI) {
    this.defaultModel = model ?? createChatModel({ streaming: false });
  }

  /**
   * 获取或初始化指定版本的 Session 历史存储实例
   */
  getOrCreateHistory(
    sessionId: string,
    version: MemoryVersion = 'standard',
  ): InMemoryChatMessageHistory {
    const store =
      version === 'trimmed' ? this.trimmedStore : this.standardStore;
    let history = store.get(sessionId);
    if (!history) {
      history = new InMemoryChatMessageHistory();
      store.set(sessionId, history);
    }
    return history;
  }

  /**
   * 构建基础 Token 计算函数
   * 采用高效率多语言分词估算（中文约 1.2 token/字符，英文约 0.35 token/字符）
   * 毫秒级计算，避免第三方 tiktoken 库的异步 Wasm 初始化延迟
   */
  private createTokenCounter(_model?: ChatOpenAI) {
    return async (messages: BaseMessage[]): Promise<number> => {
      let total = 0;
      for (const msg of messages) {
        const text =
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content);

        total += Math.ceil((text?.length || 0) * 1.2) + 4;
      }
      return total;
    };
  }

  /**
   * 构建带有 trimMessages 裁剪的 Runnable 链
   * - maxTokens: 2000
   * - strategy: 'last'（保留最近的消息）
   * - includeSystem: true（保留开头的系统提示词）
   * - startOn: 'human'（截断后起始消息保证为 human，避免上下文突兀）
   */
  createTrimmedChain(customModel?: ChatOpenAI): Runnable {
    const activeModel = customModel ?? this.defaultModel;
    const trimmer = trimMessages({
      maxTokens: 2000,
      strategy: 'last',
      tokenCounter: this.createTokenCounter(activeModel),
      includeSystem: true,
      allowPartial: false,
      startOn: 'human',
    });

    return this.prompt
      .pipe(async (promptValue) => {
        const messages = promptValue.toChatMessages();
        return trimmer.invoke(messages);
      })
      .pipe(activeModel)
      .pipe(new StringOutputParser());
  }

  /**
   * 构建标准非裁剪版 Runnable 链
   */
  createStandardChain(customModel?: ChatOpenAI): Runnable {
    const activeModel = customModel ?? this.defaultModel;
    return this.prompt.pipe(activeModel).pipe(new StringOutputParser());
  }

  /**
   * 构建指定版本的 RunnableWithMessageHistory 实例
   */
  createRunnableWithHistory(
    version: MemoryVersion = 'standard',
    customModel?: ChatOpenAI,
  ): RunnableWithMessageHistory<Record<string, unknown>, string> {
    const runnable =
      version === 'trimmed'
        ? this.createTrimmedChain(customModel)
        : this.createStandardChain(customModel);

    return new RunnableWithMessageHistory({
      runnable,
      getMessageHistory: (sessionId: string) =>
        this.getOrCreateHistory(sessionId, version),
      inputMessagesKey: 'input',
      historyMessagesKey: 'history',
    });
  }

  /**
   * 多轮对话交互方法
   * 自动加载 sessionId 历史、执行推理并自动追加本轮 human/ai 记录
   *
   * @param sessionId 会话唯一标识符
   * @param input 用户本轮输入内容
   * @param options 可选配置（支持 version 切换与模型注入）
   * @returns 模型生成的字符串回复
   */
  async chat(
    sessionId: string,
    input: string,
    options?: ChatOptions,
  ): Promise<string> {
    const version = options?.version ?? 'standard';
    const chainWithHistory = this.createRunnableWithHistory(
      version,
      options?.customModel,
    );

    const response = await chainWithHistory.invoke(
      { input: input?.trim() ?? '' },
      {
        configurable: {
          sessionId,
        },
      },
    );

    return response;
  }

  /**
   * 获取指定会话的历史记录列表
   *
   * @param sessionId 会话唯一标识符
   * @param version 会话版本（默认为 'standard'）
   * @returns 统一角色与内容的结构体列表
   */
  async getHistory(
    sessionId: string,
    version: MemoryVersion = 'standard',
  ): Promise<HistoryMessageItem[]> {
    const history = this.getOrCreateHistory(sessionId, version);
    const messages = await history.getMessages();

    return messages.map((msg) => ({
      role: msg.type,
      content:
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content),
    }));
  }

  /**
   * 获取指定会话的原始 BaseMessage[] 列表
   */
  async getRawHistory(
    sessionId: string,
    version: MemoryVersion = 'standard',
  ): Promise<BaseMessage[]> {
    const history = this.getOrCreateHistory(sessionId, version);
    return history.getMessages();
  }

  /**
   * 手动向会话追加历史对话对 (human 与 ai)
   *
   * @param sessionId 会话唯一标识符
   * @param human 用户发送内容
   * @param ai 模型回复内容
   * @param version 可选指定追加版本；若未传入则同时追加至所有版本
   */
  async appendMessage(
    sessionId: string,
    human: string,
    ai: string,
    version?: MemoryVersion,
  ): Promise<void> {
    const targetVersions: MemoryVersion[] = version
      ? [version]
      : ['standard', 'trimmed'];

    for (const v of targetVersions) {
      const history = this.getOrCreateHistory(sessionId, v);
      await history.addUserMessage(human);
      await history.addAIMessage(ai);
    }
  }

  /**
   * 清除指定会话的历史记忆
   *
   * @param sessionId 会话唯一标识符
   * @param version 可选指定清除版本；若未传入则清理该 sessionId 在所有版本中的记忆
   */
  async clearSession(
    sessionId: string,
    version?: MemoryVersion,
  ): Promise<void> {
    if (!version || version === 'standard') {
      const std = this.standardStore.get(sessionId);
      if (std) {
        await std.clear();
        this.standardStore.delete(sessionId);
      }
    }

    if (!version || version === 'trimmed') {
      const tri = this.trimmedStore.get(sessionId);
      if (tri) {
        await tri.clear();
        this.trimmedStore.delete(sessionId);
      }
    }
  }
}
