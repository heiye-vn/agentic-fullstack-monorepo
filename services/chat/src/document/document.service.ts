import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChunkService } from './chunk.service.js';
import type { Document } from '../generated/prisma/client.js';

// 允许的 MIME 类型白名单
export const ALLOWED_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

// 允许的文件扩展名白名单
export const ALLOWED_EXTENSIONS = ['.txt', '.md', '.markdown', '.pdf', '.doc', '.docx'];

// 最大文件尺寸 10MB
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);
  private readonly uploadRoot: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly chunkService: ChunkService,
  ) {
    this.uploadRoot =
      process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'uploads');
  }

  /**
   * 检查文件类型是否合法
   */
  public isValidFileType(mimetype: string, originalname: string): boolean {
    const ext = path.extname(originalname).toLowerCase();
    const isMimeAllowed = ALLOWED_MIME_TYPES.includes(mimetype);
    const isExtAllowed = ALLOWED_EXTENSIONS.includes(ext);

    return isMimeAllowed || isExtAllowed;
  }

  /**
   * 上传文件并落盘，持久化元数据至 documents 表
   */
  async upload(
    userId: string,
    file: Express.Multer.File,
    customFilename?: string,
  ): Promise<Document> {
    if (!file) {
      throw new BadRequestException('请选择要上传的文件');
    }

    if (!userId) {
      throw new BadRequestException('用户标识不能为空');
    }

    // 1. 校验文件大小
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException(
        `文件大小超出限制，最大允许 ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      );
    }

    // 2. 校验文件类型
    if (!this.isValidFileType(file.mimetype, file.originalname)) {
      throw new BadRequestException(
        '不支持的文件类型，仅允许上传 txt、md、pdf、doc、docx 格式文档',
      );
    }

    // 3. 准备物理存储目录：兼容 uploads 目录及用户子目录不存在时自动递归创建
    const userDir = path.join(this.uploadRoot, userId);
    await fs.promises.mkdir(userDir, { recursive: true });

    // 4. 安全净化文件名，防止目录遍历与特殊字符注入
    const rawName = path.basename(file.originalname);
    const sanitizedName = rawName.replace(/[^a-zA-Z0-9.\u4e00-\u9fa5_-]/g, '_');
    const timestamp = Date.now();
    const diskFileName = `${timestamp}-${sanitizedName}`;
    const fullDiskPath = path.join(userDir, diskFileName);

    // 5. 将内存 buffer 写入磁盘物理文件
    await fs.promises.writeFile(fullDiskPath, file.buffer);

    // 统一以相对规范路径存储（uploads/{userId}/{timestamp}-{name}）
    const relativeFilePath = `uploads/${userId}/${diskFileName}`.replace(/\\/g, '/');

    // 6. 写入数据库元数据
    const displayName = (customFilename && customFilename.trim().length > 0)
      ? customFilename.trim()
      : rawName;

    return this.prisma.document.create({
      data: {
        userId,
        filename: displayName,
        mimeType: file.mimetype,
        size: file.size,
        filePath: relativeFilePath,
        storageType: 'local',
        status: 'pending',
        chunkCount: 0,
      },
    });
  }

  /**
   * 查询当前用户的文档列表，按创建时间倒序
   */
  async findByUser(userId: string): Promise<Document[]> {
    if (!userId) {
      throw new BadRequestException('用户标识不能为空');
    }

    return this.prisma.document.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 查询单个文档详情（带归属权限校验）
   */
  async findById(documentId: string, userId: string): Promise<Document> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      throw new NotFoundException(`未找到 ID 为 ${documentId} 的文档`);
    }

    if (document.userId !== userId) {
      throw new ForbiddenException('无权访问该文档');
    }

    return document;
  }

  /**
   * 删除文档（删除物理文件并在数据库中级联删除关联切片）
   */
  async delete(
    documentId: string,
    userId: string,
  ): Promise<{ success: boolean; message: string; documentId: string }> {
    // 权限与存在性校验
    const document = await this.findById(documentId, userId);

    // 1. 删除磁盘物理文件（包含安全容错）
    if (document.filePath) {
      const fullDiskPath = path.isAbsolute(document.filePath)
        ? document.filePath
        : path.resolve(process.cwd(), document.filePath);

      try {
        await fs.promises.unlink(fullDiskPath);
        this.logger.log(`成功清理文档物理文件: ${fullDiskPath}`);
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          this.logger.warn(`清理物理文件异常: ${fullDiskPath}`, err);
        }
      }
    }

    // 2. 数据库中删除（Prisma schema 中已配置 onDelete: Cascade，自动删除切片）
    await this.prisma.document.delete({
      where: { id: documentId },
    });

    return {
      success: true,
      message: '文档及物理文件已成功删除',
      documentId,
    };
  }

  /**
   * 异步处理流水线：解析 -> 分块 (Chunking) -> 向量化 (Embedding) -> 持久化
   * 统一委托给 ChunkService 执行
   */
  async processAsync(documentId: string, userId: string): Promise<void> {
    return this.chunkService.processDocument(documentId, userId);
  }
}
