/**
 * services/chat/rag/retrieval/reranker.ts
 *
 * 第十一章 11.8.4 — 重排序 Re-ranking（Cross-Encoder 精排）
 *
 * 两阶段架构的必要性（教程 11.3.6 / 11.8.4）：
 *   阶段 1  Bi-Encoder 粗排：Query 与 Doc 各自独立编码，向量可预计算入库，
 *           百万级 chunk 也能 <100ms，但抓不到 token 级细粒度对齐。
 *   阶段 2  Cross-Encoder 精排：Q 与 D 拼接后一起进 Transformer，
 *           注意力让每个 Q token 直接看到每个 D token，精度显著高，
 *           但每对都要重新算，所以只能处理几十到几百个候选。
 *
 *   漏斗：100 万 chunk →(向量) Top-50 →(Cross-Encoder) Top-5 → LLM
 *   实测 Recall@5 可从 0.65 提升到 0.85+，是"几乎免费的午餐"。
 */

import type { SearchResult } from './vector-store.js';

/**
 * 重排器客户端接口
 *
 * 生产对接：BGE-reranker-large / BGE-reranker-v2-m3 / Cohere rerank-v3 / Jina Reranker
 * 测试：直接返回 (index, score) 的 mock 即可
 */
export interface RerankerClient {
  rerank(
    query: string,
    documents: string[],
  ): Promise<Array<{ index: number; score: number }>>;
}

/**
 * 用 Cross-Encoder 对粗排候选精排
 *
 * @param reranker 重排器客户端
 * @param query 用户问题
 * @param candidates 粗排候选（通常 20–100 条）
 * @param topK 精排后保留条数，默认 5
 * @returns 按重排分数降序的 SearchResult，score 被覆盖为 reranker 分数
 */
export async function rerankResults(
  reranker: RerankerClient,
  query: string,
  candidates: SearchResult[],
  topK = 5,
): Promise<SearchResult[]> {
  if (candidates.length === 0) return [];

  const documents = candidates.map((c) => c.content);
  const scored = await reranker.rerank(query, documents);

  return scored
    // 越界 index 直接丢弃：外部重排服务返回脏数据时不能把 undefined 塞进结果
    .filter((s) => s.index >= 0 && s.index < candidates.length)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => ({
      ...candidates[s.index],
      score: s.score,
    }));
}

/**
 * 把重排插进检索链路的便捷封装
 *
 * 典型用法（教程 11.8.6 的推荐组合）：
 *   const wide = await hybridSearch(q, vec, bm25, { topK: 50 });
 *   const top5 = await retrieveWithRerank(reranker, q, () => wide, 5);
 *
 * @param reranker 重排器
 * @param query 用户问题
 * @param retrieve 粗排函数（混合检索 / 纯向量检索均可）
 * @param topK 精排后条数
 */
export async function retrieveWithRerank(
  reranker: RerankerClient,
  query: string,
  retrieve: (query: string) => Promise<SearchResult[]>,
  topK = 5,
): Promise<SearchResult[]> {
  const candidates = await retrieve(query);
  return rerankResults(reranker, query, candidates, topK);
}
