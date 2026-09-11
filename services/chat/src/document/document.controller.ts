import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import * as path from 'node:path';
import {
  DocumentService,
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE,
} from './document.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@Controller('api/documents')
@UseGuards(JwtAuthGuard)
export class DocumentController {
  private readonly logger = new Logger(DocumentController.name);

  constructor(private readonly documentService: DocumentService) {}

  /**
   * POST /api/documents/upload
   * 上传文件（multipart/form-data，内存存储 + fileFilter + 10MB 限制）
   */
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: MAX_FILE_SIZE,
      },
      fileFilter: (_req, file, callback) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const isMimeAllowed = ALLOWED_MIME_TYPES.includes(file.mimetype);
        const isExtAllowed = ALLOWED_EXTENSIONS.includes(ext);

        if (!isMimeAllowed && !isExtAllowed) {
          return callback(
            new BadRequestException(
              '不支持的文件类型，仅允许上传 txt、md、pdf、doc、docx 格式文档',
            ),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  async upload(
    @CurrentUser('userId') userId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('filename') customFilename?: string,
  ) {
    if (!file) {
      throw new BadRequestException('请选择待上传的文件 (字段名: file)');
    }

    return this.documentService.upload(userId, file, customFilename);
  }

  /**
   * POST /api/documents/:id/process
   * 触发解析 + 分块 + 向量化（异步流水线，立即返回 HTTP 202 Accepted）
   */
  @Post(':id/process')
  @HttpCode(HttpStatus.ACCEPTED)
  async process(
    @Param('id') id: string,
    @CurrentUser('userId') userId: string,
  ) {
    // 校验归属权限
    await this.documentService.findById(id, userId);

    // 触发异步处理
    this.documentService.processAsync(id, userId).catch((err) => {
      this.logger.error(`文档 ${id} 异步处理失败:`, err);
    });

    return {
      statusCode: HttpStatus.ACCEPTED,
      message: '文档处理任务已接受，后台异步流水线处理中',
      documentId: id,
    };
  }

  /**
   * GET /api/documents
   * 获取当前登录用户的文档列表
   */
  @Get()
  async findByUser(@CurrentUser('userId') userId: string) {
    return this.documentService.findByUser(userId);
  }

  /**
   * GET /api/documents/:id
   * 获取指定文档详情
   */
  @Get(':id')
  async findById(
    @Param('id') id: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.documentService.findById(id, userId);
  }

  /**
   * DELETE /api/documents/:id
   * 删除指定文档（级联清理切片数据及磁盘物理文件）
   */
  @Delete(':id')
  async delete(@Param('id') id: string, @CurrentUser('userId') userId: string) {
    return this.documentService.delete(id, userId);
  }
}
