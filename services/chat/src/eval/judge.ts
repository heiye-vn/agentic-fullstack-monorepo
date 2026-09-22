/**
 * services/chat/src/eval/judge.ts
 *
 * LLM-as-judge：按版本化 rubric 给需求分析报告打分（第十七章 17.5）
 *
 * 分工原则：**LLM 只负责它擅长的判断，算术和判定一律交给确定性代码**。
 *   - LLM 干：逐个维度给 0-100 的分 + 简短理由 + 总体评语
 *   - 代码干：加权总分（权重来自 rubric）、per-dimension 下限、gate 判定
 *
 * 之所以不让模型自报总分：同一份报告让同一个模型算加权平均，
 * 每次结果都可能差几分，评测就失去了可复现性 —— 而回归评估的全部价值就在可复现。
 *
 * ⚠️ **judge 必须由调用方传入模型实例**，且应与被测链路的模型不同
 * （建议用 DEFAULT_AGENT_MODEL_SET.criticModelConfigId 那一档）。
 * 让被测模型自己给自己打分会系统性地偏高，这是第十七章 17.5.3 点名的 judge 偏差。
 */
import { z } from 'zod';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { loadRubric, type Rubric } from './rubric-loader.js';

const dimScoreSchema = z.object({
  dimensionId: z.string().describe('维度英文 id，严格取自评分维度列表'),
  score: z.number().min(0).max(100).describe('该维度得分，0-100'),
  reason: z.string().describe('简短评分理由'),
});

const judgeSchema = z.object({
  dimensions: z.array(dimScoreSchema).describe('逐维度打分，必须覆盖列表里的每一个维度'),
  overallCritique: z.string().describe('总体评价与最关键的改进建议'),
});

export interface JudgeResult {
  /** 加权总分（0-100，四舍五入到整数） */
  totalScore: number;
  /** 各维度原始分，key 是 rubric 里的 dimension id */
  dimensions: Record<string, number>;
  /** 是否通过 rubric 的 gate（总分 + 单维度下限双重判定） */
  passed: boolean;
  /** 模型的总体评语 */
  critique: string;
  /** 判定时使用的 rubric 版本，用于追溯历史评测结果 */
  rubricVersion: number;
}

function buildJudgePrompt(rubric: Rubric): string {
  const dims = rubric.dimensions
    .map((d) => `- ${d.id}（${d.name}，权重 ${d.weight}）：${d.desc}`)
    .join('\n');
  const ids = rubric.dimensions.map((d) => d.id).join(' / ');

  return `你是资深需求评审专家，对一份"需求分析报告"按以下维度逐项打分（0-100）。

评分维度：
${dims}

要求：
- 只输出每个维度的分数和简短理由，**不要自己计算加权总分**（总分由系统计算）。
- dimensionId 必须严格用上面括号外的英文 id（${ids}），不要写中文名。
- 报告"又长又水"不应得高分：长度不是质量，空泛套话要在 actionability 上扣分。
- 缺少章节要如实反映在 completeness 上，不要因为文笔好而抬分。`;
}

/**
 * 用 rubric 驱动 LLM 给报告打分。
 *
 * @param model judge 用的模型实例（**不要**传被测链路那个实例）
 * @param report 待评分的报告正文
 * @param rubricId rubric 文件名（不含扩展名）
 */
export async function judgeReport(
  model: BaseChatModel,
  report: string,
  rubricId = 'requirement-analysis',
): Promise<JudgeResult> {
  const rubric = loadRubric(rubricId);

  const result = await (model as any)
    .withStructuredOutput(judgeSchema)
    .invoke([
      new SystemMessage(buildJudgePrompt(rubric)),
      new HumanMessage(`待评分报告：\n\n${report}`),
    ]);

  // 加权汇总在代码里算（权重来自 rubric），缺失的维度记 0 分
  const dims: Record<string, number> = {};
  let total = 0;
  for (const d of rubric.dimensions) {
    const got = Number(
      result?.dimensions?.find((x: { dimensionId: string }) => x.dimensionId === d.id)?.score ?? 0,
    );
    dims[d.id] = Number.isFinite(got) ? got : 0;
    total += dims[d.id] * d.weight;
  }

  const passed =
    total >= rubric.gate.minScore &&
    rubric.dimensions.every((d) => dims[d.id] >= rubric.gate.minPerDimension);

  return {
    totalScore: Math.round(total),
    dimensions: dims,
    passed,
    critique: String(result?.overallCritique ?? ''),
    rubricVersion: rubric.version,
  };
}
