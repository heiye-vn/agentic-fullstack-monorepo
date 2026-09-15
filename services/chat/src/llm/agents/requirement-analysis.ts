import {
  runAnalysisGraph,
  createAnalysisGraph,
  RequirementAnalysisState,
  type AnalysisGraphInput,
  type AnalysisGraphOptions,
  type RequirementAnalysisStateType,
  type RunAnalysisGraphOutput,
} from '../graph/requirement-analysis-graph.js';
import {
  defaultSubAgents,
  type SubAgents,
  type ExtractedRequirement,
  type ClarificationResult,
} from './sub-agents.js';
import { safeParseJson } from './orchestrator.service.js';

/**
 * 保留第六章基于 Promise 链的原始执行逻辑（用于基准对比与验证）
 * 包含：抽取 -> 澄清 -> 分析与风控 (Promise.all) -> 报告汇总
 */
export async function runLegacyAnalysisChain(
  input: string,
  options?: { subAgents?: SubAgents },
): Promise<{
  extracted: ExtractedRequirement;
  clarified: ClarificationResult;
  analysis: string;
  risk: string;
  summary: string;
}> {
  const agents = options?.subAgents ?? defaultSubAgents;
  const sanitizedInput = input?.trim() ?? '';

  // 1. 结构化抽取
  const extractRaw = await agents.extractAgent.invoke({
    input: sanitizedInput,
    history: [],
  });
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

  // 2. 澄清诊断
  const extractionStr = JSON.stringify(extracted, null, 2);
  const clarifyRaw = await agents.clarifyAgent.invoke({
    input: sanitizedInput,
    extractResult: extractionStr,
    extraction: extractionStr,
  });
  const clarified = safeParseJson<ClarificationResult>(clarifyRaw, {
    needsClarification: false,
    questions: [],
    clarificationQuestions: [],
    reason: '默认无需澄清',
  });

  // 3. 多维分析与风险评估 (旧链并行执行)
  const [analysis, risk] = await Promise.all([
    agents.analysisAgent.invoke({
      input: sanitizedInput,
      extractResult: extractionStr,
      extraction: extractionStr,
    }),
    agents.riskAgent.invoke({
      input: sanitizedInput,
      extractResult: extractionStr,
      extraction: extractionStr,
    }),
  ]);

  // 4. 汇总报告
  const summary = await agents.summaryAgent.invoke({
    input: sanitizedInput,
    extractResult: extractionStr,
    extraction: extractionStr,
    analysisResult: analysis,
    analysis: analysis,
    riskResult: risk,
    risk: risk,
    retrievedContext: '本次分析未检索到相关参考文档。',
  });

  return {
    extracted,
    clarified,
    analysis,
    risk,
    summary,
  };
}

/**
 * 第六章需求分析入口函数 (Ch6 Entry Point)
 * 仅保留对外统一入口签名，内部转调新的 LangGraph 图引擎
 */
export async function runRequirementAnalysis(
  input: AnalysisGraphInput,
  options?: AnalysisGraphOptions,
): Promise<RunAnalysisGraphOutput> {
  return runAnalysisGraph(input, options);
}

// 导出图相关能力，便于调用方无缝使用
export {
  createAnalysisGraph,
  runAnalysisGraph,
  RequirementAnalysisState,
  type AnalysisGraphInput,
  type AnalysisGraphOptions,
  type RequirementAnalysisStateType,
  type RunAnalysisGraphOutput,
};

export default runRequirementAnalysis;
