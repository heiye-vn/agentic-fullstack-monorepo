import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { z } from 'zod';
import { createAnalysisGraph } from './requirement-analysis-graph.js';

/**
 * 单个计划步骤的结构定义
 */
export interface PlanStep {
  id: string;
  description: string;
  done: boolean;
}

/**
 * 第九章 9.5: Plan-and-Execute 外层流水线 State
 */
export const PipelineState = Annotation.Root({
  // 基础对话消息列表
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),

  // 任务拆解计划步骤
  plan: Annotation<PlanStep[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  // 当前执行步骤索引指针
  currentStepIndex: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),

  // 每步执行的分析结论映射字典（key 为 step.id）
  stepResults: Annotation<Record<string, string>>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({}),
  }),

  // Reflexion 阶段的反思记录历史
  reflections: Annotation<string[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),

  // 反思重试计数器（受硬上限约束）
  retryCount: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),

  // 父线程 ID（用于生成子 thread_id，隔离 Checkpoint）
  parentThreadId: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),

  // 最终汇总生成的联合分析总报告
  finalReport: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),

  // 质量评估是否通过
  approved: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),
});

export type PipelineStateType = typeof PipelineState.State;

/**
 * 任务规划 Zod Schema
 */
export const planSchema = z.object({
  steps: z
    .array(
      z.object({
        id: z.string().describe('步骤唯一标识符，例如 step-1'),
        description: z
          .string()
          .describe('该步骤的具体任务说明，可直接作为需求分析图的输入'),
      }),
    )
    .min(1)
    .max(10),
  reasoning: z.string().describe('任务拆解的逻辑推导与规划依据'),
});

export type PlanOutput = z.infer<typeof planSchema>;

/**
 * 1. 任务规划节点 (plannerNode)
 * 将复杂的跨工单联合分析需求拆解为有序的步骤计划列表
 */
export async function plannerNode(
  state: PipelineStateType,
  config: { model: BaseChatModel },
): Promise<Partial<PipelineStateType>> {
  const { model } = config;
  const structured = (model as any).withStructuredOutput(planSchema);

  const userInput =
    state.messages[0]?.content ||
    (state as any).input ||
    '';

  const result = (await structured.invoke([
    {
      role: 'system',
      content: `你是任务规划专家。将复杂的跨工单分析任务拆解为可执行的步骤。

**规则**：
1. 每个步骤应该是独立的、可执行的子任务
2. 步骤数量：最少 1 个，最多 10 个
3. 每个步骤的 description 应该是完整的、可直接传给需求分析系统的输入
4. 步骤之间应该有逻辑顺序（如先分析单个需求，再分析交叉影响）

**输出格式**：
- steps: 步骤数组，每项包含 id（唯一标识，如 "step-1"）和 description
- reasoning: 拆解的理由（为什么这样拆，每步做什么）`,
    },
    {
      role: 'user',
      content: `请将以下任务拆解为步骤：\n\n${userInput}`,
    },
  ])) as PlanOutput;

  const plan: PlanStep[] = result.steps.map((step) => ({
    ...step,
    done: false,
  }));

  return {
    plan,
    currentStepIndex: 0,
    parentThreadId: state.parentThreadId || `pipeline-${Date.now()}`,
  };
}

export interface ExecutorConfig {
  analysisGraph?: any;
  model?: BaseChatModel;
}

/**
 * 2. 单步执行节点 (executorNode)
 * 读取当前未执行步骤，调用底层完整主图并分配独立的子 thread_id
 */
export async function executorNode(
  state: PipelineStateType,
  config?: ExecutorConfig,
): Promise<Partial<PipelineStateType>> {
  const step = state.plan[state.currentStepIndex];
  if (!step) {
    return {};
  }

  const analysisGraph =
    config?.analysisGraph ??
    createAnalysisGraph({
      model: config?.model,
      useMultiAgent: true,
    });

  const parentThreadId = state.parentThreadId || 'pipeline';
  const childThreadId = `${parentThreadId}:step-${state.currentStepIndex}`;

  try {
    const subResult = await analysisGraph.invoke(
      { messages: [new HumanMessage(step.description)] },
      {
        configurable: {
          thread_id: childThreadId,
        },
      },
    );

    const updatedPlan = [...state.plan];
    updatedPlan[state.currentStepIndex] = { ...step, done: true };

    return {
      plan: updatedPlan,
      stepResults: {
        [step.id]:
          subResult.summary || subResult.analysisResult || '(无输出)',
      },
      currentStepIndex: state.currentStepIndex + 1,
    };
  } catch (error) {
    // 步骤级错误降级：记录失败但继续推进，由 evaluator 决定是否反思重跑
    const updatedPlan = [...state.plan];
    updatedPlan[state.currentStepIndex] = { ...step, done: true };
    return {
      plan: updatedPlan,
      stepResults: {
        [step.id]: `[执行失败] ${error instanceof Error ? error.message : String(error)}`,
      },
      currentStepIndex: state.currentStepIndex + 1,
    };
  }
}

/**
 * 报告质量评估 Zod Schema
 */
export const evaluationSchema = z.object({
  approved: z.boolean().describe('是否评估通过达标'),
  score: z.number().min(0).max(100).describe('质量总评分（0-100）'),
  issues: z.array(z.string()).describe('发现的质量缺失或逻辑问题列表'),
  suggestion: z.string().describe('改进建议与指导意见'),
});

export type EvaluationOutput = z.infer<typeof evaluationSchema>;

/**
 * 3. 质量评估节点 (evaluatorNode)
 * 拼接各步骤产物并调用评估模型进行 0-100 打分与问题甄别
 */
export async function evaluatorNode(
  state: PipelineStateType,
  config: { model: BaseChatModel },
): Promise<Partial<PipelineStateType>> {
  const { model } = config;
  const structured = (model as any).withStructuredOutput(evaluationSchema);

  // 拼接全量步骤的分析产物
  const allResults = state.plan
    .map((step, i) => {
      const result = state.stepResults[step.id];
      return `### 步骤${i + 1}:${step.description}\n结果：\n${result || '(未执行)'}`;
    })
    .join('\n\n---\n\n');

  const finalReport = `# 联合分析报告\n\n${allResults}`;

  const evaluation = (await structured.invoke([
    {
      role: 'system',
      content: `你是质量评估专家。评估跨工单联合分析报告的完整性和质量。

**评分标准**（0-100分）：
- 80-100分：所有工单都分析完整，交叉影响清晰，结论明确 → approved: true
- 60-79分：基本完整但有遗漏，或部分结论不够深入 → approved: false
- 0-59分：重大遗漏或逻辑错误 → approved: false

**评估维度**：
1. 每个子任务是否都有对应的分析结果
2. 交叉影响分析是否充分（如有多个工单）
3. 结论是否可操作、具体

如果 approved 为 false，在 issues 中列出具体问题，在 suggestion 中给出改进建议。`,
    },
    {
      role: 'user',
      content: `请评估以下报告：\n\n${finalReport}`,
    },
  ])) as EvaluationOutput;

  return {
    finalReport,
    approved: evaluation.approved,
  };
}

/**
 * 反思与计划修订 Zod Schema
 */
export const reflectSchema = z.object({
  revisedSteps: z
    .array(
      z.object({
        id: z.string().describe('修订后的步骤ID'),
        description: z.string().describe('修订后的步骤说明'),
      }),
    )
    .min(1)
    .max(10),
  reflection: z.string().describe('反思与原因复盘'),
});

export type ReflectOutput = z.infer<typeof reflectSchema>;

/**
 * 4. 反思修订节点 (reflectorNode)
 * 分析不达标原因，修订计划并重置执行游标回边到 executor
 */
export async function reflectorNode(
  state: PipelineStateType,
  config: { model: BaseChatModel },
): Promise<Partial<PipelineStateType>> {
  const { model } = config;
  const structured = (model as any).withStructuredOutput(reflectSchema);

  const result = (await structured.invoke([
    {
      role: 'system',
      content: `分析为什么总报告不达标。如果是前面步骤信息不足，修订计划（补充新步骤或调整现有步骤）；如果只是表达问题，返回原计划不变。

返回修订后的步骤列表和反思总结。`,
    },
    {
      role: 'user',
      content: `当前报告：\n${state.finalReport}\n\n当前计划：\n${JSON.stringify(state.plan, null, 2)}`,
    },
  ])) as ReflectOutput;

  const newPlan: PlanStep[] = result.revisedSteps.map((s) => ({
    ...s,
    done: false,
  }));

  return {
    plan: newPlan,
    currentStepIndex: 0, // 从头开始重跑，但带着 reflections
    reflections: [result.reflection],
    retryCount: state.retryCount + 1,
  };
}

/**
 * 条件路由：判断是否仍有未执行的步骤
 */
export function shouldContinue(
  state: PipelineStateType,
): 'executor' | 'evaluator' {
  if (state.currentStepIndex < state.plan.length) {
    return 'executor';
  }
  return 'evaluator';
}

/**
 * 条件路由：评估后判断是否需要进入 Reflexion 反思重跑
 */
export function shouldReflect(
  state: PipelineStateType,
): 'reflector' | typeof END {
  if (state.approved) {
    return END;
  }

  // 硬上限控制：重试 1 次即强制停止，防止无限循环
  if (state.retryCount >= 1) {
    return END;
  }

  return 'reflector';
}

/**
 * 5. 外层流水线图装配函数 (createPipelineGraph)
 * 编排拓扑：planner → executor ⇄ shouldContinue → evaluator → shouldReflect → reflector → executor
 */
export function createPipelineGraph(model: BaseChatModel) {
  const analysisGraph = createAnalysisGraph({
    model,
    useMultiAgent: true,
  });

  return new StateGraph(PipelineState)
    .addNode('planner', (state: PipelineStateType) =>
      plannerNode(state, { model }),
    )
    .addNode('executor', (state: PipelineStateType) =>
      executorNode(state, { analysisGraph, model }),
    )
    .addNode('evaluator', (state: PipelineStateType) =>
      evaluatorNode(state, { model }),
    )
    .addNode('reflector', (state: PipelineStateType) =>
      reflectorNode(state, { model }),
    )
    .addEdge(START, 'planner')
    .addEdge('planner', 'executor')
    .addConditionalEdges('executor', shouldContinue, {
      executor: 'executor',
      evaluator: 'evaluator',
    })
    .addConditionalEdges('evaluator', shouldReflect, {
      reflector: 'reflector',
      [END]: END,
    })
    .addEdge('reflector', 'executor')
    .compile();
}

/**
 * 顶层批处理执行结果
 */
export interface RunPipelineResult {
  finalReport: string;
  approved: boolean;
  retryCount: number;
  plan: PlanStep[];
  stepResults: Record<string, string>;
  reflections: string[];
}

/**
 * 顶层非流式联合分析执行入口
 */
export async function runPipeline(
  input: string,
  model: BaseChatModel,
): Promise<RunPipelineResult> {
  const graph = createPipelineGraph(model);
  const result = (await graph.invoke({
    messages: [new HumanMessage(input)],
  })) as PipelineStateType;

  return {
    finalReport: result.finalReport,
    approved: result.approved,
    retryCount: result.retryCount,
    plan: result.plan,
    stepResults: result.stepResults,
    reflections: result.reflections,
  };
}
