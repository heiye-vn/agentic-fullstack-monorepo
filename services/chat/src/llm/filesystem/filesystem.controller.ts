import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import {
  FilesystemService,
  type FilesystemChatResult,
} from './filesystem.service.js';

export interface FilesystemChatDto {
  /** 用户输入指令，如：“查询需求单 REQ-2026-001 的详情” */
  input: string;
}

@Controller('api/files')
export class FilesystemController {
  constructor(private readonly filesystemService: FilesystemService) {}

  /**
   * POST /api/files/chat
   * 需求分析助手对话接口：模型可按需调用业务查询与文件读写工具，完成业务分析闭环
   */
  @Post('chat')
  async chat(@Body() body: FilesystemChatDto): Promise<FilesystemChatResult> {
    if (!body || typeof body.input !== 'string') {
      throw new BadRequestException('请求体中必须包含 input 文本字段');
    }

    return this.filesystemService.chat(body.input);
  }
}
