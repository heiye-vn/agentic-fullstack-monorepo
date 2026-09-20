import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MessageRole, ArtifactType } from '../prisma/index.js';
import { MessageService } from '../message/message.service.js';
import { RunnableMemoryService } from '../llm/memory/runnable-memory.service.js';
import { ModelConfigService } from '../model-config/model-config.service.js';
import { createChatModel } from '../llm/model.factory.js';
import { loadLangChainConfig } from '../config/load-langchain-config.js';
import { OrchestratorService } from '../llm/agents/orchestrator.service.js';
import { UIFlowService } from '../llm/ui-protocol/ui-flow.service.js';
import type { UIAction } from '../llm/ui-protocol/ui-types.js';
import { SearchService } from '../document/search.service.js';
import { EmbeddingService } from '../document/embedding.service.js';
import { createVectorSearchFn } from '../rag/retrieval/vector-search-fn.js';
import type {
  ExpertRagDeps,
  ExpertMcpDeps,
  ExpertSkillDeps,
} from '../llm/graph/experts.js';
import { getSharedMcpManager } from '../mcp/mcp-runtime.js';
import { buildSkillToolSet, getSharedSkillRuntime } from '../skills/skills-runtime.js';
import type { SkillTraceCollector } from '../skills/skill-trace.js';
import { ArtifactService } from '../artifact/artifact.service.js';
import { UIActionParser, type UIContext } from './ui-action.parser.js';
import { estimateTextTokens, getModelPricing } from '../llm/cost/token-estimator.js';

/**
 * SSE 帧类型（对齐 autix-demo chat-web 的 StreamMessage 协议）
 * 前端 `ChatView.tsx` 的 switch 认的就是这几个 messageType
 */
export type ChatFrameType =
  | 'markdown'
  | 'ui'
  | 'meta'
  | 'progress'
  | 'log'
  | 'artifact_created'
  | 'done'
  | 'error';

export interface ChatStreamFrame {
  messageType: ChatFrameType;
  payload: unknown;
}

/** Agent 名 → 前端进度条显示名 */
const AGENT_DISPLAY_NAMES: Record<string, string> = {
  triageAgent: '意图分诊',
  classifierAgent: '类型识别',
  extractAgent: '要素抽取',
  clarifyAgent: '需求澄清',
  analysisAgent: '方案分析',
  riskAgent: '风险评估',
  summaryAgent: '报告汇总',
  queryAgent: '知识问答',
  chatAgent: '对话应答',
  supervisorAgent: '专家调度',
  functionalExpert: '功能专家',
  performanceExpert: '性能专家',
  securityExpert: '安全专家',
  complianceExpert: '合规专家',
  aggregatorAgent: '结论聚合',
};

@Injectable()
export class ChatStreamService {
  private readonly logger = new Logger(ChatStreamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messageService: MessageService,
    private readonly runnableMemoryService: RunnableMemoryService,
    private readonly modelConfigService: ModelConfigService,
    private readonly searchService: SearchService,
    private readonly embeddingService: EmbeddingService,
    private readonly orchestratorService: OrchestratorService,
    private readonly uiFlowService: UIFlowService,
    private readonly artifactService: ArtifactService,
    private readonly uiActionParser: UIActionParser,
  ) {}

  /**
   * 生成一次对话的完整 SSE 帧序列
   *
   * 两条链路：
   * - UI 操作（message 是对象）：走 UIFlowService 状态机，产出 `ui` 帧
   * - 普通文本：走 LangGraph 编排管道（streamOrchestrate），产出 progress/markdown 帧；
   *   管道没吐出任何内容时回退到普通对话链，保证聊天永不空转
   */
  async *stream(params: {
    conversationId: string;
    userId: string;
    rawMessage: unknown;
    modelId?: string;
    /** 会话标题仍是默认值时，需要在本轮结束后提炼并更新 */
    shouldUpdateTitle?: boolean;
  }): AsyncGenerator<ChatStreamFrame> {
    const { conversationId, userId, rawMessage, modelId } = params;
    const messageId = `msg-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 9)}`;

    try {
      // ── UI 操作链路 ──────────────────────────────────────────
      const lastAssistant = await this.prisma.message.findFirst({
        where: { conversationId, role: MessageRole.ASSISTANT },
        orderBy: { createdAt: 'desc' },
      });

      const uiContext = this.uiActionParser.parse(
        rawMessage,
        lastAssistant?.metadata as Record<string, unknown> | undefined,
      );

      if (uiContext) {
        yield* this.handleUIAction(conversationId, lastAssistant, uiContext);
        return;
      }

      // ── 普通文本链路 ─────────────────────────────────────────
      const text =
        typeof rawMessage === 'string'
          ? rawMessage.trim()
          : JSON.stringify(rawMessage ?? '');

      if (!text) {
        yield { messageType: 'error', payload: { error: '消息内容不能为空' } };
        return;
      }

      yield* this.handleTextMessage({
        conversationId,
        userId,
        text,
        messageId,
        modelId,
        shouldUpdateTitle: params.shouldUpdateTitle ?? false,
      });
    } catch (err) {
      this.logger.error(
        `[chat stream] 会话 ${conversationId} 处理失败`,
        err instanceof Error ? err.stack : String(err),
      );
      yield {
        messageType: 'error',
        payload: {
          error: err instanceof Error ? err.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * 处理 UI 组件交互：更新交互状态 → 走需求流程状态机 → 发 ui 帧
   */
  private async *handleUIAction(
    conversationId: string,
    lastAssistant: { id: string; metadata?: unknown } | null,
    uiContext: UIContext,
  ): AsyncGenerator<ChatStreamFrame> {
    const { userAction, collectedData } = uiContext;

    // 把本次操作写回上一条 AI 消息，刷新页面后已操作的组件保持禁用
    if (lastAssistant?.id) {
      const metadata = (lastAssistant.metadata ?? {}) as Record<string, any>;
      if (metadata.uiResponse) {
        const interactionState = metadata.interactionState ?? {};
        interactionState[userAction.componentId] = {
          action: userAction.action,
          data: userAction.data,
          timestamp: new Date().toISOString(),
          disabled: true,
        };
        await this.prisma.message.update({
          where: { id: lastAssistant.id },
          data: {
            metadata: { ...metadata, interactionState } as any,
          },
        });
      }
    }

    const flowAction = this.toFlowUIAction(userAction);
    const result = await this.uiFlowService.handleAction(
      conversationId,
      flowAction,
    );

    const uiResponse = {
      messages: result.components ?? [],
      thinking: result.message ?? null,
    };

    yield {
      messageType: 'ui',
      payload: {
        messageId: `ui-${Date.now()}`,
        components: uiResponse.messages,
        thinking: uiResponse.thinking,
      },
    };

    await this.messageService.addMessage(
      conversationId,
      MessageRole.ASSISTANT,
      result.message ?? '',
      {
        messageType: 'ui',
        uiResponse,
        uiStage: result.context?.sessionStage ?? uiContext.uiStage ?? null,
        collectedData: {
          ...collectedData,
          ...(result.context?.collectedData ?? {}),
        },
      },
    );

    yield {
      messageType: 'meta',
      payload: {
        uiStage: result.context?.sessionStage ?? uiContext.uiStage ?? null,
        usedAgents: [],
        retrievedDocuments: [],
        // UI 操作走的是确定性状态机（UIFlowService），不发起任何模型调用，
        // 因此这里如实标注为 none —— 不要让人误以为它会消耗 token 或受模型选择影响。
        modelName: null,
        keySource: 'none',
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
          isEstimated: false,
        },
        overrideReason: null,
      },
    };
    yield { messageType: 'done', payload: null };
  }

  /**
   * 处理普通文本：RAG 检索 → 编排管道流式 → 落库 → 产物 → 收尾
   */
  private async *handleTextMessage(params: {
    conversationId: string;
    userId: string;
    text: string;
    messageId: string;
    modelId?: string;
    shouldUpdateTitle?: boolean;
  }): AsyncGenerator<ChatStreamFrame> {
    const { conversationId, userId, text, messageId, modelId } = params;

    // 先取历史（此时不含本轮），再落库本轮用户消息，避免本轮被重复带入上下文
    const history =
      await this.messageService.getHistoryAsLangChainMessages(conversationId);
    await this.messageService.addMessage(conversationId, MessageRole.USER, text);

    // ── RAG 语义检索：失败不阻断，降级为无文档上下文 ──────────────
    const config = loadLangChainConfig();
    let retrievedContext = '无相关参考文档';
    let retrievedDocuments: Array<{
      documentId: string;
      content: string;
      score: number;
    }> = [];

    try {
      const searchResults = await this.searchService.similaritySearch(
        text,
        userId,
        config.retrieval?.topK ?? 4,
      );
      retrievedDocuments = searchResults.map((r) => ({
        documentId: r.documentId,
        content: r.content.slice(0, 200),
        score: r.score,
      }));
      if (searchResults.length > 0) {
        retrievedContext = searchResults
          .map(
            (r, i) =>
              `[文档片段 ${i + 1}]（相关度：${r.score.toFixed(3)}）\n${r.content}`,
          )
          .join('\n\n');
      }
      yield {
        messageType: 'log',
        payload: {
          level: 'info',
          message: `RAG 检索命中 ${retrievedDocuments.length} 个片段`,
        },
      };
    } catch (searchErr) {
      this.logger.warn(
        `RAG 检索失败，继续无文档上下文分析: ${
          searchErr instanceof Error ? searchErr.message : String(searchErr)
        }`,
      );
    }

    const { model, modelName, keySource } =
      await this.resolveChatModel(modelId);

    // ── 第十章预算快照（11.10.5 与 Token 经济学协同） ──────────────
    // RAG 工具的预算闸门要同步取值，所以在这里先查一次当月累计成本，
    // 未配置 MONTHLY_BUDGET_USD 时按 0 处理，等价于不做预算拦截
    let budgetUsedPercent = 0;
    const monthlyBudgetUsd = Number(process.env.MONTHLY_BUDGET_USD ?? 0);
    if (monthlyBudgetUsd > 0) {
      try {
        const monthStart = new Date(
          new Date().getFullYear(),
          new Date().getMonth(),
          1,
        );
        const agg = await this.prisma.tokenUsage.aggregate({
          _sum: { estimatedCostUsd: true },
          where: { createdAt: { gte: monthStart } },
        });
        budgetUsedPercent =
          ((agg._sum.estimatedCostUsd ?? 0) / monthlyBudgetUsd) * 100;
      } catch (budgetErr) {
        this.logger.warn(
          `读取月度预算失败，按未超预算处理: ${
            budgetErr instanceof Error ? budgetErr.message : String(budgetErr)
          }`,
        );
      }
    }

    // ── 11.10.3 RAG-as-Tool：让专家 Agent 在分析过程中按需检索知识库 ──
    // 与上面的一次性 retrievedContext 是互补的两条路：
    // 前者保证首轮就有背景资料，后者允许专家在推理中自己补查规范与历史决策
    const ragDeps: ExpertRagDeps = {
      userId,
      searchFn: createVectorSearchFn({
        prisma: this.prisma,
        embedQuery: (t) => this.embeddingService.embedText(t),
        userId,
        modelName: this.embeddingService.getModelName(),
      }),
      getBudget: () => ({ usedPercent: budgetUsedPercent }),
    };

    // ── 12.13 MCP：让专家 Agent 在分析过程中调用外部 MCP Server ──
    // 未开启 MCP_ENABLED 时 getSharedMcpManager 返回 null，
    // 专家工具池保持第九章原样，行为完全不变
    const mcpManager = await getSharedMcpManager();
    const mcpDeps: ExpertMcpDeps | undefined = mcpManager
      ? { tools: mcpManager.getTools() }
      : undefined;

    // ── 13.4 Skills：让功能专家按需加载专业工作流 ──
    // 与 MCP 不同，Skills 是纯本地资产（读 SKILL.md + 调本地确定性工具），
    // 没有外部依赖也没有额外成本，所以默认开启，SKILLS_ENABLED=0 可关闭。
    // 这里把第十二章的 MCP 工具一起传进去：Skill 的 allowed-tools 里
    // 声明了 req_* / ws_*，同名即命中（教程 13.9.1 —— 工具来源不限）
    // 注册表扫盘一次即可（getSharedSkillRuntime），工具实例每请求重建，
    // 这样 trace 能带上本次请求的 requestId —— 共享工具实例会让所有加载都记到第一个请求头上
    const skillRuntime = getSharedSkillRuntime({
      mcpTools: mcpManager?.getTools(),
      logger: (m) => this.logger.log(m),
    });
    let skillsDeps: ExpertSkillDeps | undefined;
    let skillTraces: SkillTraceCollector | undefined;
    if (skillRuntime) {
      const built = buildSkillToolSet(skillRuntime.registry, {
        mcpTools: mcpManager?.getTools(),
        trace: { requestId: messageId, conversationId, userId },
      });
      skillTraces = built.traces;
      skillsDeps = {
        tools: built.tools,
        indexPrompt: skillRuntime.indexPrompt,
        traces: built.traces,
      };
    }

    // ── 编排管道流式输出 ────────────────────────────────────────
    let content = '';
    let firstChunk = true;
    const usedAgents: string[] = [];
    let orchestratorError: Error | null = null;

    try {
      const stream = this.orchestratorService.streamOrchestrate(text, {
        retrievedContext,
        model,
        rag: ragDeps,
        mcp: mcpDeps,
        skills: skillsDeps,
      });

      for await (const event of stream) {
        switch (event.type) {
          case 'agent_start':
            yield {
              messageType: 'progress',
              payload: {
                agent: event.agent,
                agentDisplayName:
                  AGENT_DISPLAY_NAMES[event.agent ?? ''] ?? event.agent,
                step: event.step,
                totalSteps: event.totalSteps,
                status: 'started',
                parallel: event.parallel,
              },
            };
            break;

          case 'agent_end':
            if (event.agent && !usedAgents.includes(event.agent)) {
              usedAgents.push(event.agent);
            }
            yield {
              messageType: 'progress',
              payload: {
                agent: event.agent,
                agentDisplayName:
                  AGENT_DISPLAY_NAMES[event.agent ?? ''] ?? event.agent,
                step: event.step,
                totalSteps: event.totalSteps,
                status: 'completed',
                parallel: event.parallel,
              },
            };
            break;

          case 'token': {
            const chunk = event.content ?? '';
            if (!chunk) break;
            content += chunk;
            yield {
              messageType: 'markdown',
              payload: firstChunk
                ? { messageId, content: chunk, isChunk: true }
                : { content: chunk, isChunk: true },
            };
            firstChunk = false;
            break;
          }

          case 'log':
            yield {
              messageType: 'log',
              payload: {
                level: 'info',
                message: event.error ?? 'log',
              },
            };
            break;

          case 'error':
            throw new Error(event.error ?? '编排管道执行失败');
        }
      }
    } catch (err) {
      orchestratorError =
        err instanceof Error ? err : new Error(String(err));
      this.logger.warn(
        `编排管道异常，将回退普通对话链: ${orchestratorError.message}`,
      );
    }

    // 编排管道一个 token 都没吐出来（首次调用即失败，或该分支无 token 事件）→ 回退
    if (content.trim().length === 0) {
      yield {
        messageType: 'log',
        payload: {
          level: 'warn',
          message: orchestratorError
            ? `编排管道不可用（${orchestratorError.message}），回退普通对话链`
            : '编排管道未产出内容，回退普通对话链',
        },
      };

      const modelInput = retrievedDocuments.length
        ? `参考以下资料回答（如与问题无关请忽略）：\n${retrievedContext}\n\n用户问题：${text}`
        : text;

      const chain = this.runnableMemoryService.createStandardChain(model);
      const stream = await chain.stream(
        { history, input: modelInput },
        { configurable: { sessionId: conversationId } },
      );

      for await (const chunk of stream) {
        const piece = typeof chunk === 'string' ? chunk : String(chunk ?? '');
        if (!piece) continue;
        content += piece;
        yield {
          messageType: 'markdown',
          payload: firstChunk
            ? { messageId, content: piece, isChunk: true }
            : { content: piece, isChunk: true },
        };
        firstChunk = false;
      }
    }

    // ── 模型回复落库 ────────────────────────────────────────────
    const assistantMessage = await this.messageService.addMessage(
      conversationId,
      MessageRole.ASSISTANT,
      content,
      {
        messageType: 'markdown',
        usedAgents,
        retrievedDocuments,
      },
    );

    // ── 编排产出研究报告时自动生成产物 ────────────────────────────
    if (usedAgents.includes('summaryAgent') && content.trim().length > 0) {
      try {
        const title = await this.artifactService.generateTitle(content);
        const artifact = await this.artifactService.upsertArtifact({
          conversationId,
          userId,
          title,
          type: ArtifactType.MARKDOWN,
          content,
          sourceMessageId: assistantMessage.id,
        });

        yield {
          messageType: 'artifact_created',
          payload: { artifactId: artifact.id, title: artifact.title },
        };
      } catch (artifactError) {
        this.logger.error(
          `产物创建失败: ${
            artifactError instanceof Error
              ? artifactError.message
              : String(artifactError)
          }`,
        );
      }
    }

    // ── 首轮标题提炼：仅会话标题仍是默认值且回复非空时触发 ───────
    let conversationTitle: string | undefined;
    if (params.shouldUpdateTitle && content.trim().length > 0) {
      conversationTitle = await this.summarizeAndSetTitle(
        conversationId,
        text,
        model,
      );
    }

    // 计算本轮 Token 消耗估算（输入包括用户 prompt 与 RAG 检索上下文）
    const inputText = [text, retrievedContext !== '无相关参考文档' ? retrievedContext : ''].filter(Boolean).join('\n');
    const inputTokens = estimateTextTokens(inputText);
    const outputTokens = estimateTextTokens(content);
    const totalTokens = inputTokens + outputTokens;
    const pricing = getModelPricing(modelName);
    const estimatedCostUsd =
      (inputTokens / 1_000_000) * pricing.input +
      (outputTokens / 1_000_000) * pricing.output;

    yield {
      messageType: 'meta',
      payload: {
        usedAgents,
        retrievedDocuments,
        conversationTitle,
        // 可观测：本轮到底用了哪个模型、哪把钥匙
        modelName,
        keySource,
        tokenUsage: {
          inputTokens,
          outputTokens,
          totalTokens,
          estimatedCostUsd,
          isEstimated: true,
        },
        overrideReason: null,
      },
    };

    // 13.10.4 Skills 埋点汇总：只记统计量与技能名，不记正文
    if (skillTraces) {
      const summary = skillTraces.summary();
      if (summary.totalLoads > 0) {
        this.logger.log(
          `[skills] 会话 ${conversationId} 加载 ${summary.totalLoads} 次，命中率 ${summary.hitRate}，技能：${Object.keys(summary.bySkill).join(', ')}`,
        );
      }
    }

    yield { messageType: 'done', payload: null };
  }

  /**
   * 提炼会话标题并落库。
   *
   * 失败绝不向上抛：标题只是体验增强，不能因为它把整轮对话打断。
   * 兜底策略是取用户输入前 15 字，保证侧边栏 100% 有可读标题。
   */
  private async summarizeAndSetTitle(
    conversationId: string,
    userPrompt: string,
    model: ReturnType<typeof createChatModel>,
  ): Promise<string | undefined> {
    const fallbackTitle = userPrompt
      .replace(/[\r\n\t]/g, ' ')
      .replace(/["'“”《》`]/g, '')
      .trim()
      .slice(0, 15);

    let extractedTitle = '';

    try {
      const summarizer = createChatModel({
        temperature: 0.3,
        maxTokens: 100,
        streaming: false,
        disableThinking: true,
      });

      const prompt = `你是一个会话标题提炼工具。请根据用户的提问，提取出一个简短精炼的主题标题。
要求：
1. 长度严格在 4 到 10 个中文字符以内。
2. 绝对不要带有标点符号、引号、冒号、序号或任何解释，仅输出标题文字本身。
3. 概括用户核心意图。

用户提问：${userPrompt.slice(0, 200)}

标题：`;

      const response = await summarizer.invoke(prompt);
      const rawTitle =
        typeof response.content === 'string'
          ? response.content
          : String(response.content ?? '');

      extractedTitle = rawTitle
        .replace(/["'“”《》`\r\n\t:：]/g, '')
        .trim()
        .slice(0, 15);
    } catch (err) {
      this.logger.warn(
        `[会话标题生成] 模型提炼异常，使用首句兜底: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const finalTitle = extractedTitle || fallbackTitle;
    if (finalTitle) {
      try {
        await this.prisma.conversation.update({
          where: { id: conversationId },
          data: { title: finalTitle },
        });
        this.logger.log(
          `[会话标题生成] 会话 ${conversationId} 标题更新为: ${finalTitle}`,
        );
      } catch (dbErr) {
        this.logger.error(
          `[会话标题生成] 更新标题入库失败: ${
            dbErr instanceof Error ? dbErr.message : String(dbErr)
          }`,
        );
      }
    }
    return finalTitle;
  }

  /**
   * 把前端的 UIAction（componentId/action/data）转换成
   * UIFlowService 需要的形状（type/payload）
   */
  private toFlowUIAction(action: {
    componentId: string;
    action: string;
    data: Record<string, unknown>;
  }): UIAction {
    const { componentId, action: type, data } = action;

    if (typeof data.selectedType === 'string') {
      return {
        type: 'selection',
        componentType: 'selection',
        actionKey: componentId,
        payload: { type: 'select', selectedValue: data.selectedType },
      };
    }

    if (
      data.requirementTitle ||
      data.targetUsers ||
      data.businessGoal ||
      data.functionalDescription
    ) {
      return {
        type: 'form_submit',
        componentType: 'form',
        actionKey: componentId,
        payload: { type: 'submit', formData: data },
      };
    }

    if (type === 'cancel') {
      return {
        type: 'confirmation',
        componentType: 'confirmation',
        actionKey: componentId,
        payload: { type: 'confirm', confirmed: false },
      };
    }

    return {
      type: 'button_click',
      componentType: 'action_buttons',
      actionKey: componentId,
      payload: { type: 'click', actionId: componentId, ...data },
    };
  }

  /**
   * 解析本次对话使用的模型，并把「实际用了什么」一并返回，供 meta 帧回传前端。
   *
   * 凭据策略（方案 C）：
   * - 未传 modelId / 模型不存在 → YAML 默认模型，密钥走 process.env
   * - private 模型且库里配了密钥 → 解密后使用（keySource: 'db'）
   * - public 模型或库里没配密钥 → 一律回退 process.env（keySource: 'env'）
   */
  private async resolveChatModel(modelId?: string): Promise<{
    model: ReturnType<typeof createChatModel>;
    modelName: string;
    keySource: 'db' | 'env' | 'default';
  }> {
    const fallbackName = loadLangChainConfig().llm.modelName;

    if (!modelId) {
      return {
        model: createChatModel({ streaming: true }),
        modelName: fallbackName,
        keySource: 'default',
      };
    }

    try {
      const creds =
        await this.modelConfigService.resolveRuntimeCredentials(modelId);

      const model = createChatModel({
        modelName: creds.modelName,
        apiKey: creds.apiKey,
        baseUrl: creds.baseUrl,
        streaming: true,
      });

      this.logger.log(
        `[chat stream] 使用模型 ${creds.modelName}，密钥来源: ${creds.keySource}`,
      );

      return {
        model,
        modelName: creds.modelName,
        keySource: creds.keySource,
      };
    } catch (err) {
      this.logger.warn(
        `模型配置 ${modelId} 不可用，回退到默认模型：${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        model: createChatModel({ streaming: true }),
        modelName: fallbackName,
        keySource: 'default',
      };
    }
  }
}
