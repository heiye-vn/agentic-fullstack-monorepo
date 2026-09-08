import { Injectable } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AIMessageChunk } from '@langchain/core/messages';
import { createChatModel } from './model.factory.js';
import { requirementPromptTemplate } from './requirement.prompt-builder.js';
import { requirementChain } from './requirement.chain.js';

/** 系统角色 Prompt */
const SYSTEM_PROMPT =
  '你是一名需求结构化抽取助手，负责将用户的自然语言需求转化为结构化的需求描述。';

/** 默认用户输入 */
export const DEFAULT_USER_INPUT = '用户注册时必须绑定手机号，密码至少8位';

// ============================================================
// 响应类型定义
// ============================================================

export interface PromptPreviewMessage {
  role: string;
  content: string;
}

export interface PromptPreviewResult {
  input: string;
  messages: PromptPreviewMessage[];
}

export interface InvokeResult {
  content: string;
  model: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface BatchResult {
  results: InvokeResult[];
  totalDurationMs: number;
}

export interface ChainInvokeResult {
  content: string;
}

export interface ChainBatchResult {
  results: string[];
  totalDurationMs: number;
}

@Injectable()
export class LlmService {
  /**
   * 单次调用：返回完整响应
   */
  async invoke(userInput?: string): Promise<InvokeResult> {
    const model = createChatModel({ streaming: false });
    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(userInput ?? DEFAULT_USER_INPUT),
    ];

    const response = await model.invoke(messages);

    return {
      content:
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content),
      model: String(
        response.response_metadata?.model_name ??
          response.response_metadata?.model ??
          model.model ??
          'unknown',
      ),
      usage: {
        inputTokens: response.usage_metadata?.input_tokens,
        outputTokens: response.usage_metadata?.output_tokens,
        totalTokens: response.usage_metadata?.total_tokens,
      },
    };
  }

  /**
   * 流式调用：返回 AsyncGenerator，逐 chunk 产出
   */
  async *stream(userInput?: string): AsyncGenerator<string> {
    const model = createChatModel({ streaming: true });
    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(userInput ?? DEFAULT_USER_INPUT),
    ];

    const stream = await model.stream(messages);

    for await (const chunk of stream as AsyncIterable<AIMessageChunk>) {
      const text =
        typeof chunk.content === 'string'
          ? chunk.content
          : JSON.stringify(chunk.content);
      if (text) {
        yield text;
      }
    }
  }

  /**
   * 批量调用：并行处理多条输入
   */
  async batch(inputs?: string[]): Promise<BatchResult> {
    const model = createChatModel({ streaming: false });
    const userInputs = inputs?.length ? inputs : [DEFAULT_USER_INPUT];

    const startTime = Date.now();

    const messagesBatch = userInputs.map((input) => [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(input),
    ]);

    const responses = await model.batch(messagesBatch);

    const results: InvokeResult[] = responses.map((response) => ({
      content:
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content),
      model: String(
        response.response_metadata?.model_name ??
          response.response_metadata?.model ??
          model.model ??
          'unknown',
      ),
      usage: {
        inputTokens: response.usage_metadata?.input_tokens,
        outputTokens: response.usage_metadata?.output_tokens,
        totalTokens: response.usage_metadata?.total_tokens,
      },
    }));

    return {
      results,
      totalDurationMs: Date.now() - startTime,
    };
  }

  /**
   * 模板预览：仅渲染提示模板，不调用模型
   */
  async previewPrompt(userInput?: string): Promise<PromptPreviewResult> {
    const input = userInput?.trim() || DEFAULT_USER_INPUT;
    const formattedMessages = await requirementPromptTemplate.formatMessages({
      input,
    });

    return {
      input,
      messages: formattedMessages.map((msg) => ({
        role: msg.type,
        content:
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content),
      })),
    };
  }

  /**
   * 模板到模型：模板渲染 -> formatMessages -> 调用模型
   */
  async invokeWithPrompt(userInput?: string): Promise<InvokeResult> {
    const input = userInput?.trim() || DEFAULT_USER_INPUT;
    const model = createChatModel({ streaming: false });
    const messages = await requirementPromptTemplate.formatMessages({
      input,
    });

    const response = await model.invoke(messages);

    return {
      content:
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content),
      model: String(
        response.response_metadata?.model_name ??
          response.response_metadata?.model ??
          model.model ??
          'unknown',
      ),
      usage: {
        inputTokens: response.usage_metadata?.input_tokens,
        outputTokens: response.usage_metadata?.output_tokens,
        totalTokens: response.usage_metadata?.total_tokens,
      },
    };
  }

  /**
   * 链式调用：通过 requirementChain 执行 invoke
   * 输入为空时统一使用 DEFAULT_USER_INPUT
   */
  async chainInvoke(userInput?: string): Promise<ChainInvokeResult> {
    const input = userInput?.trim() || DEFAULT_USER_INPUT;
    const content = await requirementChain.invoke({ input });
    return { content };
  }

  /**
   * 链式流式调用：通过 requirementChain.stream 逐 chunk 产出纯文本
   */
  async *chainStream(userInput?: string): AsyncGenerator<string> {
    const input = userInput?.trim() || DEFAULT_USER_INPUT;
    const stream = await requirementChain.stream({ input });
    for await (const chunk of stream) {
      if (chunk) {
        yield chunk;
      }
    }
  }

  /**
   * 链式批量调用：通过 requirementChain.batch 并发处理
   */
  async chainBatch(inputs?: string[]): Promise<ChainBatchResult> {
    const userInputs = inputs?.length ? inputs : [DEFAULT_USER_INPUT];
    const startTime = Date.now();
    const batchPayload = userInputs.map((input) => ({ input }));
    const results = await requirementChain.batch(batchPayload);

    return {
      results,
      totalDurationMs: Date.now() - startTime,
    };
  }
}
