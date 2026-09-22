/**
 * services/chat/src/rag/evaluation/aggregate.ts
 *
 * 评测结果聚合与质量门禁（第十七章 17.7）
 *
 * 三条必须守住的语义（改这里之前请先读完注释，踩回去都是静默错）：
 *
 * 1. **缺失维度不参与均值。** chat/query 类 case 天生没有检索指标，
 *    如果缺席算 0，召回均值会被一批无关 case 拉到门禁线以下，
 *    看起来像「RAG 坏了」，实际是聚合 bug。
 * 2. **缺席维度不卡门禁。** 评估是分层触发的：--no-llm 跑出来的只有检索指标，
 *    此时不该因为 judgeScore 是 undefined 就判定 fail。
 *    这一条与第 1 条是配套设计，缺一不可。
 * 3. **失败的 case 让整轮 fail，但不污染均值。** error case 的 metrics 是空的，
 *    按第 1 条它自动不进均值；但 failedCases > 0 时门禁直接 fail，
 *    否则一个 case 崩掉反而会因「样本变少」把平均分抬高。
 */

/** 单个 case 上采集到的指标；全部可选，因为不同意图的 case 覆盖不同维度 */
export interface CaseMetrics {
  /** triage 是否命中期望意图（0/1） */
  intentCorrect?: number;
  /** Recall@K */
  recall?: number;
  /** Precision@K */
  precision?: number;
  /** NDCG@K */
  ndcg?: number;
  /** 该 case 的 Reciprocal Rank，聚合后按 MRR 口径呈现 */
  rr?: number;
  /** LLM-as-judge 加权总分（0-100） */
  judgeScore?: number;
  /** RAGAS faithfulness（0-1，服务可达才有） */
  faithfulness?: number;
}

export interface CaseResult {
  id: string;
  tags: string[];
  metrics: CaseMetrics;
  /** judge 的单维度结果是否通过（仅跑了 judge 的 case 才有） */
  judgePassed?: boolean;
  /**
   * 该 case 执行失败的原因。
   * 存在即意味着这次评测不完整：runner 应当在报告里原样展示，
   * 并让整轮门禁 fail（见 gateDecision 的 allowFailedCases）。
   */
  error?: string;
}

export interface BucketStats {
  /** 桶名：某个 tag，或汇总桶 OVERALL */
  bucket: string;
  /** 该桶内的 case 数 */
  n: number;
  /** 该桶内 metrics 缺失的 case 数（有 error 的） */
  failed: number;
  recall?: number;
  precision?: number;
  ndcg?: number;
  mrr?: number;
  judgeScore?: number;
  intentCorrect?: number;
  faithfulness?: number;
}

export interface EvalSummary {
  overall: BucketStats;
  buckets: BucketStats[];
  /** 全量失败 case 数，供 runner 直接打控制台 */
  failedCases: number;
}

/** 汇总桶的固定桶名；后面判断「这是不是汇总桶」统一用它，不要写字符串字面量 */
export const OVERALL_BUCKET = 'OVERALL';

/**
 * CaseMetrics 的字段名 → BucketStats 的字段名。
 * rr 之所以要改名叫 mrr：单看一个 case 只有 RR，多个 case 取均值才是 MRR，
 * 报告里混用两个名字会让人以为是两套指标。
 */
const METRIC_TO_STAT: Record<
  keyof CaseMetrics,
  Exclude<keyof BucketStats, 'bucket' | 'n' | 'failed'>
> = {
  intentCorrect: 'intentCorrect',
  recall: 'recall',
  precision: 'precision',
  ndcg: 'ndcg',
  rr: 'mrr',
  judgeScore: 'judgeScore',
  faithfulness: 'faithfulness',
};

/**
 * 在「定义了该指标的 case」上取平均；一个都没有则返回 undefined。
 * 返回 undefined 而不是 0 是刻意的 —— 0 会被下游当成真实成绩后续参与五花八门的判断。
 */
function avgDefined(results: CaseResult[], key: keyof CaseMetrics): number | undefined {
  let sum = 0;
  let count = 0;
  for (const r of results) {
    const v = r.metrics[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      sum += v;
      count += 1;
    }
  }
  return count === 0 ? undefined : sum / count;
}

function statsFor(bucket: string, results: CaseResult[]): BucketStats {
  const failed = results.filter((r) => typeof r.error === 'string').length;
  const s: BucketStats = { bucket, n: results.length, failed };

  for (const [metricKey, statKey] of Object.entries(METRIC_TO_STAT) as Array<
    [keyof CaseMetrics, Exclude<keyof BucketStats, 'bucket' | 'n' | 'failed'>]
  >) {
    const v = avgDefined(results, metricKey);
    if (v !== undefined) {
      // 用 Object.assign 而不是 s[statKey] = v：BucketStats 的字段全是可选的具名字段，
      // 直接下标赋值需要先把 BucketStats 强转成 Record<string, number>，那层断言会掩盖拼写错误
      Object.assign(s, { [statKey]: v });
    }
  }

  return s;
}

/**
 * 把逐 case 结果按 tag 分桶聚合。
 *
 * 每个 case 会同时出现在它所有 tag 的桶里（一个 auth+typical 的 case 两桶都算），
 * 所以各桶 n 之和通常大于总数 —— 这是设计意图，桶是用来看「某一类需求的短板」，
 * 不是用来凑合等于全量的。
 *
 * @param results 逐 case 结果
 * @returns 全量汇总 + 各 tag 分桶
 */
export function aggregate(results: CaseResult[]): EvalSummary {
  if (!results || results.length === 0) {
    return {
      overall: { bucket: OVERALL_BUCKET, n: 0, failed: 0 },
      buckets: [],
      failedCases: 0,
    };
  }

  const tagSet = new Set<string>();
  for (const r of results) {
    for (const t of r.tags ?? []) tagSet.add(t);
  }

  // 桶名排序保证报告可 diff：同样的输入永远产出同样的行顺序
  const buckets = [...tagSet].sort().map((tag) =>
    statsFor(
      tag,
      results.filter((r) => (r.tags ?? []).includes(tag)),
    ),
  );

  const failedCases = results.filter((r) => typeof r.error === 'string').length;

  return {
    overall: statsFor(OVERALL_BUCKET, results),
    buckets,
    failedCases,
  };
}

export interface GateThresholds {
  /** 全量 Recall 均值下限 */
  minRecall: number;
  /** 全量 judge 加权总分下限 */
  minJudgeScore: number;
  /** 全量 triage 准确率下限 */
  minIntentCorrect: number;
  /**
   * 允许的执行失败 case 数，默认 0。
   * 之所以是「个数」而不是「比例」：小样本下 1 个 case 失败
   * 就是 10% 以上，比例阈值容易在样本增长时失真。
   */
  allowFailedCases: number;
}

export const DEFAULT_GATE: GateThresholds = {
  minRecall: 0.8,
  minJudgeScore: 75,
  minIntentCorrect: 0.9,
  allowFailedCases: 0,
};

/**
 * 门禁判定：先看有没有 case 崩掉，再逐条过存在的 metric 阈值。
 *
 * 「维度存在才判」是一致的设计：评估可以分层跑（只跑检索 / 只跑 judge），
 * 每次只应对这次真正测了的东西负责。
 *
 * @param summary aggregate 的产物
 * @param thresholds 阈值，缺省用 DEFAULT_GATE
 * @returns true 表示通过
 */
export function gateDecision(
  summary: EvalSummary,
  thresholds: GateThresholds = DEFAULT_GATE,
): boolean {
  if (summary.failedCases > thresholds.allowFailedCases) return false;

  const o = summary.overall;
  if (o.recall !== undefined && o.recall < thresholds.minRecall) return false;
  if (o.judgeScore !== undefined && o.judgeScore < thresholds.minJudgeScore) return false;
  if (o.intentCorrect !== undefined && o.intentCorrect < thresholds.minIntentCorrect) {
    return false;
  }
  return true;
}

/**
 * 把门禁失败的原因列成人话，给 runner 打控制台 / CI 注解用。
 * 返回值是中文短句数组，空数组表示通过。
 */
export function describeGateFailures(
  summary: EvalSummary,
  thresholds: GateThresholds = DEFAULT_GATE,
): string[] {
  const reasons: string[] = [];
  if (summary.failedCases > thresholds.allowFailedCases) {
    reasons.push(`有 ${summary.failedCases} 个 case 执行失败（上限 ${thresholds.allowFailedCases}）`);
  }

  const o = summary.overall;
  if (o.recall !== undefined && o.recall < thresholds.minRecall) {
    reasons.push(
      `Recall ${o.recall.toFixed(3)} < ${thresholds.minRecall}`,
    );
  }
  if (o.judgeScore !== undefined && o.judgeScore < thresholds.minJudgeScore) {
    reasons.push(
      `judge 总分 ${o.judgeScore.toFixed(1)} < ${thresholds.minJudgeScore}`,
    );
  }
  if (o.intentCorrect !== undefined && o.intentCorrect < thresholds.minIntentCorrect) {
    reasons.push(
      `意图准确率 ${o.intentCorrect.toFixed(3)} < ${thresholds.minIntentCorrect}`,
    );
  }
  return reasons;
}
