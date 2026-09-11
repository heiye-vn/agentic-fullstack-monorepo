import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchService } from '../src/document/search.service.js';
import { BadRequestException } from '@nestjs/common';

describe('SearchService Unit Tests', () => {
  let searchService: SearchService;
  let mockPrisma: any;
  let mockEmbeddingService: any;

  beforeEach(() => {
    mockPrisma = {
      $queryRawUnsafe: vi.fn(),
    };

    mockEmbeddingService = {
      embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    };

    searchService = new SearchService(
      mockPrisma as any,
      mockEmbeddingService as any,
    );
  });

  it('query 为空字符串时应该直接返回空数组', async () => {
    const res = await searchService.similaritySearch('', 'user_1');
    expect(res).toEqual([]);
    expect(mockEmbeddingService.embedText).not.toHaveBeenCalled();
  });

  it('userId 为空时应该抛出 BadRequestException', async () => {
    await expect(
      searchService.similaritySearch('测试关键词', ''),
    ).rejects.toThrow(BadRequestException);
  });

  it('应正确调用向量化与 pgvector SQL 并按余弦相似度返回格式化结果', async () => {
    const mockRows = [
      {
        id: 'chunk_1',
        documentId: 'doc_1',
        content: '这是匹配的第一条切片内容',
        chunkIndex: 0,
        score: 0.91234,
        filename: 'requirement.md',
      },
      {
        id: 'chunk_2',
        documentId: 'doc_1',
        content: '这是匹配的第二条切片内容',
        chunkIndex: 1,
        score: '0.8500',
        filename: 'requirement.md',
      },
    ];

    mockPrisma.$queryRawUnsafe.mockResolvedValue(mockRows);

    const res = await searchService.similaritySearch('权限控制', 'user_1', 2);

    expect(mockEmbeddingService.embedText).toHaveBeenCalledWith('权限控制');
    expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);

    // 验证 SQL 中是否使用了 <=> 余弦距离并传入了 userId 进行数据隔离
    const [sqlQuery, vectorLiteral, queriedUserId, limit] =
      mockPrisma.$queryRawUnsafe.mock.calls[0];

    expect(sqlQuery).toContain('embedding <=> $1::vector');
    expect(sqlQuery).toContain('d."userId" = $2');
    expect(vectorLiteral).toBe('[0.1,0.2,0.3]');
    expect(queriedUserId).toBe('user_1');
    expect(limit).toBe(2);

    expect(res).toHaveLength(2);
    expect(res[0]).toEqual({
      id: 'chunk_1',
      documentId: 'doc_1',
      content: '这是匹配的第一条切片内容',
      chunkIndex: 0,
      score: 0.9123,
      filename: 'requirement.md',
    });
    expect(res[1].score).toBe(0.85);
  });
});
