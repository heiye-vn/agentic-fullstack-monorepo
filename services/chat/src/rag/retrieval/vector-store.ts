/**
 * vector-store.ts
 *
 * 第十一章 11.5 — 向量数据库仓储层与最近邻检索实现
 *
 * 核心设计：
 * - 纯仓储层封装：解耦业务服务，通过 prisma.$queryRaw 执行原生 pgvector 向量计算
 * - 零 pgvector 外部客户端依赖：仅依赖 SQL 扩展与 Prisma 原始查询
 * - 严格维度防御：入库与检索阶段强制校验向量维度一致性，维度不匹配时抛出 RangeError
 * - 提供精确 KNN 内存实现 (bruteForceKnn) 作为算法 baseline，用于单元测试与小规模验证
 */

import { cosineSimilarity } from '../embedding/similarity.js';

export interface VectorStoreRecord {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  embedding: number[];
  modelName: string;
}

export interface SearchResult {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  score: number;
}

export interface SimilaritySearchOptions {
  topK?: number;
  /** 权限过滤：只检索该用户的文档片段（11.8.5 元数据过滤） */
  userId?: string;
  /** 期望的向量维度，默认 384；与库内不一致直接抛错 */
  expectedDimension?: number;
  /**
   * 期望的 Embedding 模型名（教程 11.3.7 / 11.12 FAQ Q4）
   *
   * 传了就先抽样校验库内 modelName 是否一致。
   * 换模型必须全量重算 + 重建索引，绝不能"老数据不动、新数据用新模型"——
   * 否则现象只是"召回变差"，排查成本极高，所以这里选择直接抛错而不是静默放行。
   */
  expectedModelName?: string;
}

export const DEFAULT_VECTOR_DIMENSION = 384;

/**
 * 校验向量维度，不符合期望时抛出 RangeError
 */
function assertVectorDimension(vector: number[], expectedDim: number): void {
  if (!Array.isArray(vector) || vector.length === 0 || vector.length !== expectedDim) {
    throw new RangeError(
      `向量维度不匹配: 期望 ${expectedDim} 维，实际得到 ${vector?.length ?? 0} 维`,
    );
  }
}

/**
 * 批量 upsert 切片向量数据到 document_chunks
 * 纯 SQL 参数化操作，无需外部 pgvector 客户端支持
 */
export async function upsertChunks(
  prisma: any,
  records: VectorStoreRecord[],
): Promise<void> {
  if (!records || records.length === 0) {
    return;
  }

  for (const record of records) {
    if (!Array.isArray(record.embedding) || record.embedding.length === 0) {
      throw new RangeError('向量维度不匹配: embedding 不能为空');
    }

    const vectorLiteral = `[${record.embedding.join(',')}]`;

    await prisma.$queryRaw`
      INSERT INTO document_chunks ("id", "documentId", "content", "chunkIndex", "embedding", "modelName")
      VALUES (
        ${record.id},
        ${record.documentId},
        ${record.content},
        ${record.chunkIndex},
        ${vectorLiteral}::vector,
        ${record.modelName}
      )
      ON CONFLICT ("id") DO UPDATE SET
        "documentId" = EXCLUDED."documentId",
        "content" = EXCLUDED."content",
        "chunkIndex" = EXCLUDED."chunkIndex",
        "embedding" = EXCLUDED."embedding",
        "modelName" = EXCLUDED."modelName";
    `;
  }
}

/**
 * pgvector 余弦相似度检索
 *
 * 公式：score = 1 - (embedding <=> queryVector)
 * 注意：必须检查 queryVector 长度与库中维度一致，否则抛出 RangeError
 */
export async function similaritySearch(
  prisma: any,
  queryVector: number[],
  options: SimilaritySearchOptions = {},
): Promise<SearchResult[]> {
  const expectedDim = options.expectedDimension ?? DEFAULT_VECTOR_DIMENSION;
  assertVectorDimension(queryVector, expectedDim);

  const topK = Math.max(1, options.topK ?? 4);
  const vectorLiteral = `[${queryVector.join(',')}]`;

  // 11.3.7 模型一致性防呆：入库模型与查询模型必须同一个
  if (options.expectedModelName) {
    const modelRows = (await prisma.$queryRaw`
      SELECT DISTINCT "modelName" AS m
      FROM document_chunks
      WHERE "modelName" IS NOT NULL
      LIMIT 8
    `) as Array<{ m: string | null }>;

    const mismatched = modelRows.find((r) => r.m !== options.expectedModelName);
    if (mismatched) {
      throw new Error(
        `Embedding model mismatch: index has '${mismatched.m}' but query uses '${options.expectedModelName}'`,
      );
    }
  }

  let rows: Array<{
    id?: string;
    chunkId?: string;
    documentId: string;
    content: string;
    chunkIndex: number;
    score: number | string;
  }> = [];

  if (options.userId) {
    rows = await prisma.$queryRaw`
      SELECT 
        dc.id,
        dc."documentId",
        dc.content,
        dc."chunkIndex",
        (1 - (dc.embedding <=> ${vectorLiteral}::vector)) AS score
      FROM document_chunks dc
      JOIN documents d ON dc."documentId" = d.id
      WHERE d."userId" = ${options.userId} AND dc.embedding IS NOT NULL
      ORDER BY dc.embedding <=> ${vectorLiteral}::vector ASC
      LIMIT ${topK}
    `;
  } else {
    rows = await prisma.$queryRaw`
      SELECT 
        dc.id,
        dc."documentId",
        dc.content,
        dc."chunkIndex",
        (1 - (dc.embedding <=> ${vectorLiteral}::vector)) AS score
      FROM document_chunks dc
      WHERE dc.embedding IS NOT NULL
      ORDER BY dc.embedding <=> ${vectorLiteral}::vector ASC
      LIMIT ${topK}
    `;
  }

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((row) => ({
    chunkId: row.chunkId ?? row.id ?? '',
    documentId: row.documentId,
    chunkIndex: Number(row.chunkIndex ?? 0),
    content: row.content,
    score: Number(Number(row.score).toFixed(4)),
  }));
}

/**
 * 内存暴力 KNN（精确最近邻）实现
 * 作为 O(n) 基准 baseline，用于验证小规模数据集上的 ANN 召回与排序一致性
 */
export function bruteForceKnn(
  queryVector: number[],
  records: VectorStoreRecord[],
  topK: number = 5,
): SearchResult[] {
  if (!Array.isArray(queryVector) || queryVector.length === 0) {
    throw new RangeError('向量维度不匹配');
  }

  if (!records || records.length === 0) {
    return [];
  }

  const scoredResults: SearchResult[] = [];

  for (const record of records) {
    if (!Array.isArray(record.embedding) || record.embedding.length !== queryVector.length) {
      throw new RangeError('向量维度不匹配');
    }

    const score = cosineSimilarity(queryVector, record.embedding);
    scoredResults.push({
      chunkId: record.id,
      documentId: record.documentId,
      chunkIndex: record.chunkIndex,
      content: record.content,
      score,
    });
  }

  // 相似度从高到低排序
  scoredResults.sort((a, b) => b.score - a.score);

  return scoredResults.slice(0, Math.max(1, topK));
}
