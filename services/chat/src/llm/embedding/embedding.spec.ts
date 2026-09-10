import { describe, it, expect, beforeAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { EmbeddingService } from './embedding.service.js';
import { VectorStoreService } from './vector-store.service.js';
import { EmbeddingController } from './embedding.controller.js';
import { HttpException } from '@nestjs/common';

describe('Embedding & VectorStore Integration', () => {
  let moduleRef: TestingModule;
  let embeddingService: EmbeddingService;
  let vectorStoreService: VectorStoreService;
  let controller: EmbeddingController;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      controllers: [EmbeddingController],
      providers: [EmbeddingService, VectorStoreService],
    }).compile();

    embeddingService = moduleRef.get<EmbeddingService>(EmbeddingService);
    vectorStoreService = moduleRef.get<VectorStoreService>(VectorStoreService);
    controller = moduleRef.get<EmbeddingController>(EmbeddingController);

    // 手动触发生命周期初始化
    await embeddingService.onModuleInit();
    await vectorStoreService.onModuleInit();
  }, 60000);

  describe('EmbeddingService', () => {
    it('应该返回正确的模型名称', () => {
      expect(embeddingService.getModelName()).toBe(
        'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
      );
    });

    it('embedQuery 应该生成 384 维特征向量', async () => {
      const vector = await embeddingService.embedQuery('测试文本嵌入');
      expect(Array.isArray(vector)).toBe(true);
      expect(vector.length).toBe(384);
      expect(typeof vector[0]).toBe('number');
    });

    it('embedDocuments 应该批量生成特征向量', async () => {
      const docs = ['文本一', '文本二'];
      const vectors = await embeddingService.embedDocuments(docs);
      expect(Array.isArray(vectors)).toBe(true);
      expect(vectors.length).toBe(2);
      expect(vectors[0].length).toBe(384);
      expect(vectors[1].length).toBe(384);
    });

    it('对于空输入应返回空数组', async () => {
      expect(await embeddingService.embedQuery('')).toEqual([]);
      expect(await embeddingService.embedDocuments([])).toEqual([]);
    });
  });

  describe('VectorStoreService', () => {
    it('初始灌库后应具备基础检索能力，能检索到需求规范', async () => {
      const results = await vectorStoreService.search('RBAC 角色权限', 2);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].content).toContain('需求规范');
      expect(results[0].content).toContain('RBAC');
      expect(typeof results[0].score).toBe('number');
    });

    it('初始灌库后能检索到验收标准', async () => {
      const results = await vectorStoreService.search('向量维度与接口要求', 2);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some((r) => r.content.includes('验收标准'))).toBe(true);
    });

    it('初始灌库后能检索到约束说明', async () => {
      const results = await vectorStoreService.search('本地模型与离线运行', 2);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some((r) => r.content.includes('约束说明'))).toBe(true);
    });

    it('addTexts 应该能够存入新文档并成功检索', async () => {
      await vectorStoreService.addTexts(['全新自定义知识条目：用户注销需要在30天后彻底硬删除。']);
      const results = await vectorStoreService.search('用户注销与数据清理', 1);
      expect(results.length).toBe(1);
      expect(results[0].content).toContain('用户注销需要在30天后彻底硬删除');
    });

    it('search 启用 deduplicate 应能自动去重重复文本', async () => {
      await vectorStoreService.addTexts([
        '重复测试文本A',
        '重复测试文本A',
      ]);
      const dedupResults = await vectorStoreService.search('重复测试文本A', 5, true);
      const matched = dedupResults.filter((r) => r.content === '重复测试文本A');
      expect(matched.length).toBe(1);
    });

    it('getAllDocuments 能够获取所有文档', () => {
      const allDocs = vectorStoreService.getAllDocuments();
      expect(allDocs.length).toBeGreaterThanOrEqual(9);
      expect(allDocs[0]).toHaveProperty('content');
      expect(allDocs[0]).toHaveProperty('metadata');
    });

    it('reset 应该重置回初始 9 条文档', async () => {
      const count = await vectorStoreService.reset();
      expect(count).toBe(9);
      expect(vectorStoreService.getAllDocuments().length).toBe(9);
    });
  });

  describe('EmbeddingController', () => {
    it('POST embed 正常输入应返回 384 维向量', async () => {
      const res = await controller.embed({ text: '智能助手能力' });
      expect(res.code).toBe(200);
      expect(res.dimension).toBe(384);
      expect(res.model).toBe('Xenova/paraphrase-multilingual-MiniLM-L12-v2');
      expect(res.vector.length).toBe(384);
    });

    it('POST embed 非法输入应抛出 HttpException 400', async () => {
      await expect(controller.embed({ text: '' } as any)).rejects.toThrow(
        HttpException,
      );
    });

    it('POST store 正常批量存储应返回成功信息', async () => {
      const res = await controller.store({
        texts: ['接口必须支持幂等性', '分布式锁使用 Redis 实现'],
      });
      expect(res.code).toBe(200);
      expect(res.count).toBe(2);
      expect(res.message).toContain('成功存入');
    });

    it('POST store 非法输入应抛出 HttpException 400', async () => {
      await expect(controller.store({ texts: [] } as any)).rejects.toThrow(
        HttpException,
      );
    });

    it('POST search 应该返回 Top-K 相似文档与得分', async () => {
      const res = await controller.search({ query: 'Redis 分布式锁', k: 2 });
      expect(res.code).toBe(200);
      expect(res.query).toBe('Redis 分布式锁');
      expect(res.k).toBe(2);
      expect(res.documents.length).toBeGreaterThanOrEqual(1);
      expect(res.documents[0].content).toContain('分布式锁');
      expect(typeof res.documents[0].score).toBe('number');
    });

    it('POST search 非法输入应抛出 HttpException 400', async () => {
      await expect(controller.search({ query: '' } as any)).rejects.toThrow(
        HttpException,
      );
    });

    it('GET list 应该返回当前文档列表', async () => {
      const res = await controller.list();
      expect(res.code).toBe(200);
      expect(res.total).toBeGreaterThanOrEqual(9);
      expect(Array.isArray(res.documents)).toBe(true);
    });

    it('POST reset 应该能重置向量库', async () => {
      const res = await controller.reset();
      expect(res.code).toBe(200);
      expect(res.total).toBe(9);
      expect(res.message).toContain('重置');
    });
  });
});
