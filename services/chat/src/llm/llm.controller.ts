import { Controller, Post, Body, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LlmService, DEFAULT_USER_INPUT } from './llm.service.js';
import { RequirementService } from './requirement.service.js';
import type { RequirementResult } from '@autix/contracts';
import type {
  InvokeResult,
  BatchResult,
  PromptPreviewResult,
  ChainInvokeResult,
  ChainBatchResult,
} from './llm.service.js';

// ============================================================
// 请求 DTO
// ============================================================

interface InvokeDto {
  /** 用户输入文本，为空时使用默认值 */
  input?: string;
}

interface BatchDto {
  /** 批量输入文本列表 */
  inputs?: string[];
}

@Controller('api/langchain')
export class LlmController {
  constructor(
    private readonly llmService: LlmService,
    private readonly requirementService?: RequirementService,
  ) {}

  /**
   * POST /api/langchain/invoke
   * 单次调用，返回完整 JSON 响应
   */
  @Post('invoke')
  async invoke(@Body() body?: InvokeDto): Promise<InvokeResult> {
    return this.llmService.invoke(body?.input);
  }

  /**
   * POST /api/langchain/stream
   * 流式调用，通过 SSE (text/event-stream) 逐 chunk 推送
   */
  @Post('stream')
  async stream(
    @Body() body: InvokeDto | undefined,
    @Res() res: Response,
  ): Promise<void> {
    // ----------------------------------------------------------
    // 响应头设置（按需切换）
    // ----------------------------------------------------------
    // [模式 1] 纯文本流（终端友好，直接呈现 Markdown 换行排版）
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

    // [模式 2] 标准 SSE 格式（前端 EventSource / Chat UI 常用）
    // res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');

    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      for await (const chunk of this.llmService.stream(body?.input)) {
        // [模式 1] 直接流式输出纯文本
        res.write(chunk);

        // [模式 2] SSE 标准事件流格式：data: <JSON>\n\n
        // res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      }

      // [模式 2 结束标识]
      // res.write('data: [DONE]\n\n');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      // res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
      res.write(`\n[Error]: ${message}\n`);
    } finally {
      res.end();
    }
  }

  /**
   * POST /api/langchain/batch
   * 批量调用，并行处理多条输入
   */
  @Post('batch')
  async batch(@Body() body?: BatchDto): Promise<BatchResult> {
    return this.llmService.batch(body?.inputs);
  }

  /**
   * POST /api/langchain/prompt-preview
   * 仅渲染模板，不调用模型
   */
  @Post('prompt-preview')
  async promptPreview(
    @Body() body?: InvokeDto,
  ): Promise<PromptPreviewResult> {
    return this.llmService.previewPrompt(body?.input);
  }

  /**
   * POST /api/langchain/prompt-to-model
   * 模板 -> formatMessages -> 模型调用
   */
  @Post('prompt-to-model')
  async promptToModel(
    @Body() body?: InvokeDto,
  ): Promise<InvokeResult> {
    return this.llmService.invokeWithPrompt(body?.input);
  }

  /**
   * POST /api/langchain/chain-invoke
   * LCEL 链单次调用，返回解析后的字符串结果
   */
  @Post('chain-invoke')
  async chainInvoke(
    @Body() body?: InvokeDto,
  ): Promise<ChainInvokeResult> {
    return this.llmService.chainInvoke(body?.input);
  }

  /**
   * POST /api/langchain/chain-stream
   * LCEL 链流式调用，逐 chunk 输出文本流
   */
  @Post('chain-stream')
  async chainStream(
    @Body() body: InvokeDto | undefined,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      for await (const chunk of this.llmService.chainStream(body?.input)) {
        res.write(chunk);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.write(`\n[Error]: ${message}\n`);
    } finally {
      res.end();
    }
  }

  /**
   * POST /api/langchain/chain-batch
   * LCEL 链批量并发调用
   */
  @Post('chain-batch')
  async chainBatch(
    @Body() body?: BatchDto,
  ): Promise<ChainBatchResult> {
    return this.llmService.chainBatch(body?.inputs);
  }

  /**
   * POST /api/langchain/structured
   * 需求结构化抽取接口，模型返回符合 RequirementResultSchema 契约的固定字段格式
   */
  @Post('structured')
  async structured(@Body() body?: InvokeDto): Promise<RequirementResult> {
    const input = body?.input?.trim() || DEFAULT_USER_INPUT;
    const service = this.requirementService ?? new RequirementService();
    return service.extract(input);
  }
}


