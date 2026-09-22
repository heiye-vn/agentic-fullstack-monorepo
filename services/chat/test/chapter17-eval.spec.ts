/**
 * chapter17-eval.spec.ts
 *
 * 第十七章《评估流水线》配套测试
 *
 * Layer 1：零 LLM 依赖（确定性，默认全部执行）
 *   - 17.3 precisionAtK：分母是「返回数」而非「相关总数」；各类边界不抛错
 *   - 17.3 reciprocalRank：第一个相关结果的排名倒数，未命中为 0
 *   - 17.7 aggregate：按 tag 分桶、缺失维度不拉低均值、rr 汇总成 mrr、空输入安全
 *   - 17.7 gateDecision：三档阈值判定、维度缺席不误判、失败 case 让整轮 fail
 *   - 17.5 judge：加权总分在代码里算（不依赖 LLM 算术）、单维度下限独立于总分生效
 *   - 17.5 rubric-loader：权重之和必须为 1、criticChecklist 可组装成 prompt
 *
 * Layer 2：真实 LLM（需 OPENAI_API_KEY 且 RUN_LLM_EVAL_TESTS=1）
 *   - judge 对"详实报告"打分明显高于"空泛水报告"
 *
 * 运行：
 *   pnpm vitest run test/chapter17-eval.spec.ts
 *   RUN_LLM_EVAL_TESTS=1 ...     # 追加 Layer 2
 */
import { describe, it, expect } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  precisionAtK,
  reciprocalRank,
  recallAtK,
  ndcgAtK,
} from '../src/rag/evaluation/retrieval-metrics.js';
import {
  aggregate,
  gateDecision,
  describeGateFailures,
  DEFAULT_GATE,
  OVERALL_BUCKET,
  type CaseResult,
} from '../src/rag/evaluation/aggregate.js';
import { judgeReport } from '../src/eval/judge.js';
import { loadRubric, buildCriticChecklistPrompt, clearRubricCache } from '../src/eval/rubric-loader.js';
import {
  loadDataset,
  loadCorpus,
  validateGroundTruth,
  EVAL_USER_ID,
  type ExpectedIntent,
} from '../src/eval/dataset-loader.js';

const RUN_LLM = process.env.RUN_LLM_EVAL_TESTS === '1';

/**
 * 只实现 judge 实际会用到的那部分模型接口（withStructuredOutput → invoke），
 * 把「LLM 打分」这一步固定住，剩下的加权与 gate 逻辑才能确凿地被断言。
 */
function mockJudgeModel(
  dimensions: Array<{ dimensionId: string; score: number; reason: string }>,
): BaseChatModel {
  return {
    withStructuredOutput: () => ({
      invoke: async () => ({ dimensions, overallCritique: 'mock critique' }),
    }),
  } as unknown as BaseChatModel;
}

/** 把一组「维度名 → 分数」拼成 mock 模型能返回的格式 */
function dims(scores: Record<string, number>) {
  return Object.entries(scores).map(([dimensionId, score]) => ({
    dimensionId,
    score,
    reason: 'r',
  }));
}

// ============================================================================
// Layer 1：零 LLM 依赖
// ============================================================================

describe('17.3 检索指标：Precision@K', () => {
  const retrieved = ['c1', 'c5', 'c3', 'c8', 'c9'];
  const relevant = ['c1', 'c3'];

  it('前 5 个里命中 2 个 = 0.4（分母是实际返回数）', () => {
    expect(precisionAtK(retrieved, relevant, 5)).toBeCloseTo(0.4);
  });

  it('与 Recall@K 在同一次检索下分母不同，因此结果不同', () => {
    // 相关 2 个全部命中 → recall = 2/2 = 1，precision = 2/5 = 0.4
    expect(recallAtK(retrieved, relevant, 5)).toBe(1);
    expect(precisionAtK(retrieved, relevant, 5)).toBeCloseTo(0.4);
    expect(precisionAtK(retrieved, relevant, 5)).not.toBe(recallAtK(retrieved, relevant, 5));
  });

  it('缩小 topK 会抬高 Precision、压低 Recall（两者不可互相替代）', () => {
    // 只返回第 1 个结果 c1，命中 1/1 = 1.0；recall 则掉到 1/2
    expect(precisionAtK(retrieved, relevant, 1)).toBeCloseTo(1);
    expect(recallAtK(retrieved, relevant, 1)).toBeCloseTo(0.5);
  });

  it('返回列表里有重复 id 时按去重后计数，不会刷高 Precision', () => {
    expect(precisionAtK(['c1', 'c1', 'c1'], ['c1'], 3)).toBeCloseTo(1 / 3);
  });

  it('边界：k<=0、无相关标注、检索零召回都不抛错且返回 0', () => {
    expect(precisionAtK(retrieved, relevant, 0)).toBe(0);
    expect(precisionAtK(retrieved, [], 5)).toBe(0);
    // 检索什么都没召回时返回 0，而不是 NaN 污染聚合均值
    expect(precisionAtK([], relevant, 5)).toBe(0);
    expect(Number.isNaN(precisionAtK([], relevant, 5))).toBe(false);
  });
});

describe('17.3 检索指标：Reciprocal Rank', () => {
  it('第一个相关结果排第 1 → 1.0，排第 3 → 1/3', () => {
    expect(reciprocalRank(['c1', 'c2'], ['c1'])).toBe(1);
    expect(reciprocalRank(['x', 'y', 'c1'], ['c1'])).toBeCloseTo(1 / 3);
  });

  it('完全没命中 → 0', () => {
    expect(reciprocalRank(['x', 'y'], ['c1'])).toBe(0);
  });

  it('边界：空检索结果或无相关标注 → 0', () => {
    expect(reciprocalRank([], ['c1'])).toBe(0);
    expect(reciprocalRank(['c1'], [])).toBe(0);
  });

  it('多个相关文档时只看排在最前面那个（RR 的定义）', () => {
    expect(reciprocalRank(['x', 'c2', 'c1'], ['c1', 'c2'])).toBeCloseTo(0.5);
  });
});

describe('17.7 aggregate 分桶聚合', () => {
  const results: CaseResult[] = [
    { id: 'a', tags: ['typical', 'auth'], metrics: { recall: 1, intentCorrect: 1, rr: 1 } },
    { id: 'b', tags: ['typical'], metrics: { recall: 0.5, intentCorrect: 1, rr: 0.5 } },
    { id: 'c', tags: ['chat'], metrics: { intentCorrect: 0 } }, // 无检索指标
  ];

  it('按 tag 分桶，并额外给出全量汇总桶', () => {
    const s = aggregate(results);
    const typical = s.buckets.find((b) => b.bucket === 'typical');
    expect(typical).toBeDefined();
    expect(typical!.n).toBe(2);
    expect(typical!.recall).toBeCloseTo(0.75);
    expect(s.overall.bucket).toBe(OVERALL_BUCKET);
    expect(s.overall.n).toBe(3);
  });

  it('缺失维度不拉低均值（chat 没有 recall，不该被当成 0）', () => {
    const s = aggregate(results);
    // recall 只在 2 个有该指标的 case 上平均 = (1 + 0.5) / 2
    expect(s.overall.recall).toBeCloseTo(0.75);
    // intentCorrect 三个都有 = (1 + 1 + 0) / 3
    expect(s.overall.intentCorrect).toBeCloseTo(2 / 3);
  });

  it('逐 case 的 rr 汇总成 mrr 呈现', () => {
    const s = aggregate(results);
    expect(s.overall.mrr).toBeCloseTo(0.75); // (1 + 0.5) / 2
    expect(s.overall).not.toHaveProperty('rr');
  });

  it('桶名按字典序稳定输出，方便报告 diff', () => {
    const s = aggregate(results);
    expect(s.buckets.map((b) => b.bucket)).toEqual(['auth', 'chat', 'typical']);
  });

  it('空输入不抛错，返回零值汇总', () => {
    const s = aggregate([]);
    expect(s.overall.n).toBe(0);
    expect(s.buckets).toEqual([]);
    expect(s.failedCases).toBe(0);
  });

  it('失败 case 计入 failed 但不污染指标均值', () => {
    const s = aggregate([
      { id: 'ok', tags: ['t'], metrics: { recall: 1 } },
      { id: 'boom', tags: ['t'], metrics: {}, error: 'graph invoke failed' },
    ]);
    expect(s.overall.n).toBe(2);
    expect(s.overall.failed).toBe(1);
    expect(s.failedCases).toBe(1);
    // 失败 case 的 metrics 是空的 → 均值只在成功 case 上算
    expect(s.overall.recall).toBeCloseTo(1);
  });
});

describe('17.7 gateDecision 门禁判定', () => {
  const summaryWith = (metrics: CaseResult['metrics'], extra: Partial<CaseResult> = {}) =>
    aggregate([{ id: 'x', tags: ['t'], metrics, ...extra }]);

  it('recall 低于阈值 → fail', () => {
    expect(
      gateDecision(summaryWith({ recall: 0.7, judgeScore: 80, intentCorrect: 0.95 })),
    ).toBe(false);
  });

  it('三项全部达标 → pass', () => {
    expect(
      gateDecision(summaryWith({ recall: 0.85, judgeScore: 80, intentCorrect: 0.95 })),
    ).toBe(true);
  });

  it('--no-llm 场景只有 recall 时，不因 judge/intent 缺席误判 fail', () => {
    expect(gateDecision(summaryWith({ recall: 0.9 }))).toBe(true);
  });

  it('存在失败 case → 无论均值多高都 fail', () => {
    expect(
      gateDecision(
        summaryWith({ recall: 1, judgeScore: 100, intentCorrect: 1 }, {
          error: 'boom',
        }),
      ),
    ).toBe(false);
  });

  it('allowFailedCases 放开后可容忍少量失败', () => {
    expect(
      gateDecision(
        summaryWith({ recall: 1, judgeScore: 100, intentCorrect: 1 }, { error: 'boom' }),
        { ...DEFAULT_GATE, allowFailedCases: 1 },
      ),
    ).toBe(true);
  });

  it('describeGateFailures 能说出具体是哪一项没达标', () => {
    const reasons = describeGateFailures(
      summaryWith({ recall: 0.5, judgeScore: 90, intentCorrect: 1 }),
    );
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('Recall');
  });

  it('通过时 describeGateFailures 返回空数组', () => {
    expect(
      describeGateFailures(summaryWith({ recall: 0.9, judgeScore: 90, intentCorrect: 1 })),
    ).toEqual([]);
  });
});

describe('17.5 judge：加权总分由代码计算', () => {
  it('各维度同分时，加权总分等于该分数（权重之和为 1）', async () => {
    const model = mockJudgeModel(
      dims({ completeness: 80, professionalism: 80, actionability: 80, consistency: 80 }),
    );
    const r = await judgeReport(model, '报告');
    expect(r.totalScore).toBe(80);
    expect(r.passed).toBe(true);
    expect(r.rubricVersion).toBe(loadRubric().version);
  });

  it('按 rubric 权重加权，而不是简单平均', async () => {
    // 30%*100 + 25%*60 + 25%*60 + 20%*60 = 72（简单平均会得到 75）
    const model = mockJudgeModel(
      dims({ completeness: 100, professionalism: 60, actionability: 60, consistency: 60 }),
    );
    const r = await judgeReport(model, '报告');
    expect(r.totalScore).toBe(72);
  });

  it('单维度低于 per-dimension 下限 → 即使总分达标也 fail', async () => {
    // completeness=50(<60)，其余 90：总分 = 50*.3 + 90*.25 + 90*.25 + 90*.2 = 78 ≥ 75
    const model = mockJudgeModel(
      dims({ completeness: 50, professionalism: 90, actionability: 90, consistency: 90 }),
    );
    const r = await judgeReport(model, '报告');
    expect(r.totalScore).toBe(78);
    expect(r.passed).toBe(false);
  });

  it('模型漏给某个维度 → 该维度记 0 分而不是让总分 NaN', async () => {
    const model = mockJudgeModel(
      dims({ completeness: 100, professionalism: 100 }), // 少两个维度
    );
    const r = await judgeReport(model, '报告');
    expect(Number.isNaN(r.totalScore)).toBe(false);
    expect(r.totalScore).toBe(55); // 100*.3 + 100*.25 + 0 + 0
    expect(r.passed).toBe(false);
  });
});

describe('17.5 rubric 外置与共享', () => {
  it('维度权重之和严格为 1（否则 judge 的加权总分没有意义）', () => {
    const rubric = loadRubric();
    const sum = rubric.dimensions.reduce((s, d) => s + d.weight, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(rubric.gate.minScore).toBeGreaterThan(0);
    expect(rubric.gate.minPerDimension).toBeGreaterThan(0);
  });

  it('同时提供 dimensions（离线 judge）与 criticChecklist（在线 critic）', () => {
    const rubric = loadRubric();
    expect(rubric.dimensions.length).toBeGreaterThan(0);
    expect(rubric.criticChecklist.length).toBeGreaterThan(0);
    // 在线 critic 的清单不能带权重 —— 它只产出二值结论
    expect(rubric.criticChecklist.every((i) => (i as { weight?: number }).weight === undefined)).toBe(
      true,
    );
  });

  it('criticChecklist 能组装成可注入 criticNode 的 prompt 片段', () => {
    const prompt = buildCriticChecklistPrompt();
    expect(prompt).not.toBeNull();
    for (const item of loadRubric().criticChecklist) {
      expect(prompt).toContain(item.name);
      expect(prompt).toContain(item.desc);
    }
  });

  it('同一 rubricId 重复加载命中缓存（对象引用相同）', () => {
    clearRubricCache();
    const a = loadRubric();
    const b = loadRubric();
    expect(a).toBe(b);
  });

  it('NDCG@K 仍然可用：相关结果越靠前越接近 1', () => {
    expect(ndcgAtK(['c1', 'c3', 'x', 'y'], ['c1', 'c3'], 4)).toBeCloseTo(1, 6);
    expect(ndcgAtK(['x', 'y', 'c1', 'c3'], ['c1', 'c3'], 4)).toBeLessThan(
      ndcgAtK(['c1', 'c3', 'x', 'y'], ['c1', 'c3'], 4),
    );
  });
});

describe('17.6 golden 数据集与评测语料', () => {
  const cases = loadDataset();
  const corpus = loadCorpus();

  it('规模达标且三种意图都覆盖到', () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
    const intents = new Set(cases.map((c) => c.expectedIntent));
    expect(intents).toEqual(new Set(['analyze', 'query', 'chat'] as ExpectedIntent[]));
  });

  it('analyze 是主要场景，占比过半但不是全部', () => {
    const analyzeCount = cases.filter((c) => c.expectedIntent === 'analyze').length;
    expect(analyzeCount / cases.length).toBeGreaterThan(0.5);
    expect(analyzeCount).toBeLessThan(cases.length);
  });

  it('每条 case 都有非空 input 和至少一个分桶 tag', () => {
    for (const c of cases) {
      expect(c.input.trim().length).toBeGreaterThan(0);
      expect(c.tags.length).toBeGreaterThan(0);
    }
  });

  it('query 类 case 必须带 REQ- 编号', () => {
    // 意图分类器（INTENT_CLASSIFIER_SYSTEM_PROMPT）把「输入中出现 REQ- 编号」
    // 当作判定 query 的最高优先级信号。标注一条没有编号的 query case，
    // 等于埋一个必挂的陷阱 —— 这里提前拦住。
    for (const c of cases.filter((x) => x.expectedIntent === 'query')) {
      expect(c.input).toMatch(/REQ-[A-Za-z0-9-]+/i);
    }
  });

  it('语料 chunkId 唯一、字段完整', () => {
    const ids = corpus.map((c) => c.chunkId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of corpus) {
      expect(c.content.trim().length).toBeGreaterThan(0);
      expect(c.documentId.length).toBeGreaterThan(0);
      expect(c.documentName.length).toBeGreaterThan(0);
    }
  });

  it('语料里存在未被任何 case 引用的干扰项，否则 Precision 会失真', () => {
    // Precision@K 的分母是「实际返回数」。如果语料里每个 chunk 都被标注成相关，
    // 那召回任何东西都不算错，Precision 恒为 1 —— 这个指标就失去意义了。
    const referenced = new Set(cases.flatMap((c) => c.relevantChunkIds ?? []));
    const distractors = corpus.filter((c) => !referenced.has(c.chunkId));
    expect(distractors.length).toBeGreaterThan(0);
  });

  it('ground truth 与语料完全对齐（改了语料 chunkId 必须同步改数据集）', () => {
    expect(validateGroundTruth(cases, corpus)).toEqual([]);
  });

  it('validateGroundTruth 能抓出指向不存在 chunk 的引用', () => {
    const problems = validateGroundTruth(
      [{ id: 'x', input: 'x', expectedIntent: 'analyze', tags: ['t'], relevantChunkIds: ['c-not-exist'] }],
      [{ chunkId: 'c-auth-1', documentId: 'd', documentName: 'd', content: 'c' }],
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('c-not-exist');
    expect(problems[0]).toContain('x');
  });

  it('评测使用独立的 eval-bot 账号，不碰真实用户数据', () => {
    expect(EVAL_USER_ID).toBe('eval-bot');
  });
});

// ============================================================================
// Layer 2：真实 LLM（需 RUN_LLM_EVAL_TESTS=1）
// ============================================================================

describe.skipIf(!RUN_LLM)('17.5 judge 真实区分度（Layer 2）', () => {
  it('详实报告的得分明显高于空泛水报告', async () => {
    // 这里刻意不 import createChatModel：集成 runner（第三批）会统一管理模型档位，
    // 本用例只验证 rubric + judge 组合在真实模型上的区分能力。
    const { ChatOpenAI } = await import('@langchain/openai');
    const model = new ChatOpenAI({
      model: process.env.EVAL_JUDGE_MODEL || 'qwen3.8-max',
      temperature: 0,
      apiKey: process.env.OPENAI_API_KEY,
      configuration: { baseURL: process.env.OPENAI_BASE_URL },
    });

    const goodReport = `# 企业微信扫码登录 需求分析
## 功能分解
1. 前端二维码渲染与轮询；2. 企业微信 code 回调换 userid；3. 首次登录用户绑定。
## 用户故事
作为员工，我希望用企业微信扫码一键登录，免去记密码。
## 验收标准
- 扫码 3 秒内完成登录；code 一次性、state 校验防 CSRF。
## 风险与依赖
依赖企业微信管理后台可信域名配置；需处理 code 过期与重复使用。
## 排期
前端 2 天 / 后端 3 天 / 联调 1 天。`;

    const waterReport =
      '这个需求很重要，我们应该认真做好，把登录功能做得更好用一些，提升用户体验。';

    const good = await judgeReport(model, goodReport);
    const water = await judgeReport(model, waterReport);

    expect(good.totalScore).toBeGreaterThan(water.totalScore);
    expect(good.totalScore - water.totalScore).toBeGreaterThan(10);
  }, 300_000);
});
