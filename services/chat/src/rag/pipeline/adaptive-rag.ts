/**
 * services/chat/rag/pipeline/adaptive-rag.ts
 *
 * 第十一章 11.9.4 — Adaptive-RAG（按问题复杂度路由）
 *
 * 动机：不是每个问题都需要检索。
 *   - "你好" / "今天星期几" → 走 RAG 纯属浪费，还会把无关 chunk 塞进上下文干扰模型
 *   - "企业版项目上限是多少" → 标准单跳 RAG，一次检索就够
 *   - "对比企业版和专业版在 SSO、审计日志、API 限流上的差异" → 需要拆解成多个子问题分别检索
 *
 * 三条路径：
 *   simple     → 不检索，LLM 直接回答（闲聊 / 通用知识 / 时间查询）
 *   single_hop → 单次检索 + 生成（标准 RAG，最常见）
 *   multi_hop  → 拆解子问题 → 逐个检索 → 合并去重 → 一次生成（跨文档分析）
 *
 * 与第八九章的关系（教程 11.9.4）：
 *   第八章 triageNode（意图分类）、第九章 supervisorNode（专家选择）本质上都是前置路由器。
 *   Adaptive-RAG 把同一思路下沉到 RAG 内部——"是否检索 / 单跳还是多跳"
 *   成为 Agent 内部的一种受控决策，而不是无脑每次都检索。
 */

import type { SearchResult } from '../retrieval/vector-store.js';
import {
  ragAsk,
  RAG_NO_CONTEXT_FALLBACK,
  type RagLlm,
} from './rag-pipeline.js';

export type Complexity = 'simple' | 'single_hop' | 'multi_hop';

export interface ComplexityClassifier {
  classify(question: string): Promise<Complexity>;
}

export interface AdaptiveRagInput {
  question: string;
  classifier: ComplexityClassifier;
  searchFn: (query: string, topK: number) => Promise<SearchResult[]>;
  model: RagLlm;
  /** multi_hop 时用 LLM 把问题拆成多个子问题；不传则退化为整题单跳 */
  decomposeFn?: (question: string) => Promise<string[]>;
  topK?: number;
}

export interface AdaptiveRagOutput {
  /** 实际走的路径，便于日志与可观测（11.11.5） */
  path: Complexity;
  answer: string;
  retrieved: SearchResult[];
  /** 仅 multi_hop 有值 */
  subQueries?: string[];
}

/** mock 用：固定返回某一档复杂度 */
export function fixedClassifier(label: Complexity): ComplexityClassifier {
  return { classify: async () => label };
}

export async function adaptiveRagAsk(
  input: AdaptiveRagInput,
): Promise<AdaptiveRagOutput> {
  const { question, classifier, searchFn, model, decomposeFn, topK = 5 } =
    input;

  const path = await classifier.classify(question);

  // simple：不检索，直接问模型。省掉一次向量检索 + 避免无关 chunk 污染上下文
  if (path === 'simple') {
    const resp = await model.invoke([{ role: 'user', content: question }]);
    return {
      path,
      answer:
        typeof resp === 'string' ? resp : String((resp as any)?.content ?? ''),
      retrieved: [],
    };
  }

  // single_hop：标准 RAG
  if (path === 'single_hop') {
    const result = await ragAsk({ question, searchFn, model, topK });
    return {
      path,
      answer: result.answer,
      retrieved: result.retrievedChunks as SearchResult[],
    };
  }

  // multi_hop：拆解 → 逐个检索 → 按 chunkId 去重 → 一次生成
  const subQs = decomposeFn ? await decomposeFn(question) : [question];

  const allChunks: SearchResult[] = [];
  for (const sub of subQs) {
    const chunks = await searchFn(sub, topK);
    allChunks.push(...chunks);
  }

  // 同一 chunk 被多个子问题命中只保留一份，保留最高分
  const dedup = new Map<string, SearchResult>();
  for (const c of allChunks) {
    const existing = dedup.get(c.chunkId);
    if (!existing || c.score > existing.score) dedup.set(c.chunkId, c);
  }
  const merged = [...dedup.values()].sort((a, b) => b.score - a.score);

  if (merged.length === 0) {
    return {
      path,
      answer: RAG_NO_CONTEXT_FALLBACK,
      retrieved: [],
      subQueries: subQs,
    };
  }

  // 复用 ragAsk 的 Prompt 拼装，只是把 searchFn 换成"直接返回已合并结果"
  const result = await ragAsk({
    question,
    searchFn: async () => merged.slice(0, topK),
    model,
    topK,
  });

  return {
    path,
    answer: result.answer,
    retrieved: result.retrievedChunks as SearchResult[],
    subQueries: subQs,
  };
}
