import {
  Controller,
  Post,
  Body,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UIResponseService } from './ui-response.service.js';
import { UIFlowService } from './ui-flow.service.js';
import type { AIUIResponse, UIAction } from './ui-types.js';
import { uiActionSchema } from './ui-schemas.js';

/**
 * 自然语言对话接口请求 DTO
 */
export interface UIChatDto {
  /** 会话标识符 */
  sessionId: string;
  /** 用户输入内容 */
  input: string;
}

/**
 * 界面组件交互动作接口请求 DTO
 */
export interface UIActionDto {
  /** 会话标识符 */
  sessionId: string;
  /** 前端交互回传数据 */
  action: UIAction;
}

/**
 * 无状态组件生成接口请求 DTO
 */
export interface UIGenerateDto {
  /** 业务文本或需求输入 */
  input: string;
  /** 可选的上下文上下文元数据 */
  context?: Record<string, unknown>;
}

@Controller('api/ui-chat')
export class UIChatController {
  constructor(
    private readonly uiResponseService: UIResponseService,
    private readonly uiFlowService: UIFlowService,
  ) {}

  /**
   * POST /api/ui-chat/chat
   * 接收用户自然语言输入，通过 Structured Output 约束生成包含 UI 组件的结构化响应
   */
  @Post('chat')
  @HttpCode(HttpStatus.OK)
  async chat(@Body() body: UIChatDto): Promise<AIUIResponse> {
    if (!body?.sessionId || typeof body.sessionId !== 'string' || !body.sessionId.trim()) {
      throw new BadRequestException('sessionId 不能为空且必须为有效字符串');
    }
    if (!body?.input || typeof body.input !== 'string' || !body.input.trim()) {
      throw new BadRequestException('input 不能为空且必须为有效字符串');
    }

    const sId = body.sessionId.trim();
    const input = body.input.trim();

    // 当用户意图是发起/提出新需求时，由 uiFlowService 统一初始化会话到 Stage 1: select_type，形成交互闭环
    if (input.includes('提新需求') || input.includes('创建需求') || input.includes('新需求')) {
      return this.uiFlowService.initFlow(sId, input);
    }

    return this.uiResponseService.generateUIResponse(input, [], { sessionId: sId });
  }

  /**
   * POST /api/ui-chat/action
   * 接收用户在 UI 上的操作回传，推进确定性状态机并返回下一步 UI 组件
   */
  @Post('action')
  @HttpCode(HttpStatus.OK)
  async action(@Body() body: UIActionDto): Promise<AIUIResponse> {
    if (!body?.sessionId || typeof body.sessionId !== 'string' || !body.sessionId.trim()) {
      throw new BadRequestException('sessionId 不能为空且必须为有效字符串');
    }
    if (!body?.action || typeof body.action !== 'object') {
      throw new BadRequestException('action 不能为空且必须为对象结构');
    }

    // 校验 action 结构是否符合 uiActionSchema 规范
    const parseResult = uiActionSchema.safeParse(body.action);
    if (!parseResult.success) {
      throw new BadRequestException(
        `action 数据结构不符合 UI 协议规范: ${parseResult.error.message}`,
      );
    }

    return this.uiFlowService.handleAction(body.sessionId.trim(), parseResult.data as UIAction);
  }

  /**
   * POST /api/ui-chat/generate
   * 无状态单次 UI 结构化生成接口
   * 无需 sessionId 会话上下文，直接利用大模型将自然语言/结构化描述转换为 UI 组件
   * 具备双层容灾降级：大模型调用异常时，自动平滑 fallback 到确定性规则，防止前端白屏
   */
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generate(@Body() body: UIGenerateDto): Promise<AIUIResponse> {
    if (!body?.input || typeof body.input !== 'string' || !body.input.trim()) {
      throw new BadRequestException('input 不能为空且必须为有效字符串');
    }

    try {
      return await this.uiResponseService.generateUIResponse(
        body.input.trim(),
        [],
        body.context,
      );
    } catch (err) {
      console.error(
        '[UIChatController] 结构化生成异常，触发平滑降级兜底:',
        err instanceof Error ? err.name : 'UnknownError',
      );
      return this.uiFlowService.handleInput('ui-generate-fallback', body.input.trim());
    }
  }
}
