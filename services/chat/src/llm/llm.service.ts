import { Injectable } from '@nestjs/common';
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { AIMessageChunk, AIMessage } from '@langchain/core/messages';
import { createChatModel } from './model.factory.js';
import { requirementPromptTemplate } from './requirement.prompt-builder.js';
import { requirementChain } from './requirement.chain.js';
import { basicTools, toolsByName } from './tools/basic.tools.js';

/** 系统角色 Prompt */
const SYSTEM_PROMPT =
  '你是一名需求结构化抽取助手，负责将用户的自然语言需求转化为结构化的需求描述。';

/** 工具调用系统提示词：指导模型针对需求抽取场景分析并调用校验或查询工具 */
const TOOL_SYSTEM_PROMPT = `
你是一名资深需求分析与系统架构专家。
你的任务是对用户给出的需求文本进行深入分析与结构化梳理。

你拥有以下两个专业工具：
1. check_constraint_validity：校验需求中的约束条件是否明确、有效且合规；
2. lookup_entity_definition：查询需求中涉及实体的标准领域定义与属性。

执行指引：
- 当识别到需求中的具体约束条件时，调用 check_constraint_validity 进行合规性检查；
- 当识别到需求中的业务实体时，调用 lookup_entity_definition 查询其官方领域定义；
- 根据工具执行返回的结果，最终给出全面、规范的需求分析结论。
`.trim();

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

export interface ToolCallItem {
  id?: string;
  name: string;
  args: Record<string, any>;
}

export interface ToolBindResult {
  content: string;
  toolCalls: ToolCallItem[];
  model: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface ToolLoopStep {
  iteration: number;
  toolCall: ToolCallItem;
  toolOutput: string;
}

export interface ToolLoopResult {
  input: string;
  finalContent: string;
  iterations: number;
  steps: ToolLoopStep[];
  model: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
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

  /**
   * 工具绑定单次调用：模型结合输入与工具定义，自主决定是否生成 tool_calls
   * 统一使用需求抽取场景
   * @param userInput 用户输入文本
   * @param customModel 可选传入自定义模型实例，支持单元测试 Mock
   */
  async toolBind(
    userInput?: string,
    customModel?: any,
  ): Promise<ToolBindResult> {
    const input = userInput?.trim() || DEFAULT_USER_INPUT;
    const model = customModel ?? createChatModel({ streaming: false });
    const modelWithTools = model.bindTools
      ? model.bindTools(basicTools)
      : model;

    const messages = [
      new SystemMessage(TOOL_SYSTEM_PROMPT),
      new HumanMessage(
        `请对以下需求进行抽取分析，并调用工具校验约束及查询实体定义：\n${input}`,
      ),
    ];

    const response = (await modelWithTools.invoke(messages)) as AIMessage;
    const rawToolCalls = response.tool_calls ?? [];

    const toolCalls: ToolCallItem[] = rawToolCalls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      args: tc.args ?? {},
    }));

    return {
      content:
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content),
      toolCalls,
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
   * 工具自动循环调用（Tool Loop / ReAct Loop）
   * 自动调度并执行模型生成的 tool_calls，封装 ToolMessage 回传模型，直至模型完成思考并输出最终结论
   * 统一使用需求抽取场景
   * @param userInput 用户输入文本
   * @param maxIterations 最大循环迭代次数（默认 5 次，防止死循环）
   * @param customModel 可选传入自定义模型实例，支持单元测试 Mock
   */
  async toolLoop(
    userInput?: string,
    maxIterations = 5,
    customModel?: any,
  ): Promise<ToolLoopResult> {
    const input = userInput?.trim() || DEFAULT_USER_INPUT;
    const model = customModel ?? createChatModel({ streaming: false });
    const modelWithTools = model.bindTools
      ? model.bindTools(basicTools)
      : model;

    const messages: BaseMessage[] = [
      new SystemMessage(TOOL_SYSTEM_PROMPT),
      new HumanMessage(
        `请对以下需求进行完整抽取分析，自动调用工具完成约束检查与实体查询，并给出最终综合结论：\n${input}`,
      ),
    ];

    const steps: ToolLoopStep[] = [];
    let iterations = 0;
    let latestResponse: AIMessage | null = null;

    while (iterations < maxIterations) {
      iterations++;
      const response = (await modelWithTools.invoke(messages)) as AIMessage;
      latestResponse = response;
      messages.push(response);

      const rawToolCalls = response.tool_calls ?? [];
      // 若无工具调用，说明模型已总结完毕，退出循环
      if (rawToolCalls.length === 0) {
        break;
      }

      // 执行当前轮次的所有工具调用
      for (const tc of rawToolCalls) {
        const toolCallItem: ToolCallItem = {
          id: tc.id,
          name: tc.name,
          args: tc.args ?? {},
        };

        const targetTool = toolsByName[tc.name];
        let toolOutputStr = '';

        if (targetTool) {
          try {
            const rawOutput = await targetTool.invoke(tc.args);
            toolOutputStr =
              typeof rawOutput === 'string'
                ? rawOutput
                : JSON.stringify(rawOutput);
          } catch (err) {
            toolOutputStr = JSON.stringify({
              error: `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        } else {
          toolOutputStr = JSON.stringify({
            error: `Tool '${tc.name}' not found. Available tools: ${Object.keys(toolsByName).join(', ')}`,
          });
        }

        steps.push({
          iteration: iterations,
          toolCall: toolCallItem,
          toolOutput: toolOutputStr,
        });

        // 构造 ToolMessage 追加到上下文中供模型在下一轮理解
        messages.push(
          new ToolMessage({
            tool_call_id: tc.id ?? `call_${Date.now()}_${Math.random()}`,
            content: toolOutputStr,
            name: tc.name,
          }),
        );
      }
    }

    const finalContent = latestResponse
      ? typeof latestResponse.content === 'string'
        ? latestResponse.content
        : JSON.stringify(latestResponse.content)
      : '';

    return {
      input,
      finalContent,
      iterations,
      steps,
      model: String(
        latestResponse?.response_metadata?.model_name ??
          latestResponse?.response_metadata?.model ??
          model.model ??
          'unknown',
      ),
      usage: {
        inputTokens: latestResponse?.usage_metadata?.input_tokens,
        outputTokens: latestResponse?.usage_metadata?.output_tokens,
        totalTokens: latestResponse?.usage_metadata?.total_tokens,
      },
    };
  }
}
