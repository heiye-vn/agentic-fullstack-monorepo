import { StringOutputParser } from '@langchain/core/output_parsers';
import type { Runnable } from '@langchain/core/runnables';
import type { ChatOpenAI } from '@langchain/openai';
import { createChatModel } from '../model.factory.js';
import {
  extractPrompt,
  clarifyPrompt,
  analysisPrompt,
  riskPrompt,
  summaryPrompt,
} from '../prompts/orchestrator.prompts.js';

/**
 * 需求抽取结果数据结构（对齐 orchestrator.prompts.ts）
 */
export interface ExtractedRequirement {
  requirementType?: string;
  coreFeature?: string;
  targetUsers?: string | string[];
  businessGoal?: string;
  constraints?: string[];
  priority?: 'high' | 'medium' | 'low';
  isComplete?: boolean;
  missingFields?: string[];
  // 兼容老版本通用字段
  action?: string;
  entities?: string[];
  rawGoal?: string;
  [key: string]: any;
}

/**
 * 需求澄清诊断结果数据结构（对齐 requirement.prompts.ts）
 */
export interface ClarificationResult {
  needsClarification: boolean;
  questions?: string[];
  clarificationQuestions?: string[];
  reason?: string;
}

/**
 * 子 Agent 容器接口
 */
export interface SubAgents {
  /** 需求抽取 Agent：从用户描述抽取结构化需求字段，输出 JSON */
  extractAgent: Runnable<Record<string, any>, string>;
  /** 澄清判断 Agent：判断是否需要澄清并生成问题，输出 JSON */
  clarifyAgent: Runnable<Record<string, any>, string>;
  /** 多维分析 Agent：功能分解/用户故事/验收标准/依赖/建议 */
  analysisAgent: Runnable<Record<string, any>, string>;
  /** 风险评估 Agent：风险识别与评估 */
  riskAgent: Runnable<Record<string, any>, string>;
  /** 报告汇总 Agent：汇总生成最终需求分析报告 */
  summaryAgent: Runnable<Record<string, any>, string>;
}

/**
 * 工厂函数：构建各子 Agent 链
 * 每一个 Agent 均严格基于 prompt.pipe(model).pipe(new StringOutputParser()) 构成 LCEL 链
 *
 * @param customModel 可选传入自定义模型实例，便于单元测试打桩或参数定制
 */
export function createSubAgents(customModel?: ChatOpenAI): SubAgents {
  const model = customModel ?? createChatModel();
  const outputParser = new StringOutputParser();

  return {
    extractAgent: extractPrompt.pipe(model).pipe(outputParser),
    clarifyAgent: clarifyPrompt.pipe(model).pipe(outputParser),
    analysisAgent: analysisPrompt.pipe(model).pipe(outputParser),
    riskAgent: riskPrompt.pipe(model).pipe(outputParser),
    summaryAgent: summaryPrompt.pipe(model).pipe(outputParser),
  };
}

/**
 * 默认单例子 Agent 实例导出
 */
export const defaultSubAgents = createSubAgents();
export const extractAgent = defaultSubAgents.extractAgent;
export const clarifyAgent = defaultSubAgents.clarifyAgent;
export const analysisAgent = defaultSubAgents.analysisAgent;
export const riskAgent = defaultSubAgents.riskAgent;
export const summaryAgent = defaultSubAgents.summaryAgent;
