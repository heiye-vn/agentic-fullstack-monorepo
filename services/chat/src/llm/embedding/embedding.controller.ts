import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { EmbeddingService } from './embedding.service.js';
import { VectorStoreService } from './vector-store.service.js';

export interface EmbedRequestDto {
  text: string;
}

export interface StoreRequestDto {
  texts: string[];
}

export interface SearchRequestDto {
  query: string;
  k?: number;
  deduplicate?: boolean;
}

@Controller('api/embedding')
export class EmbeddingController {
  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly vectorStoreService: VectorStoreService,
  ) {}

  /**
   * 生成单个文本的特征嵌入向量
   * POST /api/embedding/embed
   * Body: { "text": "示例文本" }
   */
  @Post('embed')
  async embed(@Body() body: EmbedRequestDto) {
    if (!body || typeof body.text !== 'string' || body.text.trim() === '') {
      throw new HttpException(
        'text 字段不能为空且必须为字符串',
        HttpStatus.BAD_REQUEST,
      );
    }

    const vector = await this.embeddingService.embedQuery(body.text);

    return {
      code: 200,
      model: this.embeddingService.getModelName(),
      dimension: vector.length,
      vector,
    };
  }

  /**
   * 将文本数组存入向量库
   * POST /api/embedding/store
   * Body: { "texts": ["文档1", "文档2"] }
   */
  @Post('store')
  async store(@Body() body: StoreRequestDto) {
    if (!body || !Array.isArray(body.texts) || body.texts.length === 0) {
      throw new HttpException(
        'texts 字段不能为空且必须为字符串数组',
        HttpStatus.BAD_REQUEST,
      );
    }

    const validTexts = body.texts.filter(
      (item) => typeof item === 'string' && item.trim().length > 0,
    );

    if (validTexts.length === 0) {
      throw new HttpException(
        'texts 数组中至少包含一条有效非空文本',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.vectorStoreService.addTexts(validTexts);

    return {
      code: 200,
      message: `成功存入 ${validTexts.length} 条文档至向量库`,
      count: validTexts.length,
    };
  }

  /**
   * 相似度向量语义搜索
   * POST /api/embedding/search
   * Body: { "query": "搜索词", "k": 3, "deduplicate": false }
   * deduplicate：对检索结果去重（避免相同的内容重复霸榜）
   */
  @Post('search')
  async search(@Body() body: SearchRequestDto) {
    if (!body || typeof body.query !== 'string' || body.query.trim() === '') {
      throw new HttpException(
        'query 字段不能为空且必须为字符串',
        HttpStatus.BAD_REQUEST,
      );
    }

    const k = typeof body.k === 'number' && !Number.isNaN(body.k) ? body.k : 4;
    const deduplicate = Boolean(body.deduplicate);
    const documents = await this.vectorStoreService.search(
      body.query,
      k,
      deduplicate,
    );

    return {
      code: 200,
      query: body.query,
      k,
      deduplicate,
      total: documents.length,
      documents,
    };
  }

  /**
   * 查看当前内存向量库中所有存储的文档清单
   * GET /api/embedding/list
   */
  @Get('list')
  async list() {
    const documents = this.vectorStoreService.getAllDocuments();
    return {
      code: 200,
      total: documents.length,
      documents,
    };
  }

  /**
   * 重置当前内存向量库并重新执行初始规范文档灌库
   * POST /api/embedding/reset
   */
  @Post('reset')
  async reset() {
    const count = await this.vectorStoreService.reset();
    return {
      code: 200,
      message: '内存向量库已成功重置并恢复初始规范文档灌库',
      total: count,
    };
  }
}
