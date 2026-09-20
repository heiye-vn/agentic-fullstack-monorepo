/**
 * services/chat/rag/retrieval/vector-search-fn.ts
 *
 * 把"Embedding 服务 + pgvector 仓储"封装成 ragAsk / createRagTool 需要的 searchFn
 *
 * 存在意义：
 *   rag/ 下的模块全部是纯函数（依赖注入、可单测、不碰 Nest DI），
 *   而真实检索需要 Prisma 与 EmbeddingService 这两个 Nest 托管对象。
 *   本文件是两者之间唯一的适配层，让 src/ 侧不必手写 SQL 和向量调用。
 */

import { similaritySearch, type SearchResult } from './vector-store.js';

export interface VectorSearchFnDeps {
  /** PrismaClient，只需具备 $queryRaw */
  prisma: any;
  /** 把查询文本变成向量的函数（EmbeddingService.embedQuery） */
  embedQuery: (text: string) => Promise<number[]>;
  /** 权限过滤：只检索该用户文档下的 chunk（11.8.5） */
  userId: string;
  /**
   * 当前使用的 Embedding 模型名（EmbeddingService.getModelName()）
   * 传给 similaritySearch 做 11.3.7 一致性校验，防止换模型后静默返回噪音
   */
  modelName: string;
  /** 默认返回条数 */
  defaultTopK?: number;
}

export type VectorSearchFn = (
  query: string,
  topK?: number,
) => Promise<SearchResult[]>;

/**
 * 构造真实的向量检索函数
 *
 * 流程：query → embedQuery → similaritySearch(pgvector 余弦)
 * 任何异常都向上抛出，由调用方（RAG Tool）统一兜底，
 * 不在这一层吞掉错误——静默返回空数组会让"检索失败"伪装成"知识库里没有"。
 */
export function createVectorSearchFn(deps: VectorSearchFnDeps): VectorSearchFn {
  const { prisma, embedQuery, userId, modelName, defaultTopK = 5 } = deps;

  return async (query: string, topK = defaultTopK) => {
    const vector = await embedQuery(query);

    return similaritySearch(prisma, vector, {
      topK,
      userId,
      expectedModelName: modelName,
    });
  };
}
