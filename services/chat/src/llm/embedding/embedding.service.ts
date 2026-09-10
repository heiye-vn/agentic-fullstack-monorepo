import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Embeddings } from '@langchain/core/embeddings';
import { pipeline } from '@xenova/transformers';

@Injectable()
export class EmbeddingService extends Embeddings implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name);
  private extractorPromise: Promise<any> | null = null;
  private readonly modelName = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

  constructor() {
    super({});
  }

  async onModuleInit(): Promise<void> {
    this.logger.log(`正在预热并初始化本地嵌入模型: ${this.modelName}`);
    await this.getExtractor();
    this.logger.log(`本地嵌入模型初始化完成: ${this.modelName}`);
  }

  /**
   * 获取单例 pipeline 抽取器
   */
  private async getExtractor(): Promise<any> {
    if (!this.extractorPromise) {
      this.extractorPromise = pipeline('feature-extraction', this.modelName);
    }
    return this.extractorPromise;
  }

  /**
   * 文本预清洗（行业标准实践）：
   * 将多行换行符统一替换为空格，消除断句对 Transformer 注意力机制的负面影响
   */
  private cleanText(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }
    return text.replace(/\r?\n/g, ' ').trim();
  }

  /**
   * 对单个查询文本生成嵌入向量 (384维)
   * 采用 mean pooling（均值池化）与 L2 归一化（normalize: true）
   */
  async embedQuery(text: string): Promise<number[]> {
    const cleaned = this.cleanText(text);
    if (!cleaned) {
      return [];
    }

    const extractor = await this.getExtractor();
    const output = await extractor(cleaned, {
      pooling: 'mean',
      normalize: true,
    });

    return Array.from(output.data as Float32Array);
  }

  /**
   * 对多个文档批量生成嵌入向量
   */
  async embedDocuments(documents: string[]): Promise<number[][]> {
    if (!Array.isArray(documents) || documents.length === 0) {
      return [];
    }

    const results: number[][] = [];
    for (const doc of documents) {
      const vector = await this.embedQuery(doc);
      results.push(vector);
    }
    return results;
  }

  /**
   * 获取当前嵌入模型名称
   */
  getModelName(): string {
    return this.modelName;
  }
}
