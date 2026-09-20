import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  type SubAgents,
  defaultSubAgents,
  createSubAgents,
  type ExtractedRequirement,
  type ClarificationResult,
} from './sub-agents.js';
import type { ChatOpenAI } from '@langchain/openai';
import type {
  AIUIResponse,
  ConfirmationComponent,
  StepsComponent,
  StepItem,
  CardComponent,
  UIResponse,
} from '../ui-protocol/ui-types.js';
import type { ExpertRagDeps } from '../graph/experts.js';

export interface ToUIResponseOptions {
  isInterrupted?: boolean;
  threadId?: string;
  confirmTitle?: string;
  confirmSummary?: string;
}

/**
 * 工作流单步执行记录
 */
export interface OrchestrationStep {
  agent: string;
  status: 'success' | 'failed' | 'skipped';
  durationMs: number;
  output?: any;
  error?: string;
}

/**
 * 多 Agent 编排响应结果契约
 */
export interface OrchestrationResult {
  /** 编排模式：固定工作流编排 */
  mode: 'fixed_workflow';
  /** 编排状态：完成 | 需要澄清终止 | 异常失败 */
  status: 'completed' | 'clarification_needed' | 'failed';
  /** 澄清问题列表（仅当需要澄清时非空） */
  clarificationQuestions: string[];
  /** 本次执行使用到的 Agent 名称列表 */
  usedAgents: string[];
  /** 降级策略标识，异常失败时为 'manual_review'，正常时为 null */
  fallback: string | null;
  /** 执行过程步骤跟踪 */
  steps: OrchestrationStep[];
  /** 最终需求分析规格报告（Markdown 文本） */
  report: string;
}

/**
 * 第九章 9.6.3.1 流式编排事件契约
 */
export interface OrchestratorStreamEvent {
  type: 'agent_start' | 'agent_end' | 'token' | 'log' | 'complete' | 'error';
  agent?: string;
  step?: number;
  totalSteps?: number;
  parallel?: boolean;
  content?: string;
  result?: any;
  error?: string;
}

/**
 * 健壮 JSON 提取与解析辅助函数
 */
export function safeParseJson<T>(rawText: string, fallbackValue: T): T {
  if (!rawText || typeof rawText !== 'string') {
    return fallbackValue;
  }

  // 清除 Markdown 代码块标记（如 ```json ... ```）
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // 若直接解析失败，尝试通过正则提取首个完整的 JSON 对象
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as T;
      } catch {
        // 忽略二次错误，走兜底
      }
    }
    return fallbackValue;
  }
}

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);
  private subAgents: SubAgents = defaultSubAgents;

  /**
   * 支持通过构造函数注入可选自定义模型，或通过 setSubAgents 注入自定义 subAgents，便于单元测试打桩
   */
  constructor(@Optional() customModel?: ChatOpenAI) {
    if (customModel) {
      this.subAgents = createSubAgents(customModel);
    }
  }

  /**
   * 允许动态设置 subAgents（主要用于测试）
   */
  setSubAgents(agents: SubAgents): void {
    this.subAgents = agents;
  }

  /**
   * 执行多 Agent 固定编排工作流：
   * 1. 需求抽取 (extractAgent)
   * 2. 澄清判断 (clarifyAgent) -> 若需要澄清则直接终止
   * 3. 并行执行多维需求分析 (analysisAgent) 与风险评估 (riskAgent)
   * 4. 汇总生成最终需求报告 (summaryAgent)
   * 5. 全流程异常捕获与 manual_review 降级兜底
   *
   * @param input 用户需求原始文本
   */
  async orchestrate(input: string): Promise<OrchestrationResult> {
    const sanitizedInput = input?.trim() ?? '';
    const usedAgents: string[] = [];
    const steps: OrchestrationStep[] = [];

    this.logger.log(`[Orchestrator] 开始执行固定工作流编排，输入长度: ${sanitizedInput.length}`);

    try {
      // ----------------------------------------------------
      // 步骤 1: 需求结构化抽取 (extractAgent)
      // ----------------------------------------------------
      usedAgents.push('extractAgent');
      const startExtract = Date.now();
      const extractRaw = await this.subAgents.extractAgent.invoke({
        input: sanitizedInput,
        history: [],
      });
      const extractDuration = Date.now() - startExtract;

      const extracted = safeParseJson<ExtractedRequirement>(extractRaw, {
        rawGoal: sanitizedInput,
        action: sanitizedInput,
        coreFeature: sanitizedInput,
        targetUsers: '',
        businessGoal: '',
        constraints: [],
        priority: 'medium',
        isComplete: true,
        missingFields: [],
      });

      steps.push({
        agent: 'extractAgent',
        status: 'success',
        durationMs: extractDuration,
        output: extracted,
      });

      // ----------------------------------------------------
      // 步骤 2: 需求澄清判断 (clarifyAgent)
      // ----------------------------------------------------
      usedAgents.push('clarifyAgent');
      const extractionStr = JSON.stringify(extracted, null, 2);
      const startClarify = Date.now();
      const clarifyRaw = await this.subAgents.clarifyAgent.invoke({
        input: sanitizedInput,
        extractResult: extractionStr,
        extraction: extractionStr,
      });
      const clarifyDuration = Date.now() - startClarify;

      const clarification = safeParseJson<ClarificationResult>(clarifyRaw, {
        needsClarification: false,
        questions: [],
        clarificationQuestions: [],
        reason: '默认无需澄清',
      });

      const questions =
        clarification.questions ||
        clarification.clarificationQuestions ||
        [];

      steps.push({
        agent: 'clarifyAgent',
        status: 'success',
        durationMs: clarifyDuration,
        output: {
          ...clarification,
          questions,
          clarificationQuestions: questions,
        },
      });

      // 判断是否需要澄清中断
      if (
        clarification.needsClarification &&
        Array.isArray(questions) &&
        questions.length > 0
      ) {
        this.logger.warn(
          `[Orchestrator] 需求信息不完整，触发澄清中断。共 ${questions.length} 个澄清问题`,
        );

        return {
          mode: 'fixed_workflow',
          status: 'clarification_needed',
          clarificationQuestions: questions,
          usedAgents,
          fallback: null,
          steps,
          report: '',
        };
      }

      // ----------------------------------------------------
      // 步骤 3: 并行执行多维度需求分析 (analysisAgent) + 风险评估 (riskAgent)
      // ----------------------------------------------------
      usedAgents.push('analysisAgent', 'riskAgent');
      const startParallel = Date.now();

      const [analysisResult, riskResult] = await Promise.all([
        (async () => {
          const s = Date.now();
          const out = await this.subAgents.analysisAgent.invoke({
            input: sanitizedInput,
            extractResult: extractionStr,
            extraction: extractionStr,
          });
          return { out, duration: Date.now() - s };
        })(),
        (async () => {
          const s = Date.now();
          const out = await this.subAgents.riskAgent.invoke({
            input: sanitizedInput,
            extractResult: extractionStr,
            extraction: extractionStr,
          });
          return { out, duration: Date.now() - s };
        })(),
      ]);

      const parallelDuration = Date.now() - startParallel;
      this.logger.log(`[Orchestrator] 并行执行 (分析 + 风控) 完成，总用时: ${parallelDuration}ms`);

      steps.push({
        agent: 'analysisAgent',
        status: 'success',
        durationMs: analysisResult.duration,
        output: analysisResult.out,
      });

      steps.push({
        agent: 'riskAgent',
        status: 'success',
        durationMs: riskResult.duration,
        output: riskResult.out,
      });

      // ----------------------------------------------------
      // 步骤 4: 汇总生成最终需求报告 (summaryAgent)
      // ----------------------------------------------------
      usedAgents.push('summaryAgent');
      const startSummary = Date.now();
      const report = await this.subAgents.summaryAgent.invoke({
        input: sanitizedInput,
        extractResult: extractionStr,
        extraction: extractionStr,
        analysisResult: analysisResult.out,
        analysis: analysisResult.out,
        riskResult: riskResult.out,
        risk: riskResult.out,
        retrievedContext: '本次分析未检索到相关参考文档。',
      });
      const summaryDuration = Date.now() - startSummary;

      steps.push({
        agent: 'summaryAgent',
        status: 'success',
        durationMs: summaryDuration,
        output: report,
      });

      this.logger.log(
        `[Orchestrator] 固定编排工作流执行完毕，耗时报告生成完成 (${report.length} 字符)`,
      );

      return {
        mode: 'fixed_workflow',
        status: 'completed',
        clarificationQuestions: [],
        usedAgents,
        fallback: null,
        steps,
        report,
      };
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      this.logger.error(`[Orchestrator] 工作流执行失败: ${errorMessage}`, error?.stack);

      steps.push({
        agent: usedAgents[usedAgents.length - 1] || 'unknown',
        status: 'failed',
        durationMs: 0,
        error: errorMessage,
      });

      return {
        mode: 'fixed_workflow',
        status: 'failed',
        clarificationQuestions: [],
        usedAgents,
        fallback: 'manual_review',
        steps,
        report: '',
      };
    }
  }

  /**
   * 9.6.3 UI 协议升级：将状态机或工作流结果转换为标准化 UI 响应 (toUIResponse)
   *
   * 核心能力：
   * 1. interrupted 时渲染 confirmation 组件（支持 HITL 人工介入）
   * 2. steps 组件动态生成：从 state.activeExperts 读取并行激活专家
   * 3. 动态为每个专家添加 step（label: `${expert}_expert`, status: completed/running）
   * 4. 保持向后兼容：同时支持旧版 OrchestrationResult 与 LangGraph State 结构
   */
  toUIResponse(
    stateOrResult: any,
    options?: ToUIResponseOptions,
  ): AIUIResponse {
    const components: UIResponse[] = [];
    const isInterrupted = Boolean(
      options?.isInterrupted ||
        stateOrResult?.isInterrupted ||
        stateOrResult?.status === 'clarification_needed' ||
        (Array.isArray(stateOrResult?.next) && stateOrResult.next.length > 0),
    );

    // 1. 组装自然语言文本
    let message = '';
    if (isInterrupted) {
      message =
        stateOrResult?.message ||
        '需求分析流程已暂停在人工澄清节点，请确认或补充相关信息后继续。';
    } else if (stateOrResult?.summary || stateOrResult?.report) {
      message = stateOrResult.summary || stateOrResult.report;
    } else if (stateOrResult?.queryResponse || stateOrResult?.chatResponse) {
      message = stateOrResult.queryResponse || stateOrResult.chatResponse;
    } else {
      message = stateOrResult?.message || '需求分析流程处理完成。';
    }

    // 2. interrupted 时渲染 confirmation 组件（HITL）
    if (isInterrupted) {
      const questions =
        stateOrResult?.clarificationQuestions ||
        stateOrResult?.clarified?.questions ||
        stateOrResult?.clarified?.clarificationQuestions ||
        [];

      const confirmationComp: ConfirmationComponent = {
        type: 'confirmation',
        title: options?.confirmTitle || '需求澄清人工确认',
        summary:
          options?.confirmSummary ||
          '检测到当前需求需人工介入澄清与确认，请核实当前抽取要素后继续执行分析。',
        warning:
          questions.length > 0
            ? `待确认事项：${questions.join('；')}`
            : undefined,
        details: {
          threadId: options?.threadId || stateOrResult?.threadId,
          ...(stateOrResult?.extracted && typeof stateOrResult.extracted === 'object'
            ? { extracted: stateOrResult.extracted }
            : {}),
        },
        confirmText: '确认继续',
        cancelText: '取消终止',
        actionKey: 'resume_analysis',
      };
      components.push(confirmationComp);
    }

    // 3. steps 组件动态生成
    const dynamicStepItems: Array<{
      title: string;
      label: string;
      status: 'completed' | 'running' | 'wait' | 'finish' | 'process' | 'error';
      description?: string;
      parallel?: boolean;
    }> = [];

    if (
      Array.isArray(stateOrResult?.activeExperts) &&
      stateOrResult.activeExperts.length > 0
    ) {
      // 3.1 前置步骤：抽取与澄清
      dynamicStepItems.push({
        title: '需求抽取',
        label: 'extractStep',
        status: stateOrResult?.extracted ? 'completed' : 'running',
        description: '需求关键要素提取与结构化解析',
      });

      dynamicStepItems.push({
        title: '需求澄清',
        label: 'clarifyStep',
        status:
          stateOrResult?.clarified && !isInterrupted
            ? 'completed'
            : isInterrupted
              ? 'running'
              : 'wait',
        description: '完整性与边界校验',
      });

      // 3.2 动态为每个专家添加 step（label: `${expert}_expert`, status: completed/running）
      for (const expert of stateOrResult.activeExperts) {
        const expertField = `${expert}Analysis`;
        const hasExpertFinished = Boolean(
          stateOrResult[expertField] ||
            (stateOrResult.analysisResult && !isInterrupted),
        );

        dynamicStepItems.push({
          title: `${expert}_expert`,
          label: `${expert}_expert`,
          status: hasExpertFinished
            ? 'completed'
            : isInterrupted
              ? 'wait'
              : 'running',
          description: `${expert} 领域专家分析`,
          parallel: true,
        });
      }

      // 3.3 后置步骤：风控与报告
      dynamicStepItems.push({
        title: '风险评估',
        label: 'riskStep',
        status:
          stateOrResult?.riskResult || stateOrResult?.risk
            ? 'completed'
            : 'wait',
        description: '安全与合规风险排查',
      });

      dynamicStepItems.push({
        title: '综合报告',
        label: 'summaryStep',
        status: stateOrResult?.summary ? 'completed' : 'wait',
        description: '最终需求规格说明书与评审',
      });
    } else if (
      Array.isArray(stateOrResult?.steps) &&
      stateOrResult.steps.length > 0
    ) {
      // 3.4 向后兼容：固定工作流 OrchestrationStep[] 或字符串 steps
      for (const step of stateOrResult.steps) {
        if (typeof step === 'string') {
          dynamicStepItems.push({
            title: step,
            label: step,
            status: 'completed',
          });
        } else if (typeof step === 'object' && step !== null) {
          dynamicStepItems.push({
            title: step.agent || step.title || 'step',
            label: step.agent || step.label || 'step',
            status:
              step.status === 'success'
                ? 'completed'
                : step.status === 'failed'
                  ? 'error'
                  : 'running',
            description: step.error || undefined,
          });
        }
      }
    }

    if (dynamicStepItems.length > 0) {
      const currentStepIndex = dynamicStepItems.findIndex(
        (item) => item.status === 'running' || item.status === 'process',
      );
      const stepsComp: StepsComponent = {
        type: 'steps',
        title: '需求分析流转生命周期',
        currentStep:
          currentStepIndex >= 0 ? currentStepIndex : dynamicStepItems.length,
        items: dynamicStepItems as any,
        steps: dynamicStepItems as any,
      };
      components.push(stepsComp);
    }

    // 4. 规格报告卡片组件（未中断且有报告时呈现）
    if (!isInterrupted && (stateOrResult?.summary || stateOrResult?.report)) {
      const cardComp: CardComponent = {
        type: 'card',
        title: '需求分析规格报告',
        status: 'completed',
        fields: [
          {
            label: '意图类别',
            value: stateOrResult?.intent || 'analyze',
          },
          ...(stateOrResult?.extracted?.priority
            ? [
                {
                  label: '优先级',
                  value: String(stateOrResult.extracted.priority),
                },
              ]
            : []),
        ],
        footer: 'AI 自动生成需求分析规格说明书',
      };
      components.push(cardComp);
    }

    return {
      message,
      components,
      context: {
        sessionStage: isInterrupted ? 'clarification_interrupted' : 'completed',
        collectedData: stateOrResult?.extracted || {},
      },
    };
  }

  /**
   * 9.6.3.1 流式编排方法 (streamOrchestrate)
   * 消费 streamAnalysisGraph 事件流，通过主图与专家子图双映射，
   * 输出适合 SSE 传输的 OrchestratorStreamEvent，为并行专家打上 parallel: true 标记
   *
   * @param input 用户需求输入
   * @param options 可选上下文与模型
   */
  async *streamOrchestrate(
    input: string,
    options?: {
      retrievedContext?: string;
      model?: any;
      useMultiAgent?: boolean;
      /** 11.10.3 RAG-as-Tool 依赖，传入后专家可按需检索知识库 */
      rag?: ExpertRagDeps;
    },
  ): AsyncGenerator<OrchestratorStreamEvent> {
    let currentStep = 0;

    // ① 主图节点 → Agent 名（参与主 step 计数）
    const nodeToAgentMap: Record<string, string> = {
      triage: 'triageAgent',
      classifier: 'classifierAgent',
      extractStep: 'extractAgent',
      clarifyStep: 'clarifyAgent',
      analysisStep: 'analysisAgent',
      riskStep: 'riskAgent',
      summaryStep: 'summaryAgent',
      queryHandler: 'queryAgent',
      chatHandler: 'chatAgent',
    };

    // ② 9.2 专家子图节点 → Agent 名（不参与主 step 计数，标记 parallel）
    const expertSubgraphMap: Record<string, string> = {
      supervisor: 'supervisorAgent',
      functional_expert: 'functionalExpert',
      performance_expert: 'performanceExpert',
      security_expert: 'securityExpert',
      compliance_expert: 'complianceExpert',
      aggregator: 'aggregatorAgent',
    };

    // 进度条主链 6 步基准
    const agentOrder = [
      'triageAgent',
      'extractAgent',
      'clarifyAgent',
      'analysisAgent',
      'riskAgent',
      'summaryAgent',
    ];

    const { streamAnalysisGraph } = await import(
      '../graph/requirement-analysis-graph.js'
    );

    const stream = streamAnalysisGraph(
      {
        input,
        retrievedContext: options?.retrievedContext || '',
      },
      {
        model: options?.model,
        useMultiAgent: options?.useMultiAgent ?? true,
        useTriage: true,
        rag: options?.rag,
      },
    );

    for await (const event of stream) {
      if (event.type === 'node_start' && (event.node || event.step)) {
        const nodeName = event.node || event.step || '';
        if (nodeName in expertSubgraphMap) {
          // 子图节点：沿用父 step，标记 parallel: true
          yield {
            type: 'agent_start',
            agent: expertSubgraphMap[nodeName],
            step: currentStep,
            totalSteps: agentOrder.length,
            parallel: true,
          };
        } else {
          // 主图节点：推进主 step 计数
          const agentName = nodeToAgentMap[nodeName] || nodeName;
          const idx = agentOrder.indexOf(agentName);
          currentStep = idx >= 0 ? idx + 1 : currentStep + 1;
          yield {
            type: 'agent_start',
            agent: agentName,
            step: currentStep,
            totalSteps: agentOrder.length,
            parallel: false,
          };
        }
      } else if (event.type === 'node_end' && (event.node || event.step)) {
        const nodeName = event.node || event.step || '';
        if (nodeName in expertSubgraphMap) {
          yield {
            type: 'agent_end',
            agent: expertSubgraphMap[nodeName],
            step: currentStep,
            totalSteps: agentOrder.length,
            parallel: true,
            result: event.output,
          };
        } else {
          const agentName = nodeToAgentMap[nodeName] || nodeName;
          yield {
            type: 'agent_end',
            agent: agentName,
            step: currentStep,
            totalSteps: agentOrder.length,
            parallel: false,
            result: event.output,
          };
        }
      } else if (event.type === 'token') {
        yield {
          type: 'token',
          content: event.content,
          agent: event.node
            ? expertSubgraphMap[event.node] || nodeToAgentMap[event.node]
            : undefined,
        };
      } else if (event.type === 'error') {
        yield {
          type: 'error',
          error: event.error,
        };
      } else if (event.type === 'done') {
        yield {
          type: 'complete',
          result: {
            status: 'completed',
            totalSteps: agentOrder.length,
          },
        };
      }
    }
  }
}
