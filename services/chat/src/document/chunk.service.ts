import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { PrismaService } from '../prisma/prisma.service.js';
import { TaskStatus } from '../prisma/index.js';
import { EmbeddingService } from './embedding.service.js';
import { ParserFactory } from './parsers/parser.factory.js';
import { SseService } from '../sse/sse.service.js';

@Injectable()
export class ChunkService {
  private readonly logger = new Logger(ChunkService.name);
  private readonly splitter: RecursiveCharacterTextSplitter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
    private readonly parserFactory: ParserFactory,
    private readonly sseService: SseService,
  ) {
    // 满足要求：RecursiveCharacterTextSplitter（chunkSize: 500, chunkOverlap: 50）
    this.splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 500,
      chunkOverlap: 50,
    });
  }

  /**
   * 使用 RecursiveCharacterTextSplitter 对文本进行分块
   * @param text 待分块文本
   */
  async splitText(text: string): Promise<string[]> {
    const trimmed = text ? text.trim() : '';
    if (!trimmed) {
      return [];
    }
    return this.splitter.splitText(trimmed);
  }

  /**
   * 文档处理核心流水线：解析 → 分块 → 向量化 → 落库 (PostgreSQL) → 更新 status/chunkCount
   * @param documentId 文档 ID
   * @param userId 操作用户 ID
   */
  async processDocument(documentId: string, userId: string): Promise<void> {
    // 1. 获取文档并鉴权
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      throw new NotFoundException(`未找到 ID 为 ${documentId} 的文档`);
    }

    if (document.userId !== userId) {
      throw new ForbiddenException('无权访问该文档');
    }

    try {
      // 2. 更新状态为 processing
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: 'processing' },
      });

      // 推送任务开始事件
      await this.sseService.emit(userId, {
        taskId: documentId,
        taskType: 'document_process',
        status: TaskStatus.processing,
        message: `开始处理文档 [${document.filename}]`,
        metadata: {
          documentId,
          filename: document.filename,
          size: document.size,
          mimeType: document.mimeType,
        },
      });

      // 3. 物理文件路径确定与文件解析
      const fullDiskPath = path.isAbsolute(document.filePath || '')
        ? (document.filePath as string)
        : path.resolve(process.cwd(), document.filePath || '');

      if (!fs.existsSync(fullDiskPath)) {
        throw new NotFoundException(`文档物理文件不存在: ${fullDiskPath}`);
      }

      this.logger.log(
        `开始解析文档 [${document.filename}] (${document.mimeType})`,
      );
      const rawText = await this.parserFactory.extractText(
        fullDiskPath,
        document.mimeType,
      );

      // 4. 执行分块分割
      const chunks = await this.splitText(rawText);
      this.logger.log(
        `文档 [${document.filename}] 文本分块完成，切片数量: ${chunks.length}`,
      );

      // 5. 清理旧切片
      await this.prisma.documentChunk.deleteMany({
        where: { documentId },
      });

      // 6. 批量向量化与落库至 PostgreSQL
      if (chunks.length > 0) {
        // 调用 embedTexts 批量生成 384 维特征向量
        const embeddings = await this.embeddingService.embedTexts(chunks);

        for (let i = 0; i < chunks.length; i++) {
          const chunkContent = chunks[i];
          const embeddingVector = embeddings[i] || [];

          // 插入切片基础记录
          const createdChunk = await this.prisma.documentChunk.create({
            data: {
              documentId,
              content: chunkContent,
              chunkIndex: i,
            },
          });

          // 向量落库：存入 PostgreSQL vector 字段
          if (embeddingVector.length > 0) {
            try {
              const vectorLiteral = `[${embeddingVector.join(',')}]`;
              await this.prisma.$executeRawUnsafe(
                `UPDATE document_chunks SET embedding = $1::vector WHERE id = $2`,
                vectorLiteral,
                createdChunk.id,
              );
            } catch (vErr) {
              this.logger.warn(
                `写入 PostgreSQL pgvector 字段跳过或降级 (Chunk ID: ${createdChunk.id}): ${vErr}`,
              );
            }
          }
        }
      }

      // 7. 更新文档最终状态为 done，并回填切片数量
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: 'done',
          chunkCount: chunks.length,
        },
      });

      // 推送任务完成事件
      await this.sseService.emit(userId, {
        taskId: documentId,
        taskType: 'document_process',
        status: TaskStatus.done,
        message: `文档 [${document.filename}] 处理完成，生成 ${chunks.length} 个切片`,
        metadata: {
          documentId,
          filename: document.filename,
          chunkCount: chunks.length,
        },
      });

      this.logger.log(
        `文档 ${documentId} (${document.filename}) 处理完成: 已落库 ${chunks.length} 个切片至 PostgreSQL`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`文档 ${documentId} 处理失败:`, error);
      await this.prisma.document
        .update({
          where: { id: documentId },
          data: { status: 'error' },
        })
        .catch((dbErr) => {
          this.logger.error(`回滚文档 ${documentId} 状态为 error 失败:`, dbErr);
        });

      // 推送任务失败事件
      await this.sseService
        .emit(userId, {
          taskId: documentId,
          taskType: 'document_process',
          status: TaskStatus.error,
          message: `文档 [${document.filename}] 处理失败: ${errorMessage}`,
          metadata: {
            documentId,
            filename: document.filename,
            error: errorMessage,
          },
        })
        .catch((emitErr) => {
          this.logger.error(`推送任务失败事件异常:`, emitErr);
        });

      throw error;
    }
  }
}
