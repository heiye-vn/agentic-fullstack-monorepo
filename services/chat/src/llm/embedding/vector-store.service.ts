import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory';
import { Document } from '@langchain/core/documents';
import { EmbeddingService } from './embedding.service.js';

export interface SearchResultItem {
  content: string;
  score?: number;
  metadata: Record<string, any>;
}

export interface DocumentItem {
  id?: string;
  content: string;
  metadata: Record<string, any>;
}

@Injectable()
export class VectorStoreService implements OnModuleInit {
  private readonly logger = new Logger(VectorStoreService.name);
  private vectorStore!: MemoryVectorStore;

  constructor(private readonly embeddingService: EmbeddingService) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('正在初始化 MemoryVectorStore 内存向量库...');
    this.vectorStore = new MemoryVectorStore(this.embeddingService);
    await this.seedInitialDocuments();
    this.logger.log('MemoryVectorStore 内存向量库初始化与初始灌库完成');
  }

  /**
   * 初始灌库文档数据（需求规范片段、验收标准片段、约束说明片段）
   */
  private async seedInitialDocuments(): Promise<void> {
    const initialSeedDocs = [
      // 需求规范片段
      '【需求规范】系统必须支持基于角色的访问控制（RBAC），严格划分超级管理员、项目管理员和普通用户的数据权限与操作菜单。',
      '【需求规范】Chat 智能助手需集成多轮记忆管理与会话状态持久化，保障上下文连贯性，并支持按 sessionId 清空历史。',
      '【需求规范】LangChain 层必须接入轻量级本地向量化与语义检索能力，支持对知识库片段与规范文本的高效召回。',

      // 验收标准片段
      '【验收标准】向量检索接口 POST /api/embedding/search 需支持参数 k，返回的相似文档列表按余弦相似度降序排列。',
      '【验收标准】嵌入服务返回的向量维度必须严格为 384 维，且针对同一输入语义文本生成确定性的标准化特征向量。',
      '【验收标准】文件操作与业务工具必须包含严格的沙箱路径校验，杜绝任何形式的路径遍历越权与安全漏洞。',

      // 约束说明片段
      '【约束说明】本地嵌入模型统一采用 Xenova/paraphrase-multilingual-MiniLM-L12-v2，基于本地 ONNX 运行时执行推理，无需外部 API Key。',
      '【约束说明】当前阶段向量索引保存在进程内存 MemoryVectorStore 中，服务重启时自动重新执行初始灌库。',
      '【约束说明】所有向量存储和嵌入接口实现严格遵循 LangChain 标准抽象规范，确保与 LangChain 生态组件完全兼容。',
    ];

    await this.addTexts(initialSeedDocs);
  }

  /**
   * 批量将文本列表存入内存向量库
   * @param texts 文本数组
   */
  async addTexts(texts: string[]): Promise<void> {
    if (!Array.isArray(texts) || texts.length === 0) {
      return;
    }

    const docs = texts
      .filter((text) => typeof text === 'string' && text.trim().length > 0)
      .map(
        (text) =>
          new Document({
            pageContent: text,
            metadata: {
              createdAt: new Date().toISOString(),
              source: 'text_input',
            },
          }),
      );

    if (docs.length > 0) {
      await this.vectorStore.addDocuments(docs);
      this.logger.log(`成功向向量库写入 ${docs.length} 条文档`);
    }
  }

  /**
   * 相似度语义搜索
   * @param query 检索查询词
   * @param k 返回的最相似文档数
   * @param deduplicate 是否按文本内容去重
   */
  async search(
    query: string,
    k: number = 4,
    deduplicate: boolean = false,
  ): Promise<SearchResultItem[]> {
    if (!query || typeof query !== 'string') {
      return [];
    }

    const safeK = Math.max(1, Math.min(k || 4, 20));
    const candidateK = deduplicate ? Math.min(safeK * 3, 50) : safeK;
    const results = await this.vectorStore.similaritySearchWithScore(
      query,
      candidateK,
    );

    const mappedResults: SearchResultItem[] = [];
    const seenContents = new Set<string>();

    for (const [doc, rawScore] of results) {
      if (deduplicate) {
        if (seenContents.has(doc.pageContent)) {
          continue;
        }
        seenContents.add(doc.pageContent);
      }

      mappedResults.push({
        content: doc.pageContent,
        score: Number(rawScore.toFixed(4)),
        metadata: doc.metadata || {},
      });

      if (mappedResults.length >= safeK) {
        break;
      }
    }

    return mappedResults;
  }

  /**
   * 获取当前内存向量库中的所有文档清单
   */
  getAllDocuments(): DocumentItem[] {
    if (!this.vectorStore || !this.vectorStore.memoryVectors) {
      return [];
    }

    return this.vectorStore.memoryVectors.map((item) => ({
      id: item.id,
      content: item.content,
      metadata: item.metadata || {},
    }));
  }

  /**
   * 一键重置向量库并重新加载初始灌库文档
   */
  async reset(): Promise<number> {
    this.logger.log('正在执行 MemoryVectorStore 向量库重置...');
    this.vectorStore = new MemoryVectorStore(this.embeddingService);
    await this.seedInitialDocuments();
    const count = this.vectorStore.memoryVectors.length;
    this.logger.log(`向量库重置成功，已重新灌入 ${count} 条初始文档`);
    return count;
  }
}
