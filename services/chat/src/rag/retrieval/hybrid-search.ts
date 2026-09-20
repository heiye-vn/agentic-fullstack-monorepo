/**
 * services/chat/rag/retrieval/hybrid-search.ts
 *
 * 第十一章 11.8.3 — 混合检索（向量 + BM25 + RRF 融合）
 *
 * 为什么必须混合（教程 11.8.3）：
 *   向量检索擅长"语义模糊匹配"，但对"完全相同的关键词"反而不一定敏感。
 *   例如查询"如何用 OAuth2 配置 SSO"，文档《OAuth2 协议详细说明》里没有
 *   "配置 SSO"这个表达，向量距离未必近；但关键词检索"OAuth2"能精确命中。
 *   两路互补，Recall@5 通常能比纯向量提升 10–20%。
 *
 * 为什么用 RRF 而不是加权求和（教程 11.8.3.1）：
 *   向量相似度在 0–1，BM25 分数可以到几十，量纲完全不同，归一化容易出问题。
 *   RRF 只看排名不看分数：RRF(d) = Σ 1 / (k + rank_r(d))，k=60 是 Cormack(2009)
 *   论文的经验值——k 太小头部权重过大，k 太大区分度太低。
 */

import type { SearchResult } from './vector-store.js';

export type RetrieveFn = (query: string) => Promise<SearchResult[]>;

export interface HybridSearchOptions {
  topK?: number;
  /** RRF 常数 k，论文经验值 60 */
  rrfK?: number;
  /** 初筛召回放大倍数：先各取 topK × N，融合后再截 topK */
  recallMultiplier?: number;
}

/**
 * 11.8.3.1 RRF 融合：给定 N 个排名列表，按 Σ 1/(k + rank) 求和。
 * 不归一化分数，避免不同算法量纲互相打架。
 *
 * @param rankedLists 若干个按相关性降序排列的 id 列表
 * @param rrfK RRF 常数
 * @returns id → 融合分
 */
export function rrfFuse(
  rankedLists: Array<Array<{ id: string }>>,
  rrfK = 60,
): Map<string, number> {
  const scoreMap = new Map<string, number>();
  for (const list of rankedLists) {
    for (let i = 0; i < list.length; i++) {
      const id = list[i].id;
      const rank = i + 1;
      scoreMap.set(id, (scoreMap.get(id) ?? 0) + 1 / (rrfK + rank));
    }
  }
  return scoreMap;
}

/**
 * RRF 融合后的排序结果（供单测与调用方直接使用）
 *
 * @returns 按融合分降序排列的 { id, score }
 */
export function rrfRanked(
  rankedLists: Array<Array<{ id: string }>>,
  rrfK = 60,
): Array<{ id: string; score: number }> {
  return [...rrfFuse(rankedLists, rrfK).entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * 混合检索：向量 + BM25 双路并行 → RRF 融合 → 去重 → Top-K
 *
 * 两路检索都抽象成函数指针注入，因此：
 *   - 生产可以接 pgvector + Postgres FTS（ts_rank_cd）
 *   - 单测可以直接塞两个 mock 数组
 *
 * @param query 用户问题
 * @param vectorSearch 向量检索实现
 * @param bm25Search 关键词检索实现
 * @param options topK / rrfK / 召回放大倍数
 */
export async function hybridSearch(
  query: string,
  vectorSearch: RetrieveFn,
  bm25Search: RetrieveFn,
  options: HybridSearchOptions = {},
): Promise<SearchResult[]> {
  const { topK = 5, rrfK = 60, recallMultiplier = 4 } = options;
  const wideK = topK * recallMultiplier;

  // 1. 并行跑两路检索（先各召回 topK×N，给融合留足候选）
  const [vec, bm25] = await Promise.all([
    vectorSearch(query),
    bm25Search(query),
  ]);

  const vecTop = vec.slice(0, wideK);
  const bmTop = bm25.slice(0, wideK);

  // 2. RRF 融合（只看排名）
  const scoreMap = rrfFuse(
    [
      vecTop.map((r) => ({ id: r.chunkId })),
      bmTop.map((r) => ({ id: r.chunkId })),
    ],
    rrfK,
  );

  // 3. 去重（保留首次出现的完整记录）+ 按融合分排序 + 截断
  const merged = new Map<string, SearchResult>();
  for (const r of [...vecTop, ...bmTop]) {
    if (!merged.has(r.chunkId)) merged.set(r.chunkId, r);
  }

  return [...merged.values()]
    .map((r) => ({ ...r, score: scoreMap.get(r.chunkId) ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/* ------------------------------------------------------------------ *
 * 11.8.3.1 BM25 参考实现
 *
 * 说明：生产环境优先用 Postgres FTS（tsvector + ts_rank_cd）或 Elasticsearch，
 * 它们对中文分词、停用词、词干化的处理远比下面这段强。
 * 这里保留一份纯函数实现，目的是让教程里的 BM25 公式可被单测验证：
 *   BM25(q,d) = Σ IDF(t) · f(t,d)·(k1+1) / ( f(t,d) + k1·(1 - b + b·|d|/avgdl) )
 * ------------------------------------------------------------------ */

export interface Bm25Options {
  /** 词频饱和参数，典型值 1.2–2.0 */
  k1?: number;
  /** 长度归一化强度，典型值 0.75 */
  b?: number;
}

/**
 * 极简中英混合分词
 *
 * - 拉丁字母/数字序列 → 整体作为一个词（OAuth2、SSO）
 * - CJK 字符 → 单字 + 相邻二字词（bigram），弥补没有词典的缺陷
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const tokens: string[] = [];

  const latin = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  tokens.push(...latin);

  const cjkRuns = text.match(/[\u4e00-\u9fa5]+/g) ?? [];
  for (const run of cjkRuns) {
    for (let i = 0; i < run.length; i++) {
      tokens.push(run[i]);
      if (i + 1 < run.length) tokens.push(run.slice(i, i + 2));
    }
  }

  return tokens;
}

/**
 * 对一组文档计算 BM25 打分并降序返回
 *
 * @param query 查询串
 * @param documents 待打分文档（每个元素需带 id 与 content）
 * @param options k1 / b
 * @returns 按 BM25 分数降序的 { id, score }，零命中项会被过滤
 */
export function bm25Search<T extends { id: string; content: string }>(
  query: string,
  documents: T[],
  options: Bm25Options = {},
): Array<{ id: string; score: number }> {
  const { k1 = 1.5, b = 0.75 } = options;
  if (documents.length === 0) return [];

  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0) return [];

  const docs = documents.map((d) => ({ id: d.id, tf: new Map<string, number>(), len: 0 }));

  for (let i = 0; i < documents.length; i++) {
    const tokens = tokenize(documents[i].content);
    docs[i].len = tokens.length;
    for (const t of tokens) {
      docs[i].tf.set(t, (docs[i].tf.get(t) ?? 0) + 1);
    }
  }

  const avgdl =
    docs.reduce((sum, d) => sum + d.len, 0) / Math.max(1, docs.length);

  const scored: Array<{ id: string; score: number }> = [];

  for (let i = 0; i < docs.length; i++) {
    let score = 0;
    for (const term of queryTerms) {
      const f = docs[i].tf.get(term) ?? 0;
      if (f === 0) continue;

      // IDF：语料越小越容易退化，+1 平滑避免负数与除零
      const df = docs.filter((d) => (d.tf.get(term) ?? 0) > 0).length;
      const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));

      // 词频饱和 + 长度归一化
      const norm = 1 - b + (b * docs[i].len) / (avgdl || 1);
      score += (idf * (f * (k1 + 1))) / (f + k1 * norm);
    }
    if (score > 0) scored.push({ id: docs[i].id, score });
  }

  return scored.sort((a, b) => b.score - a.score);
}
