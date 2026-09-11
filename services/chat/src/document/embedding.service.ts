import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { pipeline } from '@xenova/transformers';

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name);
  private extractorPromise: Promise<any> | null = null;
  private readonly modelName = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

  async onModuleInit(): Promise<void> {
    this.logger.log(`预热并初始化文档向量化模型: ${this.modelName}`);
    await this.getExtractor();
    this.logger.log(`文档向量化模型就绪: ${this.modelName}`);
  }

  /**
   * 单例获取 feature-extraction 管道实例
   */
  private async getExtractor(): Promise<any> {
    if (!this.extractorPromise) {
      this.extractorPromise = pipeline('feature-extraction', this.modelName);
    }
    return this.extractorPromise;
  }

  /**
   * 文本清洗：移除多余换行符，规范空白字符
   */
  private cleanText(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }
    return text.replace(/\r?\n/g, ' ').trim();
  }

  /**
   * 批量向量化文本：mean pooling + L2 归一化，返回 384 维浮点向量数组
   * @param texts 待向量化的文本数组
   */
  async embedTexts(texts: string[]): Promise<number[][]> {
    if (!Array.isArray(texts) || texts.length === 0) {
      return [];
    }

    const extractor = await this.getExtractor();
    const results: number[][] = [];

    for (const text of texts) {
      const cleaned = this.cleanText(text);
      if (!cleaned) {
        results.push([]);
        continue;
      }

      // 执行 mean pooling 均值池化与 L2 归一化 (normalize: true)
      const output = await extractor(cleaned, {
        pooling: 'mean',
        normalize: true,
      });

      results.push(Array.from(output.data as Float32Array));
    }

    return results;
  }

  /**
   * 单个文本向量化提取辅助方法
   * @param text 输入文本
   */
  async embedText(text: string): Promise<number[]> {
    const vectors = await this.embedTexts([text]);
    return vectors[0] || [];
  }

  /**
   * 别名兼容：embedDocuments 指向 embedTexts
   */
  async embedDocuments(documents: string[]): Promise<number[][]> {
    return this.embedTexts(documents);
  }

  /**
   * 别名兼容：embedQuery 指向 embedText
   */
  async embedQuery(text: string): Promise<number[]> {
    return this.embedText(text);
  }

  /**
   * 获取当前使用的模型名称
   */
  getModelName(): string {
    return this.modelName;
  }
}
