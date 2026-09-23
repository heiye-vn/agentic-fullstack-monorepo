import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmbeddingService } from './embedding.service.js';
import {
  bm25Search,
  embeddingRerank,
  hybridSearch,
  type RetrievalResult,
} from './hybrid-retrieval.js';
import { loadLangChainConfig } from '../config/load-langchain-config.js';

export interface SearchResultItem {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  score: number;
  filename?: string;
}

/** BM25 关键词路一次性拉取的候选上限，避免在大语料上无界扫描。 */
const BM25_CORPUS_CAP = 500;

/**
 * 检索整体超时的默认值（毫秒），可被 langchain.yaml 的 retrieval.timeoutMs 覆盖。
 *
 * 第二十章 20.2 的承诺是「检索失败不炸主链路」，但 try/catch 只能挡住抛错，
 * 挡不住**挂起**：embedding 模型首次下载、pgvector 慢查询等场景下检索会长时间不返回，
 * 把整条 SSE 主链路一起堵死。硬超时让检索最多只能拖慢主链路 timeoutMs 毫秒。
 */
const DEFAULT_SEARCH_TIMEOUT_MS = 8000;

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  /**
   * 语义检索：将 query 向量化后通过 pgvector <=> 余弦距离检索最相似切片
   * 并通过 JOIN documents 严格进行 userId 用户数据隔离
   * @param query 检索输入词
   * @param userId 操作用户标识（多租户隔离）
   * @param topK 返回的最相似结果数，默认 4
   */
  async similaritySearch(
    query: string,
    userId: string,
    topK: number = 4,
  ): Promise<SearchResultItem[]> {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return [];
    }

    if (!userId) {
      throw new BadRequestException('用户标识不能为空');
    }

    const safeTopK = Math.max(1, Math.min(topK || 4, 100));

    // 1. 将 query 进行向量化，获得 384 维向量
    const queryVector = await this.embeddingService.embedText(query);
    if (!queryVector || queryVector.length === 0) {
      return [];
    }

    const vectorLiteral = `[${queryVector.join(',')}]`;

    try {
      // 2. pgvector <=> 计算余弦距离，按余弦距离升序（即相似度降序）排列，同时通过 d."userId" = $2 进行隔离
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{
          id: string;
          documentId: string;
          content: string;
          chunkIndex: number;
          score: number | string;
          filename: string;
        }>
      >(
        `SELECT 
           dc.id,
           dc."documentId",
           dc.content,
           dc."chunkIndex",
           (1 - (dc.embedding <=> $1::vector)) AS score,
           d.filename
         FROM document_chunks dc
         INNER JOIN documents d ON dc."documentId" = d.id
         WHERE d."userId" = $2 AND dc.embedding IS NOT NULL
         ORDER BY dc.embedding <=> $1::vector ASC
         LIMIT $3;`,
        vectorLiteral,
        userId,
        safeTopK,
      );

      return rows.map((row) => ({
        id: row.id,
        documentId: row.documentId,
        content: row.content,
        chunkIndex: row.chunkIndex,
        score: Number(Number(row.score).toFixed(4)),
        filename: row.filename,
      }));
    } catch (error) {
      this.logger.error(`执行 pgvector 语义检索失败 (userId: ${userId}):`, error);
      throw error;
    }
  }

  // ==========================================================================
  // 第二十章 20.2：主链路统一检索入口
  // ==========================================================================

  /**
   * 主链路统一检索入口。按 langchain.yaml 的 retrieval.mode 选策略：
   *   - hybrid（默认）：向量 + BM25 两路各召回 topK*3 → RRF 融合去重 → embedding 余弦重排到 topK。
   *     先保 Recall（少漏）再保 Precision（去噪），对应第十七章 17.3 的两步优化。
   *   - simple：退回纯向量 similaritySearch（向后兼容）。
   *
   * 本方法对调用方的承诺：**永不抛错、永不挂起** —— 最差也只是返回空数组，
   * 主链路以「无相关参考文档」继续。失败（异常）和挂起（超时）都由这里兜住。
   */
  async search(
    query: string,
    userId: string,
    topK: number = 4,
  ): Promise<SearchResultItem[]> {
    const cfg = loadLangChainConfig().retrieval;
    const timeoutMs = cfg?.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
    try {
      return await this.withTimeout(
        this.runSearch(query, userId, topK, cfg?.mode ?? 'hybrid'),
        timeoutMs,
        'RAG 检索',
      );
    } catch (err) {
      this.logger.warn(
        `检索失败/超时，降级为空上下文，主链路继续: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }

  /** search() 的内层实现：mode 路由 + hybrid 三段式。超时与兜底由 search() 统一包裹。 */
  private async runSearch(
    query: string,
    userId: string,
    topK: number,
    mode: 'simple' | 'hybrid',
  ): Promise<SearchResultItem[]> {
    if (mode !== 'hybrid') {
      return this.similaritySearch(query, userId, topK);
    }

    try {
      // wideK：两路都比最终需要的多召回 3 倍，给融合和精排留出去噪空间
      const wideK = topK * 3;
      const vectorPath = async () =>
        toRetrievalResults(await this.similaritySearch(query, userId, wideK));
      const bm25Path = async () =>
        bm25Search(query, await this.fetchUserChunks(userId), wideK);

      const candidates = await hybridSearch(query, vectorPath, bm25Path, wideK);
      if (candidates.length === 0) return [];

      const reranked = await embeddingRerank(
        query,
        candidates,
        (texts) => this.embeddingService.embedTexts(texts),
        topK,
      );
      return reranked.map((r) => ({
        id: r.chunkId,
        documentId: r.documentId,
        content: r.content,
        chunkIndex: r.chunkIndex,
        score: Number(r.score.toFixed(4)),
      }));
    } catch (err) {
      this.logger.warn(
        `hybrid 检索失败，降级纯向量: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return this.similaritySearch(query, userId, topK);
    }
  }

  /**
   * 给 Promise 套硬超时。
   *
   * 注意：超时只让本次检索快速失败降级，底层 embedding / DB 调用仍会在后台跑完
   * （transformers.js 与 pg 都支持真正取消，这里没有接入 AbortSignal 是为了保持最小改动），
   * 但它不再阻塞 SSE 主链路。
   */
  private withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    label: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}超时（>${ms}ms）`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  /**
   * BM25 关键词路的语料：取该 userId 下的 chunk 正文（纯 DB 读，不改 schema）。
   * 带上限是为了控制内存与单次请求耗时；超出部分由向量路兜住。
   */
  private async fetchUserChunks(userId: string): Promise<RetrievalResult[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        chunk_id: string;
        document_id: string;
        content: string;
        chunk_index: number;
      }>
    >(
      `SELECT
         dc.id           AS chunk_id,
         dc."documentId" AS document_id,
         dc.content      AS content,
         dc."chunkIndex" AS chunk_index
       FROM document_chunks dc
       INNER JOIN documents d ON dc."documentId" = d.id
       WHERE d."userId" = $1
       LIMIT $2;`,
      userId,
      BM25_CORPUS_CAP,
    );
    return rows.map((r) => ({
      chunkId: r.chunk_id,
      documentId: r.document_id,
      content: r.content,
      chunkIndex: r.chunk_index,
      score: 0,
    }));
  }
}

/** 把 similaritySearch 的结果形状适配成 hybrid-retrieval 的内部形状。 */
function toRetrievalResults(rows: SearchResultItem[]): RetrievalResult[] {
  return rows.map((r) => ({
    chunkId: r.id,
    documentId: r.documentId,
    content: r.content,
    chunkIndex: r.chunkIndex,
    score: r.score,
  }));
}
