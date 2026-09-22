import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ConversationService } from './conversation.service.js';
import { MessageService } from '../message/message.service.js';
import {
  ChatStreamService,
  type ChatStreamFrame,
} from './chat-stream.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { ChatConversationDto } from './dto/chat-conversation.dto.js';
import {
  CreateConversationSchema,
  ChatMessageSchema,
} from './dto/chat-input.schema.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';

@Controller('api/conversations')
@UseGuards(JwtAuthGuard)
export class ConversationController {
  private readonly logger = new Logger(ConversationController.name);

  constructor(
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
    private readonly chatStreamService: ChatStreamService,
  ) {}

  /**
   * POST /api/conversations
   * 为当前登录用户创建新会话
   */
  @Post()
  async create(
    @CurrentUser('userId') userId: string,
    // 第十八章：输入契约校验（title 长度上限）
    @Body(new ZodValidationPipe(CreateConversationSchema)) dto: CreateConversationDto,
  ) {
    return this.conversationService.create(userId, dto?.title);
  }

  /**
   * GET /api/conversations
   * 查询当前登录用户的全部会话列表
   */
  @Get()
  async findAll(@CurrentUser('userId') userId: string) {
    return this.conversationService.findByUser(userId);
  }

  /**
   * GET /api/conversations/:id/messages
   * 获取指定会话的消息历史（严格鉴权与归属校验）
   */
  @Get(':id/messages')
  async getMessages(
    @Param('id') conversationId: string,
    @CurrentUser('userId') userId: string,
    @Query('limit') limit?: string,
  ) {
    // 校验会话存在且属于当前登录用户
    await this.conversationService.findById(conversationId, userId);

    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    return this.messageService.getHistory(conversationId, parsedLimit);
  }

  /**
   * POST /api/conversations/:id/chat
   *
   * SSE 流式对话（前端用 fetchEventSource 消费）。事件协议对齐 autix-demo chat-web：
   *   { messageType: 'markdown' | 'meta' | 'progress' | 'log' | 'done' | 'error', timestamp, payload }
   *
   * 为什么必须是 SSE 而不是普通 JSON：前端 `handleSend` 拿到 200 后不会主动结束
   * 「思考中」状态，它只认 `markdown` 帧来关闭等待态、只认 `done` 帧来收尾。
   * 返回一次性 JSON 的结果就是 HTTP 200 但对话气泡永远转圈。
   */
  @Post(':id/chat')
  async chat(
    @Param('id') conversationId: string,
    @CurrentUser('userId') userId: string,
    // 第十八章：输入契约校验（message 必填 + 长度上限，防超长输入打爆 token）
    @Body(new ZodValidationPipe(ChatMessageSchema)) dto: ChatConversationDto,
    @Res() res: Response,
  ) {
    // 会话归属校验必须放在进入 SSE 模式之前：此时响应还没 flushHeaders，
    // Nest 的异常过滤器仍能正常序列化 404/403，前端拿得到清晰错误；
    // 一旦 flush 之后再抛异常，就只能在流里塞 error 帧了。
    const conversation = await this.conversationService.findById(
      conversationId,
      userId,
    );
    const shouldUpdateTitle =
      !conversation.title ||
      conversation.title === '新对话' ||
      conversation.title === '新会话';

    // SSE 响应头：no-transform + X-Accel-Buffering 关掉中间层缓冲，否则 token 会攒批
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const writeFrame = (frame: ChatStreamFrame): void => {
      if (res.writableEnded || res.destroyed) return;
      res.write(
        `data: ${JSON.stringify({
          messageType: frame.messageType,
          timestamp: new Date().toISOString(),
          payload: frame.payload,
        })}\n\n`,
      );
    };

    try {
      for await (const frame of this.chatStreamService.stream({
        conversationId,
        userId,
        rawMessage: dto?.message,
        modelId: dto?.modelId,
        shouldUpdateTitle,
      })) {
        writeFrame(frame);
      }
    } catch (err) {
      this.logger.error(
        `[chat SSE] 会话 ${conversationId} 处理失败`,
        err instanceof Error ? err.stack : String(err),
      );
      writeFrame({
        messageType: 'error',
        payload: {
          error: err instanceof Error ? err.message : 'Unknown error',
        },
      });
    } finally {
      if (!res.writableEnded) res.end();
    }
  }

  /**
   * DELETE /api/conversations/:id
   * 删除指定会话（级联清除消息）
   */
  @Delete(':id')
  async delete(
    @Param('id') conversationId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.conversationService.delete(conversationId, userId);
  }
}
