import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmbeddingService } from './embedding.service.js';

export interface SearchResultItem {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  score: number;
  filename?: string;
}

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
}
