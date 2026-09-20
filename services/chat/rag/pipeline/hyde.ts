/**
 * services/chat/rag/pipeline/hyde.ts
 *
 * 第十一章 11.9.1 — HyDE（Hypothetical Document Embeddings，假设性文档嵌入）
 *
 * 核心思路：让 LLM 先"幻想"一段答案，再用这段幻想答案（而不是原始问题）去检索。
 *
 * 为什么有效：
 *   问题（"企业版每月最多建多少项目"）是疑问句式，用词和结构与知识库里的
 *   陈述句文档（"企业版单工作区最多 200 个项目"）差异很大，两者在向量空间里
 *   未必接近。而幻想出来的答案哪怕事实有误，它的**用词、句式、长度**都更接近
 *   真实文档，因此在向量空间里离真实文档更近。
 *
 * 代价与适用边界（教程 11.9.1 "什么时候用 vs 不用"）：
 *   - 每次查询多一次 LLM 调用，延迟与成本上升
 *   - 零样本 / 短查询 / 开放域场景收益明显（BEIR、TREC 上 Recall@10 +10–15%）
 *   - 精确实体检索（型号、错误码、人名）反而可能变差，应关闭
 */

import type { SearchResult } from '../retrieval/vector-store.js';
import type { RagLlm } from './rag-pipeline.js';

export interface HydeOptions {
  topK?: number;
  /** 自定义"幻想答案"的 system prompt */
  systemPrompt?: string;
}

export const HYDE_SYSTEM_PROMPT =
  '请用一段简短的事实陈述回答下面的问题。如果不知道，也编一个看起来合理的答案。50-150 字。';

export interface HydeResult {
  /** LLM 幻想出的假设性答案，可回传给调用方做日志 / 可观测 */
  hypothetical: string;
  /** 用幻想答案检索到的结果 */
  results: SearchResult[];
  /** 本次实际用于检索的查询串：幻想为空时退化为原始问题 */
  usedQuery: string;
}

/**
 * HyDE 检索
 *
 * @param model 具备 invoke 的模型
 * @param searchFn 检索函数（通常是向量检索或混合检索）
 * @param question 用户原始问题
 * @param options topK 与自定义 prompt
 */
export async function hydeSearch(
  model: RagLlm,
  searchFn: (query: string, topK: number) => Promise<SearchResult[]>,
  question: string,
  options: HydeOptions = {},
): Promise<HydeResult> {
  const { topK = 5, systemPrompt = HYDE_SYSTEM_PROMPT } = options;

  const resp = await model.invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: question },
  ]);

  const hypothetical =
    typeof resp === 'string' ? resp : String((resp as any)?.content ?? '');

  // 幻想为空（模型拒答 / 限流返回空）时退化为原问题，保证链路不断
  const queryForSearch = hypothetical.trim() === '' ? question : hypothetical;

  const results = await searchFn(queryForSearch, topK);

  return { hypothetical, results, usedQuery: queryForSearch };
}
