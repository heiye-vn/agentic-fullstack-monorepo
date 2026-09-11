import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChunkService } from '../src/document/chunk.service.js';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

describe('ChunkService Unit Tests', () => {
  let chunkService: ChunkService;
  let mockPrisma: any;
  let mockEmbeddingService: any;
  let mockParserFactory: any;

  beforeEach(() => {
    mockPrisma = {
      document: {
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
      documentChunk: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'chunk_1', ...data })),
      },
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    };

    mockEmbeddingService = {
      embedDocuments: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    };

    mockParserFactory = {
      extractText: vi.fn().mockResolvedValue('这是测试解析出的文档文本'),
    };

    const mockSseService = {
      emit: vi.fn().mockResolvedValue({}),
    };

    chunkService = new ChunkService(
      mockPrisma as any,
      mockEmbeddingService as any,
      mockParserFactory as any,
      mockSseService as any,
    );
  });

  describe('splitText', () => {
    it('空文本应该返回空切片数组', async () => {
      const chunks = await chunkService.splitText('');
      expect(chunks).toEqual([]);
    });

    it('超长文本应该被递归分块拆分为多个 chunk', async () => {
      // 构造超过 500 字符的长段落
      const paragraph = 'LangChain 文本分割器是 RAG 流程的关键组件。'.repeat(30);
      const chunks = await chunkService.splitText(paragraph);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(500);
      }
    });
  });

  describe('processDocument', () => {
    it('文档不存在时应该抛出 NotFoundException', async () => {
      mockPrisma.document.findUnique.mockResolvedValue(null);

      await expect(
        chunkService.processDocument('non_existent_id', 'user_1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('无权访问他人文档时应该抛出 ForbiddenException', async () => {
      mockPrisma.document.findUnique.mockResolvedValue({
        id: 'doc_1',
        userId: 'user_other',
      });

      await expect(
        chunkService.processDocument('doc_1', 'user_1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
