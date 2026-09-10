import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  BadRequestException,
} from '@nestjs/common';
import {
  RunnableMemoryService,
  type MemoryVersion,
  type HistoryMessageItem,
} from './runnable-memory.service.js';

/**
 * 对话请求 DTO
 */
export interface MemoryChatDto {
  /** 会话唯一标识符 */
  sessionId: string;
  /** 用户输入内容 */
  input: string;
  /** 记忆模式版本：standard (默认) | trimmed */
  version?: MemoryVersion;
}

/**
 * 对话响应结构
 */
export interface MemoryChatResponse {
  success: boolean;
  sessionId: string;
  output: string;
  version: MemoryVersion;
}

/**
 * 历史记录响应结构
 */
export interface MemoryHistoryResponse {
  success: boolean;
  sessionId: string;
  version?: MemoryVersion;
  history: HistoryMessageItem[];
  count: number;
}

/**
 * 清除会话响应结构
 */
export interface MemoryClearResponse {
  success: boolean;
  sessionId: string;
  message: string;
}

@Controller('api/memory')
export class MemoryController {
  constructor(private readonly memoryService: RunnableMemoryService) {}

  /**
   * POST /api/memory/chat
   * 接收 { sessionId, input }，执行多轮对话推理并返回结果
   */
  @Post('chat')
  async chat(@Body() body: MemoryChatDto): Promise<MemoryChatResponse> {
    if (!body?.sessionId?.trim()) {
      throw new BadRequestException('sessionId 不能为空');
    }
    if (typeof body?.input !== 'string') {
      throw new BadRequestException('input 必须为字符串');
    }

    const version: MemoryVersion = body.version === 'trimmed' ? 'trimmed' : 'standard';
    const output = await this.memoryService.chat(body.sessionId, body.input, {
      version,
    });

    return {
      success: true,
      sessionId: body.sessionId,
      output,
      version,
    };
  }

  /**
   * GET /api/memory/history/:sessionId
   * 返回当前会话的历史记录
   */
  @Get('history/:sessionId')
  async getHistory(
    @Param('sessionId') sessionId: string,
    @Query('version') versionQuery?: MemoryVersion,
  ): Promise<MemoryHistoryResponse> {
    if (!sessionId?.trim()) {
      throw new BadRequestException('sessionId 不能为空');
    }

    const version: MemoryVersion =
      versionQuery === 'trimmed' ? 'trimmed' : 'standard';
    const history = await this.memoryService.getHistory(sessionId, version);

    return {
      success: true,
      sessionId,
      version,
      history,
      count: history.length,
    };
  }

  /**
   * DELETE /api/memory/history/:sessionId
   * 清除指定会话记忆
   */
  @Delete('history/:sessionId')
  async clearSession(
    @Param('sessionId') sessionId: string,
    @Query('version') versionQuery?: MemoryVersion,
  ): Promise<MemoryClearResponse> {
    if (!sessionId?.trim()) {
      throw new BadRequestException('sessionId 不能为空');
    }

    await this.memoryService.clearSession(sessionId, versionQuery);

    return {
      success: true,
      sessionId,
      message: `会话 ${sessionId} 记忆已清除`,
    };
  }
}
