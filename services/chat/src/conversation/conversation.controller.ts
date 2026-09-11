import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConversationService } from './conversation.service.js';
import { MessageService } from '../message/message.service.js';
import { RunnableMemoryService } from '../llm/memory/runnable-memory.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { ChatConversationDto } from './dto/chat-conversation.dto.js';

@Controller('api/conversations')
@UseGuards(JwtAuthGuard)
export class ConversationController {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
    private readonly runnableMemoryService: RunnableMemoryService,
  ) {}

  /**
   * POST /api/conversations
   * 为当前登录用户创建新会话
   */
  @Post()
  async create(
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateConversationDto,
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
   * 在指定会话中发送消息，并利用基于 PostgreSQL 的 LangChain 链返回模型回复
   */
  @Post(':id/chat')
  async chat(
    @Param('id') conversationId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: ChatConversationDto,
  ) {
    // 1. 严格校验会话存在性与归属权限
    await this.conversationService.findById(conversationId, userId);

    // 2. 构建基于 PostgreSQL 历史记录的 RunnableWithMessageHistory 对话链
    const chain = this.runnableMemoryService.createRunnableWithDbHistory(
      this.messageService,
    );

    // 3. 执行多轮对话链（自动读取历史，并在完成后自动将用户提问与模型回答持久化至数据库）
    const inputContent = dto.message?.trim() ?? '';
    const response = await chain.invoke(
      { input: inputContent },
      { configurable: { sessionId: conversationId } },
    );

    return {
      conversationId,
      message: inputContent,
      response,
    };
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
