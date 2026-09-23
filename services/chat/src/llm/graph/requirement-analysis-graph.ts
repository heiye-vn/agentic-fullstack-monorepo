import {
  Annotation,
  MessagesAnnotation,
  StateGraph,
  START,
  END,
  MemorySaver,
  type BaseCheckpointSaver,
} from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { z } from 'zod';
import {
  defaultSubAgents,
  type SubAgents,
  type ExtractedRequirement,
  type ClarificationResult,
} from '../agents/sub-agents.js';
import { safeParseJson } from '../agents/orchestrator.service.js';
import { createChatModel } from '../model.factory.js';
import {
  analysisTools,
  searchRequirementTool,
  checkConflictsTool,
} from '../tools/business.tools.js';
import { createAnalysisSupervisorSubGraph } from './experts.js';
import type { ExpertRagDeps, ExpertMcpDeps, ExpertSkillDeps } from './experts.js';
import { setGraphName } from '../../observability/trace-context.js';

export {
  analysisTools,
  searchRequirementTool,
  checkConflictsTool,
  createAnalysisSupervisorSubGraph,
};
export type { ExpertRagDeps, ExpertMcpDeps, ExpertSkillDeps };

/**
 * 意图分类 Zod Schema
 */
export const IntentClassificationSchema = z.object({
  intent: z
    .enum(['analyze', 'query', 'chat'])
    .describe(
      '用户意图类别：analyze（需求分析）、query（需求状态/进度/文档查询）、chat（日常闲聊与问候）',
    ),
  reasoning: z.string().describe('意图分类的判断依据与推导理由'),
});

export type IntentClassification = z.infer<typeof IntentClassificationSchema>;

/**
 * 第九章 9.4: Handoff 分诊 Zod Schema
 * action:
 * - 'answer': 闲聊/简单咨询，直接回答用户
 * - 'handoff_to_query': 查询已有需求状态或信息，交接给 queryHandler
 * - 'handoff_to_analysis': 复杂新需求，交接给抽取与多专家分析
 */
export const triageSchema = z.object({
  action: z
    .enum(['answer', 'handoff_to_query', 'handoff_to_analysis'])
    .describe(
      '分诊决策：answer（日常闲聊/通用咨询，直接回复）、handoff_to_query（查询已有需求状态，移交查询处理）、handoff_to_analysis（提出新需求，移交多专家分析链路）',
    ),
  response: z
    .string()
    .default('')
    .describe('当 action="answer" 时直接回复用户的内容'),
  reason: z
    .string()
    .nullable()
    .optional()
    .describe('交接理由（可选）'),
});

export type TriageOutput = z.infer<typeof triageSchema>;

/**
 * 意图分类 System Prompt
 * 包含规则、示例、边界处理策略与优先级
 */
export const INTENT_CLASSIFIER_SYSTEM_PROMPT = `你是一个专业的软件需求工程意图分类助手。你需要精准分析用户的输入文本，并将其分类为以下三类之一：

1. "query"（需求查询）：
   - 核心特征：查询系统中已有需求的状态、当前进度、历史属性、验收标准、风险报告或SRS说明书。
   - 典型示例：
     * "查询 REQ-20240315-001 的当前状态"
     * "REQ-20240415-002 的进度如何"
     * "查询 REQ-20240315-001 的风险分析报告"
     * "查一下登录功能的需求评审记录"
   - 边界与优先级策略：
     * 【最高优先级】：只要输入中包含明确的需求编号（如 REQ-YYYYMMDD-XXX），且动词是查询、了解进度、查看状态或查阅报告，必须判定为 "query"。
     * 【多重含义处理】：即便句子中包含“分析报告”、“风险分析”等字眼（例如“查询 REQ-20240315-001 的风险分析报告”），因为其核心意图是“查询现有需求的报告”而非对新功能做分析，因此“查询”优先级绝对高于“分析”，必须判定为 "query"！

2. "chat"（普通闲聊与交流）：
   - 核心特征：日常礼貌问候、天气交流、通用闲聊或与软件业务需求完全无关的对话。
   - 典型示例：
     * "你好，今天天气不错"
     * "早上好！"
     * "你能帮我做些什么？"
     * "哈哈太棒了，谢谢你"
   - 优先级规则：无任何业务开发或需求编号的纯日常交流，优先判定为 "chat"。

3. "analyze"（需求分析与规划）：
   - 核心特征：用户提出新的软件产品需求、功能特性、业务规则，需要进行结构化抽取、澄清诊断、技术多维分析与风险评估。
   - 典型示例：
     * "分析需求 REQ-20240315-001：开发在线问卷系统，支持多种题型..."
     * "我需要一个用户登录功能"
     * "为商城系统设计一个带优惠券和积分抵扣的购物车功能"
   - 边界规则：
     * 无论需求描述极其详尽（包含多种题型、约束条件）还是非常简短（如“我需要一个用户登录功能”），只要目的是为了提出或分析新功能，必须判定为 "analyze"。

4. 综合优先级与模糊意图规则：
   - 优先级：带编号的查询/状态了解 (query) > 纯日常闲聊 (chat) > 默认/新需求提出 (analyze)。
   - 模糊意图（如“看看 REQ-20240315-001 有没有什么问题”）：因带有具体需求编号且重在排查已登记需求，应明确决断为 "query"（或针对性分析），绝不可卡住或抛错。

请严格依据上述准则进行判定，输出 JSON 格式的 intent 和 reasoning。`;

/**
 * 意图分类降级兜底规则引擎
 * 针对网络超时或大模型格式化异常时采用正则与关键字提取
 */
export function fallbackIntentClassifier(input: string): {
  intent: 'analyze' | 'query' | 'chat';
  reasoning: string;
} {
  const text = (input ?? '').trim();
  const reqIdPattern = /REQ-[A-Za-z0-9-]+/i;
  const hasReqId = reqIdPattern.test(text);

  // 1. 优先检测纯闲聊
  const chatKeywords = [
    '你好',
    '您好',
    '天气',
    '早上好',
    '下午好',
    '晚上好',
    '嗨',
    'hi',
    'hello',
    '再见',
    '拜拜',
    '谢谢',
  ];
  const isPureChat =
    chatKeywords.some((w) => text.toLowerCase().includes(w)) &&
    !hasReqId &&
    !text.includes('需求') &&
    !text.includes('开发') &&
    !text.includes('功能');

  if (isPureChat) {
    return {
      intent: 'chat',
      reasoning: '降级兜底：命中日常问候与闲聊关键词，判定为 chat',
    };
  }

  // 2. 多重含义与查询优先：有查询动作或状态进度关键词
  const queryKeywords = [
    '查询',
    '查一下',
    '查看',
    '状态',
    '进度',
    '情况',
    '报告',
  ];
  const hasQueryKeyword = queryKeywords.some((w) => text.includes(w));

  if (
    hasQueryKeyword &&
    (hasReqId || text.startsWith('查询') || text.includes('进度'))
  ) {
    return {
      intent: 'query',
      reasoning:
        '降级兜底：检测到查询动词/状态/进度，“查询”优先级高于“分析”，判定为 query',
    };
  }

  // 3. 带有需求编号的询问或审查
  if (
    hasReqId &&
    (text.includes('看看') ||
      text.includes('问题') ||
      text.includes('如何') ||
      text.includes('怎样'))
  ) {
    return {
      intent: 'query',
      reasoning: '降级兜底：带需求编号且询问状态/问题，判定为 query',
    };
  }

  // 4. 需求分析与功能诉求
  const analyzeKeywords = [
    '分析需求',
    '开发',
    '我需要',
    '需要',
    '功能',
    '系统',
    '模块',
    '实现',
  ];
  if (analyzeKeywords.some((w) => text.includes(w))) {
    return {
      intent: 'analyze',
      reasoning: '降级兜底：检测到需求分析或功能开发关键词，判定为 analyze',
    };
  }

  // 5. 默认 analyze
  return {
    intent: 'analyze',
    reasoning: '降级兜底：未匹配到特定模式，默认走 analyze 意图',
  };
}

/**
 * 需求分析状态定义 (RequirementAnalysisState)
 * 扩展支持：
 * - messages: 复用 MessagesAnnotation.spec，维护对话历史
 * - intent: 用户输入意图分类 ('analyze' | 'query' | 'chat')
 * - queryResponse: 需求查询分支响应结果
 * - chatResponse: 闲聊分支响应结果
 * - steps: 执行路径节点跟踪记录
 * - extracted: 结构化抽取结果
 * - clarified: 需求澄清诊断结果
 * - analysis / analysisResult: 多维分析报告文本
 * - risk / riskResult: 风险评估结果文本
 * - summary: 最终需求分析总结报告（通用兼容字段）
 */
export const RequirementAnalysisState = Annotation.Root({
  ...MessagesAnnotation.spec,
  intent: Annotation<'analyze' | 'query' | 'chat' | 'risk_only'>({
    reducer: (_, next) => next,
    default: () => 'analyze',
  }),
  queryResponse: Annotation<string | undefined>({
    reducer: (_, next) => next,
    default: () => undefined,
  }),
  chatResponse: Annotation<string | undefined>({
    reducer: (_, next) => next,
    default: () => undefined,
  }),
  steps: Annotation<string[]>({
    reducer: (prev, next) =>
      next
        ? [...(prev ?? []), ...(Array.isArray(next) ? next : [next])]
        : (prev ?? []),
    default: () => [],
  }),
  extracted: Annotation<ExtractedRequirement | Record<string, any> | undefined>(
    {
      reducer: (_, next) => next,
      default: () => undefined,
    },
  ),
  clarified: Annotation<ClarificationResult | Record<string, any> | undefined>({
    reducer: (_, next) => next,
    default: () => undefined,
  }),
  analysis: Annotation<string | undefined>({
    reducer: (_, next) => next,
    default: () => undefined,
  }),
  analysisResult: Annotation<string | undefined>({
    reducer: (_, next) => next,
    default: () => undefined,
  }),
  risk: Annotation<string | undefined>({
    reducer: (_, next) => next,
    default: () => undefined,
  }),
  riskResult: Annotation<string | undefined>({
    reducer: (_, next) => next,
    default: () => undefined,
  }),
  summary: Annotation<string>({
    reducer: (_, next) => next,
    default: () => '',
  }),
  toolLoopCount: Annotation<number>({
    reducer: (_, next) => (typeof next === 'number' ? next : 0),
    default: () => 0,
  }),
  critique: Annotation<string>({
    reducer: (_, next) => next ?? '',
    default: () => '',
  }),
  reviseCount: Annotation<number>({
    reducer: (_, next) => (typeof next === 'number' ? next : 0),
    default: () => 0,
  }),
  summaryDraft: Annotation<string>({
    reducer: (_, next) => next ?? '',
    default: () => '',
  }),
  // 第九章 State 契约：原始输入文本
  input: Annotation<string>({
    reducer: (_, next) => next ?? '',
    default: () => '',
  }),
  /**
   * 第二十章 20.3：知识库检索结果（RAG 上下文）。
   *
   * 此前本项目的 State **压根没有这个字段** —— 编排层把检索结果作为入参对象的一个 key
   * 传给了图，但 LangGraph 只会保留 Annotation 里声明过的 channel，未声明的 key 直接被丢弃。
   * 结果是 actorNode（写报告）和四个专家节点在类型上、在运行时都拿不到它，
   * 「检索了但不影响报告」在这里比 autix 更彻底：不是没消费，是压根没落到 State 上。
   */
  retrievedContext: Annotation<string | undefined>({
    reducer: (_, next) => next,
    default: () => undefined,
  }),
  // 第九章 9.2: 多专家分析结果字段与激活专家列表
  functionalAnalysis: Annotation<string>({
    reducer: (prev, next) => (next && next.trim() ? next : (prev ?? '')),
    default: () => '',
  }),
  performanceAnalysis: Annotation<string>({
    reducer: (prev, next) => (next && next.trim() ? next : (prev ?? '')),
    default: () => '',
  }),
  securityAnalysis: Annotation<string>({
    reducer: (prev, next) => (next && next.trim() ? next : (prev ?? '')),
    default: () => '',
  }),
  complianceAnalysis: Annotation<string>({
    reducer: (prev, next) => (next && next.trim() ? next : (prev ?? '')),
    default: () => '',
  }),
  activeExperts: Annotation<string[]>({
    reducer: (_prev, next) => (next && next.length > 0 ? next : (_prev ?? [])), // 每次由 supervisor 覆盖
    default: () => [],
  }),
  // 第九章 9.4: Handoff 分诊交接理由
  handoffReason: Annotation<string>({
    reducer: (_, next) => next ?? '',
    default: () => '',
  }),
});

export type RequirementAnalysisStateType =
  typeof RequirementAnalysisState.State;
export type RequirementAnalysisStateUpdate =
  typeof RequirementAnalysisState.Update;

/**
 * 辅助从当前状态提取用户最新输入文本
 */
export function extractInputText(state: RequirementAnalysisStateType): string {
  const messages = state.messages;
  if (!messages || messages.length === 0) {
    return '';
  }
  const lastMsg = messages[messages.length - 1];
  if (typeof lastMsg.content === 'string') {
    return lastMsg.content;
  }
  if (Array.isArray(lastMsg.content)) {
    return lastMsg.content
      .map((c) => (typeof c === 'string' ? c : (c as any).text || ''))
      .join('');
  }
  return String(lastMsg.content ?? '');
}

/**
 * 0. 意图分类节点 (classifier)
 */
export async function classifierNode(
  state: RequirementAnalysisStateType,
  options?: { model?: BaseChatModel },
): Promise<Partial<RequirementAnalysisStateType>> {
  const input = extractInputText(state);
  const model =
    options?.model ?? createChatModel({ temperature: 0, streaming: false });

  try {
    const structuredModel = (model as any).withStructuredOutput(
      IntentClassificationSchema,
    );
    const classification = (await structuredModel.invoke([
      new SystemMessage(INTENT_CLASSIFIER_SYSTEM_PROMPT),
      new HumanMessage(input),
    ])) as IntentClassification;

    const intent = classification?.intent || 'analyze';
    return {
      intent,
      steps: ['classifier'],
    };
  } catch {
    const fallback = fallbackIntentClassifier(input);
    return {
      intent: fallback.intent,
      steps: ['classifier'],
    };
  }
}

/**
 * 0. Handoff 分诊节点 (triageNode) - 第九章 9.4
 * 接收 state 和 config: { model } 参数，通过结构化输出决定是直接回复还是交接专家
 */
export async function triageNode(
  state: RequirementAnalysisStateType,
  config?: { model?: BaseChatModel } | any,
): Promise<Partial<RequirementAnalysisStateType>> {
  const model =
    config?.model ?? createChatModel({ temperature: 0, streaming: false });
  const input = extractInputText(state) || state.input || '';

  try {
    const structuredModel = (model as any).withStructuredOutput(triageSchema);
    const systemPrompt = `你是需求分诊智能体 (Triage Agent)。评估用户的需求输入并做出分诊决策：
- 闲聊、问候、术语解释、通用咨询：直接作答并回复 -> action: 'answer'（直接在 response 字段中回答用户）
- 查询已有需求的状态、进度、属性或报告（特别包含 REQ- 需求编号） -> action: 'handoff_to_query'
- 提出新功能或完整业务需求，需要结构化抽取、多维专家分析 -> action: 'handoff_to_analysis'
在做交接时，给出简要的交接理由 reason。`;

    const messages = state.messages ?? [];
    const callMessages: BaseMessage[] = [new SystemMessage(systemPrompt), ...messages];
    if (messages.length === 0 && input) {
      callMessages.push(new HumanMessage(input));
    }

    const result = (await structuredModel.invoke(callMessages)) as TriageOutput;

    if (result.action === 'answer') {
      const reply = result.response || '您好，请问有什么可以协助您？';
      return {
        messages: [new AIMessage(reply)],
        intent: 'chat',
        chatResponse: reply,
        summary: reply,
        handoffReason: result.reason || '',
        steps: ['triage'],
      };
    }

    if (result.action === 'handoff_to_query') {
      const reason = result.reason || '查询已有需求状态或信息';
      return {
        intent: 'query',
        handoffReason: reason,
        steps: ['triage'],
      };
    }

    // handoff_to_analysis 及默认分析分支
    const reason = result.reason || '已分诊交接给需求分析链路';
    return {
      messages: [new AIMessage(`[分诊交接 → 需求分析] 理由: ${reason}`)],
      intent: 'analyze',
      handoffReason: reason,
      steps: ['triage'],
    };
  } catch {
    // 降级容灾：基于规则引擎进行 fallback 分类
    const fallback = fallbackIntentClassifier(input);
    if (fallback.intent === 'chat') {
      const reply = '您好！我是需求分析助手，请问有什么可以帮您？';
      return {
        messages: [new AIMessage(reply)],
        intent: 'chat',
        chatResponse: reply,
        summary: reply,
        handoffReason: '降级兜底：识别为日常闲聊',
        steps: ['triage'],
      };
    }
    if (fallback.intent === 'query') {
      return {
        intent: 'query',
        handoffReason: '降级兜底：识别为需求查询',
        steps: ['triage'],
      };
    }
    return {
      messages: [new AIMessage('[分诊交接 → 需求分析] 理由: 降级兜底移交')],
      intent: 'analyze',
      handoffReason: '降级兜底：默认移交需求分析',
      steps: ['triage'],
    };
  }
}

/**
 * 提取 triage 直答内容并转成 token 事件
 *
 * 背景见 `routeByIntent` 的 9.4 Handoff 优化：triage 识别出 chat/query 意图时会
 * 直接把答复写进状态（chatResponse / queryResponse），图随即短路到 END。
 * 这类答复无法流式（结构化输出），所以在这里按「一整段」补发一次 token 事件，
 * 让上层 SSE 管道有内容可推，避免调用方触发重复生成的兜底逻辑。
 */
function* emitDirectReplyTokens(
  nodeName: string,
  output: unknown,
): Generator<
  { type: 'token'; node: string; step: string; content: string },
  void,
  unknown
> {
  if (nodeName !== 'triage' && nodeName !== 'classifier') return;
  if (!output || typeof output !== 'object') return;

  const patch = output as Record<string, unknown>;
  const direct = patch.chatResponse ?? patch.queryResponse;

  if (typeof direct === 'string' && direct.trim()) {
    yield { type: 'token', node: nodeName, step: nodeName, content: direct };
  }
}

/**
 * 把模型的流式输出攒成完整字符串
 *
 * 为什么闲聊/查询节点要走 stream 而不是 invoke：
 * LangGraph 的 `streamEvents(v2)` 只在节点内部真正发起流式 LLM 调用时才会产生
 * `on_chat_model_stream` 事件。用 `invoke()` 的话上层一个 token 都收不到，
 * 结果是 SSE 管道里没有 markdown 帧，只能由调用方再跑一遍兜底链 —— 白白多一次
 * 模型调用，用户还要多等一轮。这里改成 stream 后 token 就能正常透传到前端。
 */
async function collectModelStream(
  model: BaseChatModel,
  messages: BaseMessage[],
): Promise<string> {
  let content = '';

  try {
    for await (const chunk of await model.stream(messages)) {
      const piece =
        typeof chunk?.content === 'string'
          ? chunk.content
          : Array.isArray(chunk?.content)
            ? chunk.content
                .map((c: unknown) =>
                  typeof c === 'string' ? c : (c as { text?: string })?.text ?? '',
                )
                .join('')
            : '';
      content += piece;
    }
  } catch {
    // 流式失败不应让整个图崩掉，降级为一次性调用拿回完整结果
    const response = await model.invoke(messages);
    content =
      typeof response?.content === 'string'
        ? response.content
        : JSON.stringify(response?.content ?? '');
  }

  return content;
}

/**
 * 需求查询处理节点 (queryHandler)
 */
export async function queryHandlerNode(
  state: RequirementAnalysisStateType,
  options?: { model?: BaseChatModel },
): Promise<Partial<RequirementAnalysisStateType>> {
  const input = extractInputText(state);
  const model =
    options?.model ?? createChatModel({ temperature: 0, streaming: true });

  const response = await collectModelStream(model, [
    new SystemMessage('你是需求查询助手'),
    new HumanMessage(input),
  ]);

  const content = typeof response === 'string' ? response : String(response ?? '');

  return {
    queryResponse: content,
    summary: content,
    steps: ['queryHandler'],
  };
}

/**
 * 闲聊处理节点 (chatHandler)
 */
export async function chatHandlerNode(
  state: RequirementAnalysisStateType,
  options?: { model?: BaseChatModel },
): Promise<Partial<RequirementAnalysisStateType>> {
  const input = extractInputText(state);
  const model =
    options?.model ?? createChatModel({ temperature: 0.7, streaming: true });

  const response = await collectModelStream(model, [
    new SystemMessage('你是友好的AI助手'),
    new HumanMessage(input),
  ]);

  const content = typeof response === 'string' ? response : String(response ?? '');

  return {
    chatResponse: content,
    summary: content,
    steps: ['chatHandler'],
  };
}

/**
 * 1. 需求抽取节点 (extractStep)
 */
export async function extractNode(
  state: RequirementAnalysisStateType,
  subAgents: SubAgents,
): Promise<Partial<RequirementAnalysisStateType>> {
  const input = extractInputText(state);
  const raw = await subAgents.extractAgent.invoke({
    input,
    history: [],
  });

  const extracted = safeParseJson<ExtractedRequirement>(raw, {
    rawGoal: input,
    action: input,
    coreFeature: input,
    targetUsers: '',
    businessGoal: '',
    constraints: [],
    priority: 'medium',
    isComplete: true,
    missingFields: [],
  });

  return {
    extracted,
    steps: ['extractStep'],
  };
}

/**
 * 2. 需求澄清节点 (clarifyStep)
 */
export async function clarifyNode(
  state: RequirementAnalysisStateType,
  subAgents: SubAgents,
): Promise<Partial<RequirementAnalysisStateType>> {
  // 9.6.2 HITL 保护：若外部已通过 updateState 注入人工澄清结论（例如 needsClarification === false），优先直接保留
  if (
    state.clarified &&
    typeof state.clarified === 'object' &&
    (state.clarified as any).needsClarification === false
  ) {
    return {
      clarified: state.clarified,
      steps: ['clarifyStep'],
    };
  }

  const input = extractInputText(state);
  const extractionStr =
    typeof state.extracted === 'string'
      ? state.extracted
      : JSON.stringify(state.extracted ?? {}, null, 2);

  const raw = await subAgents.clarifyAgent.invoke({
    input,
    extractResult: extractionStr,
    extraction: extractionStr,
  });

  const clarified = safeParseJson<ClarificationResult>(raw, {
    needsClarification: false,
    questions: [],
    clarificationQuestions: [],
    reason: '默认无需澄清',
  });

  return {
    clarified,
    steps: ['clarifyStep'],
  };
}

/**
 * 需求分析 ReAct 智能体 System Prompt
 */
export const ANALYSIS_AGENT_SYSTEM_PROMPT = `你是一个资深软件需求分析专家与系统架构师。你需要对用户提出的需求进行深入的多维技术分析。

你可以使用以下工具获取上下文与检测架构风险：
1. 如果输入中包含需求编号（如 REQ-XXX），先调用 search_requirement
2. 如果需要检测冲突，调用 check_conflicts
3. 获取足够信息后，直接输出分析结论，不再继续调用工具
4. 避免对相同参数重复调用同一工具

输出内容至少包含：
- 功能分解
- 用户故事
- 验收标准
- 技术复杂度评估`;

/**
 * ReAct 子图智能体思考与工具调用决策节点 (agentNode)
 */
export async function agentNode(
  state: RequirementAnalysisStateType,
  options?: { model?: BaseChatModel; subAgents?: SubAgents },
): Promise<Partial<RequirementAnalysisStateType>> {
  // 若提供了 subAgents?.analysisAgent 且未显式提供 model，则兼容单测 mock
  if (!options?.model && options?.subAgents?.analysisAgent) {
    const input = extractInputText(state);
    const extractionStr =
      typeof state.extracted === 'string'
        ? state.extracted
        : JSON.stringify(state.extracted ?? {}, null, 2);
    const mockAnalysis = await options.subAgents.analysisAgent.invoke({
      input,
      extractResult: extractionStr,
      extraction: extractionStr,
    });
    return {
      messages: [new AIMessage(mockAnalysis)],
      toolLoopCount: state.toolLoopCount ?? 0,
      steps: ['agent'],
    };
  }

  const model =
    options?.model ?? createChatModel({ temperature: 0.2, streaming: false });
  const modelWithTools = (model as any).bindTools
    ? (model as any).bindTools(analysisTools)
    : model;

  const contextItems = [
    state.extracted
      ? `已提取需求要素：${typeof state.extracted === 'string' ? state.extracted : JSON.stringify(state.extracted)}`
      : '',
    state.clarified
      ? `已澄清需求信息：${typeof state.clarified === 'string' ? state.clarified : JSON.stringify(state.clarified)}`
      : '',
  ].filter(Boolean);

  const contextPrompt = contextItems.length > 0 ? contextItems.join('\n') : '';

  const messagesToSend = [
    new SystemMessage(ANALYSIS_AGENT_SYSTEM_PROMPT),
    ...(state.messages ?? []),
  ];

  if (contextPrompt) {
    messagesToSend.push(new HumanMessage(contextPrompt));
  }

  const response = await modelWithTools.invoke(messagesToSend);

  const hasToolCalls = Boolean((response as any)?.tool_calls?.length > 0);
  const currentCount = state.toolLoopCount ?? 0;
  const nextCount = hasToolCalls ? currentCount + 1 : currentCount;

  return {
    messages: [response],
    toolLoopCount: nextCount,
    steps: ['agent'],
  };
}

/**
 * ReAct 子图工具调用条件路由 (shouldCallTools)
 * 硬上限检查：达到 6 次时强制结束，避免死循环
 */
export function shouldCallTools(
  state: RequirementAnalysisStateType,
): 'tools' | 'finalize' {
  const currentCount = state.toolLoopCount ?? 0;
  const toolMessagesCount = (state.messages ?? []).filter(
    (m: any) => m._getType?.() === 'tool' || m.role === 'tool',
  ).length;

  // 硬上限保护：工具轮次达到 6 次时强制退出
  if (currentCount >= 6 || toolMessagesCount >= 6) {
    return 'finalize';
  }

  const lastMsg = state.messages?.at(-1) as any;
  if (lastMsg?.tool_calls && lastMsg.tool_calls.length > 0) {
    return 'tools';
  }

  return 'finalize';
}

/**
 * ReAct 子图结论收敛节点 (finalizeNode)
 * 从 messages 中提取最后一条 AI 回复，写入 analysisResult 与 analysis
 * 若最后一条为空，提供安全降级
 */
export async function finalizeNode(
  state: RequirementAnalysisStateType,
): Promise<Partial<RequirementAnalysisStateType>> {
  const messages = state.messages ?? [];
  let lastAiMsg: any = null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as any;
    if (
      msg._getType?.() === 'ai' ||
      msg.constructor?.name?.includes('AIMessage') ||
      msg.role === 'assistant' ||
      msg.tool_calls !== undefined
    ) {
      lastAiMsg = msg;
      break;
    }
  }

  if (!lastAiMsg && messages.length > 0) {
    lastAiMsg = messages[messages.length - 1];
  }

  let text = '';
  if (lastAiMsg && typeof lastAiMsg.content === 'string') {
    text = lastAiMsg.content.trim();
  } else if (lastAiMsg && Array.isArray(lastAiMsg.content)) {
    text = lastAiMsg.content
      .map((c: any) => (typeof c === 'string' ? c : c?.text || ''))
      .join('\n')
      .trim();
  }

  // 安全降级：若最后一条 AI 回复为空（例如达到最大轮次强制退出时模型仍未输出文本）
  if (!text) {
    const input = extractInputText(state);
    text = `### 需求多维分析报告（安全降级）\n\n#### 1. 功能分解\n基于用户输入【${input || '业务需求'}】，系统涵盖核心操作链路、服务逻辑流转与数据持久化机制。\n\n#### 2. 用户故事\n作为一个系统用户，我期望系统功能完整可用，提供高可用响应与健全的状态反馈。\n\n#### 3. 验收标准\n- 核心功能端到端闭环无异常阻断\n- 边界入参具备类型校验与错误兜底\n- 遵守既有系统安全规范与认证授权流程\n\n#### 4. 技术复杂度评估\n- 复杂度等级：中等（Medium）\n- 架构考量：需遵循单点登录与接口鉴权标准，避免双重状态撕裂`;
  }

  return {
    analysis: text,
    analysisResult: text,
    steps: ['finalize'],
  };
}

/**
 * 构建并编译 ReAct 分析子图 (createAnalysisSubGraph)
 * 拓扑结构：
 * - START → agent
 * - agent --(有 tool_calls 且 < 6 轮)--> tools
 * - tools → agent
 * - agent --(无 tool_calls 或达到 6 轮上限)--> finalize
 * - finalize → END
 */
export function createAnalysisSubGraph(options?: AnalysisGraphOptions) {
  const model = options?.model;
  const subAgents = options?.subAgents;

  return new StateGraph(RequirementAnalysisState)
    .addNode('agent', (state: RequirementAnalysisStateType) =>
      agentNode(state, { model, subAgents }),
    )
    .addNode('tools', new ToolNode(analysisTools))
    .addNode('finalize', finalizeNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', shouldCallTools, {
      tools: 'tools',
      finalize: 'finalize',
    })
    .addEdge('tools', 'agent')
    .addEdge('finalize', END)
    .compile();
}

/**
 * 3. 多维分析单节点（保留用于向后兼容与独立测试）
 */
export async function analysisNode(
  state: RequirementAnalysisStateType,
  subAgents: SubAgents,
): Promise<Partial<RequirementAnalysisStateType>> {
  const input = extractInputText(state);
  const extractionStr =
    typeof state.extracted === 'string'
      ? state.extracted
      : JSON.stringify(state.extracted ?? {}, null, 2);

  const analysis = await subAgents.analysisAgent.invoke({
    input,
    extractResult: extractionStr,
    extraction: extractionStr,
  });

  return {
    analysis,
    analysisResult: analysis,
    steps: ['analysisStep'],
  };
}

/**
 * 4. 风险评估节点 (riskStep)
 */
export async function riskNode(
  state: RequirementAnalysisStateType,
  subAgents: SubAgents,
): Promise<Partial<RequirementAnalysisStateType>> {
  const input = extractInputText(state);
  const extractionStr =
    typeof state.extracted === 'string'
      ? state.extracted
      : JSON.stringify(state.extracted ?? {}, null, 2);

  const risk = await subAgents.riskAgent.invoke({
    input,
    extractResult: extractionStr,
    extraction: extractionStr,
  });

  return {
    risk,
    riskResult: risk,
    steps: ['riskStep'],
  };
}

/**
 * 需求评审 Critic 结构化输出 Zod Schema
 */
export const CriticReviewSchema = z.object({
  pass: z.boolean().describe('是否通过评审'),
  critique: z.string().describe('不通过时的修改意见，通过时为空字符串'),
  issues: z.array(z.string()).optional().describe('具体问题列表'),
});

export type CriticReview = z.infer<typeof CriticReviewSchema>;

/**
 * 第二十章 20.3：把 RAG 检索内容拼成一段可注入 prompt 的「参考资料」块。
 *
 * 修复历史 bug：检索结果早就写进了 state.retrievedContext，但生成报告的 actorNode
 * 和四个专家的 agentNode 都**从不读它** —— 检索到的资料只作为 metadata 回给前端，
 * 模型其实根本没看见（「检索了但不影响报告」）。
 *
 * 占位符必须过滤：主链路在检索为空或超时时会用占位文本兜底，若不拦截，
 * 就会把「无相关参考文档」当成真实资料写进 prompt，反而干扰模型判断。
 * 本项目存在两种占位写法（chat-stream 的与当时的 graph 默认值），一并拦掉。
 */
const EMPTY_CONTEXT_PLACEHOLDERS = [
  '无相关参考文档',
  '本次分析未检索到相关参考文档。',
];

export function buildRetrievedContextBlock(retrievedContext?: string): string {
  const ctx = (retrievedContext ?? '').trim();
  if (!ctx || EMPTY_CONTEXT_PLACEHOLDERS.includes(ctx)) return '';
  return `\n\n## 参考资料（来自知识库检索）\n${ctx}\n请优先依据以上资料作答，资料未覆盖处再用通用知识，不要编造资料中没有的事实。`;
}

/**
 * Critic-Refine 子图：生成初版报告 (actorNode)
 */
export async function actorNode(
  state: RequirementAnalysisStateType,
  options?: { model?: BaseChatModel; subAgents?: SubAgents },
): Promise<Partial<RequirementAnalysisStateType>> {
  const model =
    options?.model ?? createChatModel({ temperature: 0.3, streaming: false });
  const subAgents = options?.subAgents;

  // 兼容纯单测 mockSubAgents
  if (!options?.model && subAgents?.summaryAgent) {
    const input = extractInputText(state) || (state as any).input || '';
    const extractionStr =
      typeof state.extracted === 'string'
        ? state.extracted
        : JSON.stringify(state.extracted ?? {}, null, 2);
    const analysisContent = state.analysisResult ?? state.analysis ?? '';
    const riskContent = state.riskResult ?? state.risk ?? '';

    const summary = await subAgents.summaryAgent.invoke({
      input,
      extractResult: extractionStr,
      extraction: extractionStr,
      analysisResult: analysisContent,
      analysis: analysisContent,
      riskResult: riskContent,
      risk: riskContent,
      // 20.3：原来这里写死占位串，等于 mock 链路永远看不到检索内容
      retrievedContext:
        state.retrievedContext ?? '本次分析未检索到相关参考文档。',
    });

    return {
      summary,
      summaryDraft: summary,
      steps: ['actor'],
    };
  }

  const input = extractInputText(state) || (state as any).input || '';
  // 20.3：把检索到的参考资料挂进写报告的 prompt（此前完全没有这一步）
  const contextBlock = buildRetrievedContextBlock(state.retrievedContext);
  const response = await model.invoke([
    new SystemMessage(`你是资深需求分析师。根据分析和风险评估生成综合报告。

**报告必需章节**：
1. 需求摘要：200-300 字概述
2. 功能分解：主要模块和子功能
3. 冲突分析：与现有需求的冲突点 + 解决方案
4. 技术复杂度：评估（低/中/高）+ 理由
5. 开发排期：各阶段时长 + 依赖项

**格式要求**：
- 使用 Markdown 标题（## 和 ###）
- 关键信息用粗体或列表
- 排期必须标明依赖关系
- 冲突分析必须包含解决方案，不能只描述问题${contextBlock}`),
    new HumanMessage(`原始需求：${input}

提取结果：${typeof state.extracted === 'string' ? state.extracted : JSON.stringify(state.extracted ?? {})}
分析结果：${state.analysisResult ?? state.analysis ?? ''}
风险评估：${state.riskResult ?? state.risk ?? ''}

请生成完整的综合报告。`),
  ]);

  const content =
    typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

  return {
    summary: content,
    summaryDraft: content,
    steps: ['actor'],
  };
}

/**
 * Critic-Refine 子图：评审检查 (criticNode)
 */
export async function criticNode(
  state: RequirementAnalysisStateType,
  options?: { model?: BaseChatModel; subAgents?: SubAgents },
): Promise<Partial<RequirementAnalysisStateType>> {
  // 若处于纯单测 mock 模式（传入 subAgents 且无 model），直接判定通过以保持确定性与隔离性
  if (!options?.model && options?.subAgents?.summaryAgent) {
    return {
      critique: '',
      steps: ['critic'],
    };
  }

  const model =
    options?.model ?? createChatModel({ temperature: 0, streaming: false });

  try {
    const structuredModel = (model as any).withStructuredOutput(
      CriticReviewSchema,
    );

    const result = (await structuredModel.invoke([
      new SystemMessage(`你是资深需求评审专家。按以下标准检查综合报告：

**评审标准**（必须全部满足）：
1. 章节完整性：必须包含"需求摘要"、"冲突分析"、"技术复杂度"、"开发排期"
2. 排期依赖项：排期章节必须标明各阶段的依赖关系（如"前端开发依赖后端 API 完成"）
3. 冲突解决方案：如果存在冲突，必须给出具体解决方案，不能只描述问题
4. 逻辑一致性：各章节之间不能有明显矛盾（如摘要说低复杂度，但技术分析提到大规模重构）

**输出要求**：
- 如果全部满足，返回 pass=true, critique=""
- 如果任一不满足，返回 pass=false，并给出最关键的 1-2 条修改意见
- 修改意见要具体，指出缺少什么或哪里矛盾
- 避免主观性评价（如"语言不够优美"）

**重要**：不要过度严格，只检查核心要素，否则会导致无限循环。`),
      new HumanMessage(
        `待评审报告：\n\n${state.summary || ''}\n\n请按标准评审。`,
      ),
    ])) as CriticReview;

    return {
      critique: result.pass ? '' : result.critique || '',
      steps: ['critic'],
    };
  } catch {
    // 降级兜底检查
    const text = state.summary || '';
    const hasSummary = text.includes('摘要');
    const hasConflict = text.includes('冲突');
    const hasComplexity = text.includes('复杂度');
    const hasSchedule = text.includes('排期');

    const pass = hasSummary && hasConflict && hasComplexity && hasSchedule;
    return {
      critique: pass
        ? ''
        : '报告缺少必需章节，请补充需求摘要、冲突分析、技术复杂度与开发排期。',
      steps: ['critic'],
    };
  }
}

/**
 * Critic-Refine 子图：修订改进 (refineNode)
 */
export async function refineNode(
  state: RequirementAnalysisStateType,
  options?: { model?: BaseChatModel },
): Promise<Partial<RequirementAnalysisStateType>> {
  const model =
    options?.model ?? createChatModel({ temperature: 0.2, streaming: false });

  const response = await model.invoke([
    new SystemMessage(`你是需求分析师。根据评审意见修订报告。

**修订原则**：
1. 只修改被指出的问题部分
2. 未被批评的章节保持不变
3. 补充缺失的章节或内容
4. 修正逻辑矛盾

**禁止行为**：
- 不要重新生成整个报告
- 不要删除正确的内容
- 不要改变原有的结构和风格`),
    new HumanMessage(
      `原报告：\n\n${state.summary || ''}\n\n评审意见：\n${state.critique || ''}\n\n请根据评审意见修订报告，只改有问题的地方。`,
    ),
  ]);

  const content =
    typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

  return {
    summary: content,
    reviseCount: (state.reviseCount ?? 0) + 1,
    steps: ['refine'],
  };
}

/**
 * Critic-Refine 子图条件边函数 (shouldRefine)
 * 控制最多修订 2 次，避免无限死循环
 */
export function shouldRefine(
  state: RequirementAnalysisStateType,
): 'refine' | typeof END {
  // 优先级 1：硬上限检查（防止无限循环）
  if ((state.reviseCount ?? 0) >= 2) {
    return END;
  }

  // 优先级 2：检查是否通过评审
  if (!state.critique || state.critique.trim() === '') {
    return END;
  }

  // 优先级 3：需要修订
  return 'refine';
}

/**
 * 构建并编译 Critic-Refine 汇总子图 (createSummarySubGraph)
 * 拓扑结构：
 * - START → actor
 * - actor → critic
 * - critic --(shouldRefine)--> refine | END
 * - refine → critic (回边)
 */
export function createSummarySubGraph(
  modelOrOptions?: BaseChatModel | AnalysisGraphOptions,
) {
  const model =
    modelOrOptions && 'invoke' in modelOrOptions
      ? (modelOrOptions as BaseChatModel)
      : (modelOrOptions as AnalysisGraphOptions)?.model;
  const subAgents =
    modelOrOptions && !('invoke' in modelOrOptions)
      ? (modelOrOptions as AnalysisGraphOptions)?.subAgents
      : undefined;

  return new StateGraph(RequirementAnalysisState)
    .addNode('actor', (state: RequirementAnalysisStateType) =>
      actorNode(state, { model, subAgents }),
    )
    .addNode('critic', (state: RequirementAnalysisStateType) =>
      criticNode(state, { model, subAgents }),
    )
    .addNode('refine', (state: RequirementAnalysisStateType) =>
      refineNode(state, { model }),
    )
    .addEdge(START, 'actor')
    .addEdge('actor', 'critic')
    .addConditionalEdges('critic', shouldRefine, {
      [END]: END,
      refine: 'refine',
    })
    .addEdge('refine', 'critic')
    .compile();
}

/**
 * 5. 汇总总结单节点（保留用于向后兼容与独立测试）
 */
export async function summaryNode(
  state: RequirementAnalysisStateType,
  subAgents: SubAgents,
): Promise<Partial<RequirementAnalysisStateType>> {
  const input = extractInputText(state);
  const extractionStr =
    typeof state.extracted === 'string'
      ? state.extracted
      : JSON.stringify(state.extracted ?? {}, null, 2);

  const analysisContent = state.analysisResult ?? state.analysis ?? '';
  const riskContent = state.riskResult ?? state.risk ?? '';

  const summary = await subAgents.summaryAgent.invoke({
    input,
    extractResult: extractionStr,
    extraction: extractionStr,
    analysisResult: analysisContent,
    analysis: analysisContent,
    riskResult: riskContent,
    risk: riskContent,
    retrievedContext: '本次分析未检索到相关参考文档。',
  });

  return {
    summary,
    steps: ['summaryStep'],
  };
}

// 别名导出以对齐 step 命名
export {
  extractNode as extractStepNode,
  clarifyNode as clarifyStepNode,
  analysisNode as analysisStepNode,
  riskNode as riskStepNode,
  summaryNode as summaryStepNode,
};

/**
 * 条件路由函数：根据 State 中的 intent 分流
 */
export function routeByIntent(
  state: RequirementAnalysisStateType,
): 'extractStep' | 'queryHandler' | 'chatHandler' | 'riskStep' | typeof END {
  switch (state.intent) {
    case 'query':
      return 'queryHandler';
    case 'chat':
      // 9.4 Handoff 优化：若已由 triage 直接答复（具有 chatResponse），短路直接到 END，节省一次调用
      return state.chatResponse ? END : 'chatHandler';
    case 'risk_only':
      return 'riskStep';
    case 'analyze':
    default:
      return 'extractStep';
  }
}

export interface AnalysisGraphOptions {
  subAgents?: SubAgents;
  model?: BaseChatModel;
  /** 是否启用第九章 9.2 Supervisor + 多专家并行架构（为 true 且提供 model 时切换） */
  useMultiAgent?: boolean;
  /** 是否启用第九章 9.4 Triage 分诊节点替代原 classifierNode */
  useTriage?: boolean;
  /** 9.6.2 Checkpointer 持久化快照实例（如 MemorySaver 或 PostgresSaver） */
  checkpointer?: BaseCheckpointSaver;
  /** 9.6.2 HITL 中断节点列表（在指定节点执行前中断暂停，如 ['clarifyStep']） */
  interruptBefore?: string[];
  /**
   * 11.10.3 RAG-as-Tool 依赖。传入后专家 Agent 具备按需检索知识库的能力；
   * 不传则维持第九章纯业务工具行为
   */
  rag?: ExpertRagDeps;
  /**
   * 12.13 MCP 工具依赖。传入后专家 Agent 具备调用外部 MCP Server 的能力；
   * 不传则维持第九章纯本地工具行为
   */
  mcp?: ExpertMcpDeps;
  /**
   * 13.4 Skills 依赖。传入后功能专家具备 load_skill 能力与 Skill 自带工具；
   * 不传则维持第九章 + 第十二章的原有行为
   */
  skills?: ExpertSkillDeps;
}

/**
 * 构建并编译支持意图分类、ReAct 分析子图与 Critic-Refine 汇总子图的需求分析 LangGraph 图
 * 拓扑结构：
 * - START → classifier / triage
 * - classifier/triage -(routeByIntent)-> extractStep | queryHandler | chatHandler | riskStep | END
 * - queryHandler → END
 * - chatHandler → END
 * - extractStep → clarifyStep → (analysisStep // riskStep) → summaryStep → END
 *   其中 analysisStep 挂载 ReAct 子图 createAnalysisSubGraph()
 *   或通过 useMultiAgent: true 升级为 Supervisor 多专家子图 createAnalysisSupervisorSubGraph()
 *   summaryStep 挂载 Critic-Refine 子图 createSummarySubGraph()
 *
 * 支持 options 配置 checkpointer 与 interruptBefore 开启 HITL 人工介入能力
 */
export function createAnalysisGraph(
  modelOrOptions?: BaseChatModel | AnalysisGraphOptions,
  extraOptions?: AnalysisGraphOptions,
) {
  let options: AnalysisGraphOptions = {};
  if (modelOrOptions && 'invoke' in modelOrOptions) {
    options = {
      model: modelOrOptions as BaseChatModel,
      ...extraOptions,
    };
  } else if (modelOrOptions) {
    options = {
      ...(modelOrOptions as AnalysisGraphOptions),
      ...extraOptions,
    };
  }

  const agents = options?.subAgents ?? defaultSubAgents;
  const model = options?.model;
  // 9.2: 若显式开启 useMultiAgent 且提供 model，则升级为 Supervisor + 4 专家架构；默认保留原单 Agent 子图
  const analysisSubGraph =
    options?.useMultiAgent && model
      ? createAnalysisSupervisorSubGraph(
          model,
          options?.rag,
          options?.mcp,
          options?.skills,
        )
      : createAnalysisSubGraph(options);
  const summarySubGraph = createSummarySubGraph(options);
  const builder = new StateGraph(RequirementAnalysisState);

  const startNode = options?.useTriage ? 'triage' : 'classifier';
  const startNodeFn = options?.useTriage
    ? (state: RequirementAnalysisStateType) => triageNode(state, { model })
    : (state: RequirementAnalysisStateType) => classifierNode(state, { model });

  const graphWithNodes = (builder as any)
    .addNode(startNode, startNodeFn)
    .addNode('queryHandler', (state: RequirementAnalysisStateType) =>
      queryHandlerNode(state, { model }),
    )
    .addNode('chatHandler', (state: RequirementAnalysisStateType) =>
      chatHandlerNode(state, { model }),
    )
    .addNode('extractStep', (state: RequirementAnalysisStateType) =>
      extractNode(state, agents),
    )
    .addNode('clarifyStep', (state: RequirementAnalysisStateType) =>
      clarifyNode(state, agents),
    )
    .addNode('analysisStep', analysisSubGraph as any)
    .addNode('riskStep', (state: RequirementAnalysisStateType) =>
      riskNode(state, agents),
    )
    .addNode('summaryStep', summarySubGraph);

  const conditionalDestinations: Record<string, string> = {
    extractStep: 'extractStep',
    queryHandler: 'queryHandler',
    chatHandler: 'chatHandler',
    riskStep: 'riskStep',
    [END]: END,
  };

  const compileOptions: Record<string, any> = {};
  if (options?.checkpointer) {
    compileOptions.checkpointer = options.checkpointer;
  }
  if (options?.interruptBefore && options.interruptBefore.length > 0) {
    compileOptions.interruptBefore = options.interruptBefore;
  }

  return graphWithNodes
    .addEdge(START, startNode)
    .addConditionalEdges(startNode, routeByIntent as any, conditionalDestinations)
    .addEdge('queryHandler', END)
    .addEdge('chatHandler', END)
    .addEdge('extractStep', 'clarifyStep')
    .addEdge('clarifyStep', 'analysisStep')
    .addEdge('clarifyStep', 'riskStep')
    .addEdge('analysisStep', 'summaryStep')
    .addEdge('riskStep', 'summaryStep')
    .addEdge('summaryStep', END)
    .compile(Object.keys(compileOptions).length > 0 ? compileOptions : undefined);
}

// ============================================================
// 9.6.2 Checkpointer + HITL 人工介入生态
// ============================================================

/**
 * 9.6.2 默认 Checkpointer 实例
 * 默认使用 MemorySaver 保持多轮调用状态；生产环境通过 initPostgresCheckpointer 切换为 PostgresSaver
 */
export let hitlCheckpointer: BaseCheckpointSaver = new MemorySaver();

/**
 * 9.6.2 thread_id 标准命名规范
 * 格式：user-{userId}:session-{sessionId}
 */
export function formatThreadId(userId: string, sessionId: string): string {
  return `user-${userId}:session-${sessionId}`;
}

/**
 * 9.6.2 PostgresSaver 配置与初始化
 * - 从环境变量 DATABASE_URL 读取连接串
 * - 与第五章会话库共用同一个 PostgreSQL 数据库
 * - 调用 checkpointer.setup() 自动创建 Checkpoint 所需表结构
 */
export async function initPostgresCheckpointer(
  databaseUrl?: string,
): Promise<BaseCheckpointSaver> {
  const connString = databaseUrl || process.env.DATABASE_URL;
  if (!connString) {
    console.warn(
      '[PostgresSaver] 未配置 DATABASE_URL 环境变量，继续沿用内存 Checkpointer (MemorySaver)',
    );
    return hitlCheckpointer;
  }

  try {
    const moduleName = '@langchain/langgraph-checkpoint-postgres';
    const { PostgresSaver } = (await import(moduleName)) as any;
    const pgSaver = (PostgresSaver as any).fromConnString(connString);
    await pgSaver.setup();
    hitlCheckpointer = pgSaver;
    return pgSaver;
  } catch (err: any) {
    console.warn(
      `[PostgresSaver] 初始化失败 (${err?.message || err})，保持使用 MemorySaver 兜底`,
    );
    return hitlCheckpointer;
  }
}

/**
 * 构建带 HITL 人工介入能力的需求分析图 (createAnalysisGraphHITL)
 * 默认在 clarifyStep 执行前中断暂停，并自动绑定 Checkpointer
 */
export function createAnalysisGraphHITL(
  modelOrOptions?: BaseChatModel | AnalysisGraphOptions,
  extraOptions?: AnalysisGraphOptions,
) {
  let resolvedOptions: AnalysisGraphOptions = {};
  if (modelOrOptions && 'invoke' in modelOrOptions) {
    resolvedOptions = {
      model: modelOrOptions as BaseChatModel,
      ...extraOptions,
    };
  } else if (modelOrOptions) {
    resolvedOptions = {
      ...(modelOrOptions as AnalysisGraphOptions),
      ...extraOptions,
    };
  }

  return createAnalysisGraph({
    ...resolvedOptions,
    useMultiAgent: resolvedOptions.useMultiAgent ?? true,
    useTriage: resolvedOptions.useTriage ?? true,
    checkpointer: resolvedOptions.checkpointer ?? hitlCheckpointer,
    interruptBefore: resolvedOptions.interruptBefore ?? ['clarifyStep'],
  });
}

/**
 * 9.6.2 第一次调用：启动分析并执行到 clarifyStep 前暂停，返回 State 快照
 */
export async function startAnalysisGraphHITL(
  threadId: string,
  input: string | AnalysisGraphInput,
  modelOrOptions?: BaseChatModel | AnalysisGraphOptions,
) {
  const graph = createAnalysisGraphHITL(modelOrOptions);
  const initialInput = normalizeAnalysisInput(input);
  await graph.invoke(initialInput, {
    configurable: { thread_id: threadId },
  });
  return graph.getState({ configurable: { thread_id: threadId } });
}

/**
 * 9.6.2 第二阶段：用户答复澄清问题后，updateState 写回 checkpoint，从断点继续执行
 */
export async function resumeAnalysisGraphHITL(
  threadId: string,
  patch: Partial<RequirementAnalysisStateType>,
  modelOrOptions?: BaseChatModel | AnalysisGraphOptions,
) {
  const graph = createAnalysisGraphHITL(modelOrOptions);
  await graph.updateState(
    { configurable: { thread_id: threadId } },
    patch,
  );
  return graph.invoke(null, { configurable: { thread_id: threadId } });
}

export type AnalysisGraphInput =
  | string
  | { messages: BaseMessage[] | Array<{ role: string; content: string }> }
  | { input: string; [key: string]: any }
  | Partial<RequirementAnalysisStateType>;

/**
 * 需求分析图执行输出契约
 */
export interface RunAnalysisGraphOutput {
  intent: 'analyze' | 'query' | 'chat' | 'risk_only';
  handoffReason?: string;
  queryResponse?: string;
  chatResponse?: string;
  extracted?: ExtractedRequirement | Record<string, any>;
  clarified?: ClarificationResult | Record<string, any>;
  analysis?: string;
  analysisResult?: string;
  functionalAnalysis?: string;
  performanceAnalysis?: string;
  securityAnalysis?: string;
  complianceAnalysis?: string;
  activeExperts?: string[];
  risk?: string;
  riskResult?: string;
  summary: string;
  steps: string[];
  messages: BaseMessage[];
  [key: string]: any;
}

/**
 * 标准化需求分析图输入参数，支持多种形态入参
 * 关键步骤：统一转换为符合 LangGraph 状态图通道规范的 Record 字典
 *
 * @param input 字符串或对象形式的输入
 */
export function normalizeAnalysisInput(
  input: AnalysisGraphInput,
): Record<string, any> {
  // 步骤 1：若入参为纯文本字符串，将其封装为标准 HumanMessage 消息数组
  if (typeof input === 'string') {
    return {
      messages: [new HumanMessage(input)],
    };
  }

  // 步骤 2：若入参已包含 messages 数组，直接作为消息通道上下文
  if ('messages' in input && Array.isArray(input.messages)) {
    return input;
  }

  // 步骤 3：若入参以 { input: string } 格式传递，构造首条 HumanMessage 并保留其余透传字段
  if ('input' in input && typeof input.input === 'string') {
    return {
      messages: [new HumanMessage(input.input)],
      ...input,
    };
  }

  // 步骤 4：兜底直接作为初始状态字典传入
  return input as Record<string, any>;
}

/**
 * 需求分析图流式节点事件契约 (9.6.3.2)
 */
export type AnalysisStreamEventType =
  | 'start'
  | 'node_start'
  | 'node_end'
  | 'token'
  | 'step:update'
  | 'done'
  | 'error';

export interface AnalysisStreamEvent {
  /** 事件类型：start(启动)、node_start(节点进入)、node_end(节点完成)、token(逐字文本块)、step:update(增量兼容)、done(结束)、error(异常) */
  type: AnalysisStreamEventType;
  /** 当前触发事件的图节点标识（如 'triage', 'functional_expert', 'analysisStep' 等） */
  step?: string;
  node?: string;
  /** 该节点返回的状态增量 Patch 字典 */
  patch?: Record<string, any>;
  /** token 流式文本块内容 */
  content?: string;
  /** 节点完整输出 */
  output?: any;
  /** 发生异常时的错误信息描述 */
  error?: string;
}

/**
 * 按细粒度事件流式执行需求分析图 (9.6.3.2)
 * 基于 LangGraph streamEvents(v2) 监听节点级进入、退出及模型 token 事件
 * 内部过滤 jsonNodes 的 token 输出，并向上层传递主图与专家子图节点生命周期
 *
 * @param input 支持纯字符串或包含 messages/input 的对象
 * @param options 可选注入自定义 subAgents 或 model
 */
export async function* streamAnalysisGraph(
  input: AnalysisGraphInput,
  options?: AnalysisGraphOptions,
): AsyncGenerator<AnalysisStreamEvent, void, unknown> {
  // 第十六章：给本轮请求的 ALS 上下文打上图名，
  // 让 LLM 回调落库时 token_usages.graphName 是真实的图名而不是兜底值
  setGraphName('requirement-analysis');

  // 步骤 1：推送首包启动事件
  yield { type: 'start' };

  try {
    const graph = createAnalysisGraph(options);
    const initialInput = normalizeAnalysisInput(input);

    // 过滤只产结构化 JSON 的节点 token 事件，防止给前端推半截 JSON 字符串
    const jsonNodes = new Set([
      'triage',
      'extractStep',
      'clarifyStep',
      'supervisor',
    ]);

    // 关注的主图与专家子图业务节点集合，忽略子图内部的 ReAct agent/tools 循环节点
    const recognizedNodes = new Set([
      'triage',
      'classifier',
      'extractStep',
      'clarifyStep',
      'analysisStep',
      'supervisor',
      'functional_expert',
      'performance_expert',
      'security_expert',
      'compliance_expert',
      'aggregator',
      'riskStep',
      'summaryStep',
      'queryHandler',
      'chatHandler',
    ]);

    // Critic-Refine 汇总子图的内部节点：actor 出草稿、critic 出 JSON 判定、refine 出终稿。
    // 它们不在 recognizedNodes 里（加进去会多占一格 progress），但 token 归属又依赖
    // currentNode，不单独跟踪的话 critic 的半截 JSON 会因为外层 summaryStep 不在
    // jsonNodes 里而直接漏到用户聊天界面上。
    const summaryInnerNodes = new Set(['actor', 'critic', 'refine']);
    const summaryJsonNodes = new Set(['critic']);

    // 优先尝试采用 LangGraph v2 streamEvents 细粒度事件流
    if (typeof (graph as any).streamEvents === 'function') {
      let currentNode = '';
      const eventStream = (graph as any).streamEvents(initialInput, {
        version: 'v2',
      });

      for await (const event of eventStream) {
        const eventType = event.event;
        const nodeName =
          event.metadata?.langgraph_node ||
          (recognizedNodes.has(event.name) ? event.name : undefined);

        if (eventType === 'on_chain_start' && nodeName) {
          if (summaryInnerNodes.has(nodeName)) {
            // 只切换 token 归属上下文，不产生额外的节点生命周期事件
            currentNode = nodeName;
          } else if (recognizedNodes.has(nodeName)) {
            if (nodeName !== currentNode) {
              currentNode = nodeName;
              yield {
                type: 'node_start',
                node: nodeName,
                step: nodeName,
              };
            }
          }
        } else if (eventType === 'on_chat_model_stream') {
          // Token 事件：只转发非 JSON 阶段（如专家分析、综合报告）的流式 token
          if (
            currentNode &&
            !jsonNodes.has(currentNode) &&
            !summaryJsonNodes.has(currentNode)
          ) {
            const chunk = event.data?.chunk;
            const content =
              typeof chunk?.content === 'string'
                ? chunk.content
                : Array.isArray(chunk?.content)
                  ? chunk.content
                      .map((c: any) => (typeof c === 'string' ? c : c.text || ''))
                      .join('')
                  : '';
            if (content) {
              yield {
                type: 'token',
                node: currentNode,
                step: currentNode,
                content,
              };
            }
          }
        } else if (eventType === 'on_chain_end' && nodeName && recognizedNodes.has(nodeName)) {
          const output = event.data?.output;
          yield {
            type: 'node_end',
            node: nodeName,
            step: nodeName,
            output,
            patch: typeof output === 'object' ? output : undefined,
          };
          // 保持对第 8 章既有消费者的兼容
          if (output && typeof output === 'object') {
            yield {
              type: 'step:update',
              step: nodeName,
              patch: output,
            };
          }

          // 9.4 Handoff 直答：triage 用 withStructuredOutput 一次性产出答案，
          // 天生没有流式 token，且 routeByIntent 会据此短路到 END（不经过 chatHandler）。
          // 若不在这里把结果转成 token 事件，上层管道一个字都收不到，
          // 只能再跑一遍兜底链 —— 同一条回答白白调两次模型。
          yield* emitDirectReplyTokens(nodeName, output);
        }
      }
    } else {
      // 优雅降级回 updates 模式（如部分打桩测试场景）
      const stream = await graph.stream(initialInput, {
        streamMode: 'updates',
      });
      for await (const chunk of stream) {
        const [nodeName, patch] = Object.entries(chunk)[0] ?? [];
        if (nodeName) {
          yield {
            type: 'node_end',
            node: nodeName,
            step: nodeName,
            patch: patch as Record<string, any>,
          };
          yield {
            type: 'step:update',
            step: nodeName,
            patch: patch as Record<string, any>,
          };
          yield* emitDirectReplyTokens(nodeName, patch);
        }
      }
    }

    yield { type: 'done' };
  } catch (err: any) {
    yield {
      type: 'error',
      error: err?.message || String(err),
    };
  }
}

/**
 * 执行需求分析图并返回最终状态标准输出
 *
 * @param input 支持纯字符串或包含 messages/input 的对象
 * @param options 可选注入自定义 subAgents 或 model（便于单元测试打桩）
 */
export async function runAnalysisGraph(
  input: AnalysisGraphInput,
  options?: AnalysisGraphOptions,
): Promise<RunAnalysisGraphOutput> {
  // 关键步骤 1：构建需求分析图实例
  const graph = createAnalysisGraph(options);

  // 关键步骤 2：归一化入参形态
  const initialInput = normalizeAnalysisInput(input);

  // 关键步骤 3：整图同步执行直到到达 END 终止节点
  const result = (await graph.invoke(
    initialInput,
  )) as RequirementAnalysisStateType;

  // 关键步骤 4：对齐向后兼容的字段并返回完整结果
  return {
    ...result,
    analysisResult: result.analysisResult ?? result.analysis,
    riskResult: result.riskResult ?? result.risk,
  } as RunAnalysisGraphOutput;
}

export interface MermaidDrawOptions {
  withStyles?: boolean;
  curveStyle?: string;
  nodeColors?: Record<string, string>;
  wrapLabelNWords?: number;
}

/**
 * 获取并输出需求分析图的 Mermaid 结构代码
 *
 * @param options 可选配置项（如自定义 subAgents 打桩）
 * @param drawOptions 可选 Mermaid 绘图参数
 * @returns Mermaid 流程图代码字符串
 */
export function getAnalysisGraphMermaid(
  options?: AnalysisGraphOptions,
  drawOptions?: MermaidDrawOptions,
): string {
  const graph = createAnalysisGraph(options);
  return graph.getGraph().drawMermaid(drawOptions);
}

/**
 * 获取并输出 ReAct 分析子图的 Mermaid 结构代码
 *
 * @param options 可选配置项
 * @param drawOptions 可选 Mermaid 绘图参数
 * @returns Mermaid 流程图代码字符串
 */
export function getAnalysisSubGraphMermaid(
  options?: AnalysisGraphOptions,
  drawOptions?: MermaidDrawOptions,
): string {
  const subGraph = createAnalysisSubGraph(options);
  return subGraph.getGraph().drawMermaid(drawOptions);
}

/**
 * 获取并输出 Critic-Refine 汇总子图的 Mermaid 结构代码
 *
 * @param modelOrOptions 可选配置项或模型
 * @param drawOptions 可选 Mermaid 绘图参数
 * @returns Mermaid 流程图代码字符串
 */
export function getSummarySubGraphMermaid(
  modelOrOptions?: BaseChatModel | AnalysisGraphOptions,
  drawOptions?: MermaidDrawOptions,
): string {
  const subGraph = createSummarySubGraph(modelOrOptions);
  return subGraph.getGraph().drawMermaid(drawOptions);
}
