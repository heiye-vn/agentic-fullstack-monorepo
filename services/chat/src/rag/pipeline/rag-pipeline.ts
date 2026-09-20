/**
 * services/chat/rag/pipeline/rag-pipeline.ts
 *
 * 第十一章 11.6 — RAG 基础端到端流水线
 * 包含 Prompt 组装、零检索防幻觉回退、LLM 生成与引用来源提取
 */

import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { SearchResult, VectorStoreRecord } from '../retrieval/vector-store.js';

/**
 * RAG 流水线对大模型的最小抽象
 *
 * 只要求一个 invoke，方便 11.9 的 HyDE / Adaptive-RAG 复用，
 * 也让单测可以用 `{ invoke: async () => ({ content: '...' }) }` 直接 mock。
 */
export interface RagLlm {
  invoke: (messages: Array<{ role: string; content: string }>) => Promise<any>;
}

export const RAG_DEFAULT_SYSTEM_PROMPT = `你是一个基于知识库的问答助手。请严格根据[上下文]回答用户问题。

规则：
- 只用上下文中的信息回答，不要凭借常识或推测
- 如果上下文不足以回答，明确说"根据提供的资料，我无法确定..."
- 每句结论后用 [chunkId: xxx] 标注引用来源
- 简洁清晰，最多 5 段`;

export const RAG_NO_CONTEXT_FALLBACK = '根据提供的资料，我无法确定该问题的答案。';

export interface RagAskInput {
  question: string;
  userId?: string;
  topK?: number;
  model: any;
  searchFn?: (question: string, topK: number) => Promise<SearchResult[]>;
  systemPrompt?: string;
}

export interface RagAskOutput {
  answer: string;
  citations: Array<{
    chunkId: string;
    documentId: string;
    score: number;
  }>;
  retrievedChunks: SearchResult[] | VectorStoreRecord[];
}

/**
 * RAG 核心问答流程
 *
 * 1. 执行检索（默认通过 searchFn 注入或底层向量检索）
 * 2. 零检索结果时触发防幻觉安全回退（不调用 LLM）
 * 3. 组装上下文 Prompt 并请求大模型
 * 4. 提取回答与引用来源
 */
export async function ragAsk(input: RagAskInput): Promise<RagAskOutput> {
  const {
    question,
    topK = 5,
    model,
    searchFn,
    systemPrompt = RAG_DEFAULT_SYSTEM_PROMPT,
  } = input;

  // Step 1: 检索相关切片
  const chunks: SearchResult[] = searchFn ? await searchFn(question, topK) : [];

  // Step 2: 零检索结果防幻觉回退
  if (!chunks || chunks.length === 0) {
    return {
      answer: RAG_NO_CONTEXT_FALLBACK,
      citations: [],
      retrievedChunks: [],
    };
  }

  // Step 3: 拼接 Prompt 上下文
  const contextBlock = chunks
    .map((c) => {
      const scoreStr =
        typeof c.score === 'number' ? c.score.toFixed(2) : String(c.score);
      // 引用格式必须与 system prompt 里的 [chunkId: xxx] 完全一致，
      // 否则模型学不到格式、引用回写会失败（教程 11.6.2 / 11.6.3）
      return `[chunkId: ${c.chunkId}, 来源: ${c.documentId}, 相关性: ${scoreStr}]\n${c.content}`;
    })
    .join('\n\n---\n\n');

  const userMessage = `[上下文]\n${contextBlock}\n\n[用户问题]\n${question}`;

  // Step 4: 调用 LLM 生成回答
  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(userMessage),
  ]);

  const rawContent =
    typeof response === 'string' ? response : (response?.content ?? '');

  return {
    answer: String(rawContent),
    citations: chunks.map((c) => ({
      chunkId: c.chunkId,
      documentId: c.documentId,
      score: c.score,
    })),
    retrievedChunks: chunks,
  };
}
