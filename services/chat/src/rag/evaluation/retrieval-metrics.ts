/**
 * services/chat/rag/evaluation/retrieval-metrics.ts
 *
 * 检索质量离线评估指标实现（纯数学函数，零外部依赖）
 * 对应教程 11.7.1 节：Recall@K / MRR / NDCG@K
 */

/**
 * 计算 Recall@K（召回率）
 * 前 K 个检索结果中，找到的真实相关文档占所有相关文档的比例。
 *
 * 公式：
 *   Recall@K = (Top-K 中相关文档数) / (知识库中所有相关文档数)
 *
 * @param retrievedIds 检索返回的文档/切片 ID 列表
 * @param relevantIds 标注为真实相关的文档/切片 ID 列表
 * @param k 截断排名阈值
 * @returns 召回率分数 (0 ~ 1)
 */
export function recallAtK(
  retrievedIds: string[],
  relevantIds: string[],
  k: number,
): number {
  if (k <= 0 || !retrievedIds || !relevantIds || relevantIds.length === 0) {
    return 0;
  }

  const relevantSet = new Set(relevantIds);
  const topK = retrievedIds.slice(0, k);
  const hitCount = new Set(topK.filter((id) => relevantSet.has(id))).size;

  return hitCount / relevantSet.size;
}

/**
 * 计算 Precision@K（精确率）
 * 前 K 个检索结果中，真实相关文档占返回结果的比例。
 *
 * 与 Recall@K 的唯一区别在**分母**：
 *   Recall@K    = (Top-K 中相关文档数) / (标注的相关文档总数)  —— 度量「漏没漏」
 *   Precision@K = (Top-K 中相关文档数) / (实际返回的文档数)    —— 度量「准不准」
 *
 * 两者不可互相替代：topK 调大会推高 Recall 但压低 Precision，
 * 只看 Recall 会得出「topK 越大越好」的错误结论（第十七章 17.3.2）。
 *
 * ⚠️ 边界：当 Top-K 实际返回为空（检索没召回任何东西）时返回 0，
 * 而不是 NaN —— 后者会让聚合均值整体变成 NaN 并静默穿透门禁。
 *
 * @param retrievedIds 检索返回的文档/切片 ID 列表
 * @param relevantIds 标注为真实相关的文档/切片 ID 列表
 * @param k 截断排名阈值
 * @returns 精确率分数 (0 ~ 1)
 */
export function precisionAtK(
  retrievedIds: string[],
  relevantIds: string[],
  k: number,
): number {
  if (k <= 0 || !retrievedIds) {
    return 0;
  }

  const topK = retrievedIds.slice(0, k);
  if (topK.length === 0) {
    return 0;
  }

  const relevantSet = new Set(relevantIds || []);
  if (relevantSet.size === 0) {
    return 0;
  }

  const hitCount = new Set(topK.filter((id) => relevantSet.has(id))).size;

  return hitCount / topK.length;
}

/**
 * 计算单个 Query 的 Reciprocal Rank（倒数排名）
 * 第一个相关结果所处排名的倒数；未命中则为 0。
 *
 * MRR 的定义就是「所有 Query 的 RR 之均值」（见下方 mrr 函数），
 * 本函数把它拆出来，是为了让「逐 case 出报告」的评测 runner 能先把每个
 * case 的 RR 存进 CaseMetrics，再由 aggregate 统一汇总 —— 否则 MRR 只能
 * 在全量跑完后一次性计算，无法按 tag 分桶。
 *
 * @param retrievedIds 检索返回的文档/切片 ID 列表
 * @param relevantIds 标注为真实相关的文档/切片 ID 列表
 * @returns 倒数排名 (0 ~ 1)
 */
export function reciprocalRank(
  retrievedIds: string[],
  relevantIds: string[],
): number {
  if (!retrievedIds || retrievedIds.length === 0) {
    return 0;
  }

  const relevantSet = new Set(relevantIds || []);
  if (relevantSet.size === 0) {
    return 0;
  }

  for (let i = 0; i < retrievedIds.length; i++) {
    if (relevantSet.has(retrievedIds[i])) {
      return 1 / (i + 1);
    }
  }

  return 0;
}

/**
 * 计算 MRR（Mean Reciprocal Rank，平均倒数排名）
 * 第一个相关结果的排名的倒数，对所有查询取平均。
 *
 * 公式：
 *   MRR = (1 / |Q|) * sum_{q in Q} (1 / rank_q^{first relevant})
 *
 * @param rankedListsPerQuery 每个 Query 检索返回的排序列表二维数组
 * @param relevantPerQuery 每个 Query 真实相关的目标 ID 二维数组
 * @returns 平均倒数排名 (0 ~ 1)
 */
export function mrr(
  rankedListsPerQuery: string[][],
  relevantPerQuery: string[][],
): number {
  if (!rankedListsPerQuery || rankedListsPerQuery.length === 0) {
    return 0;
  }

  let reciprocalRankSum = 0;

  for (let i = 0; i < rankedListsPerQuery.length; i++) {
    const retrieved = rankedListsPerQuery[i] || [];
    const relevantSet = new Set(relevantPerQuery[i] || []);

    if (relevantSet.size === 0) {
      continue;
    }

    let firstRank = 0;
    for (let j = 0; j < retrieved.length; j++) {
      if (relevantSet.has(retrieved[j])) {
        firstRank = j + 1;
        break;
      }
    }

    if (firstRank > 0) {
      reciprocalRankSum += 1 / firstRank;
    }
  }

  return reciprocalRankSum / rankedListsPerQuery.length;
}

/**
 * 计算 NDCG@K（Normalized Discounted Cumulative Gain，归一化折损累积增益）
 * 综合评估检索结果的相关性与排名先后，位置越靠前衰减权重越小。
 *
 * 公式：
 *   DCG@K = sum_{i=1}^{K} (rel_i / log2(i + 1))
 *   NDCG@K = DCG@K / IDCG@K
 *
 * @param retrievedIds 检索返回的文档/切片 ID 列表
 * @param relevantIds 标注为真实相关的文档/切片 ID 列表（二元相关度：命中=1，未命中=0）
 * @param k 截断排名阈值
 * @returns 归一化折损累积增益分数 (0 ~ 1)
 */
export function ndcgAtK(
  retrievedIds: string[],
  relevantIds: string[],
  k: number,
): number {
  if (k <= 0 || !retrievedIds || !relevantIds || relevantIds.length === 0) {
    return 0;
  }

  const relevantSet = new Set(relevantIds);
  const topK = retrievedIds.slice(0, k);

  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    if (relevantSet.has(topK[i])) {
      // 0-indexed 下标 i 对应的 rank 为 i + 1，公式中分母为 log2(rank + 1) 即 log2(i + 2)
      dcg += 1 / Math.log2(i + 2);
    }
  }

  // 理想最优排序：所有真实相关文档均紧凑排在最前列
  const idealCount = Math.min(k, relevantSet.size);
  if (idealCount === 0) {
    return 0;
  }

  let idcg = 0;
  for (let i = 0; i < idealCount; i++) {
    idcg += 1 / Math.log2(i + 2);
  }

  return idcg > 0 ? dcg / idcg : 0;
}
