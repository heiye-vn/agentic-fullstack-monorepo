import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  type SubAgents,
  defaultSubAgents,
  createSubAgents,
  type ExtractedRequirement,
  type ClarificationResult,
} from './sub-agents.js';
import type { ChatOpenAI } from '@langchain/openai';

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
}
