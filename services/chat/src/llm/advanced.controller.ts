import {
  Controller,
  Post,
  Body,
  BadRequestException,
} from '@nestjs/common';
import {
  AdvancedAnalysisService,
  type AdvancedAnalysisResult,
} from './advanced-analysis.service.js';

// 统一承载并导出第四章各核心 Controller
export { MemoryController } from './memory/memory.controller.js';
export { FilesystemController } from './filesystem/filesystem.controller.js';
export { EmbeddingController } from './embedding/embedding.controller.js';
export { AgentsController } from './agents/agents.controller.js';

/**
 * 分析接口请求体 DTO
 */
export interface AnalyzeDto {
  /** 会话唯一标识符 */
  sessionId: string;
  /** 用户输入内容 */
  input: string;
}

@Controller('api/advanced')
export class AdvancedController {
  constructor(
    private readonly advancedAnalysisService: AdvancedAnalysisService,
  ) {}

  /**
   * POST /api/advanced/analyze
   * 接收 { sessionId, input }，提取历史上下文执行多 Agent 分析并返回完整分析报告
   */
  @Post('analyze')
  async analyze(@Body() body: AnalyzeDto): Promise<AdvancedAnalysisResult> {
    if (!body?.sessionId?.trim()) {
      throw new BadRequestException('sessionId 不能为空');
    }
    if (typeof body?.input !== 'string' || !body.input.trim()) {
      throw new BadRequestException('input 不能为空且必须为字符串');
    }

    return this.advancedAnalysisService.analyze(body.sessionId, body.input);
  }
}
