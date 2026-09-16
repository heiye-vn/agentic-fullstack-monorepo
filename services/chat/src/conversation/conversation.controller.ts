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
import { RunnableMemoryService } from '../llm/memory/runnable-memory.service.js';
import { ModelConfigService } from '../model-config/model-config.service.js';
import { createChatModel } from '../llm/model.factory.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { MessageRole, ModelType } from '../prisma/index.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { ChatConversationDto } from './dto/chat-conversation.dto.js';

@Controller('api/conversations')
@UseGuards(JwtAuthGuard)
export class ConversationController {
  private readonly logger = new Logger(ConversationController.name);

  constructor(
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
    private readonly runnableMemoryService: RunnableMemoryService,
    private readonly modelConfigService: ModelConfigService,
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
    @Body() dto: ChatConversationDto,
    @Res() res: Response,
  ) {
    // 1. 严格校验会话存在性与归属权限（不存在/非本人直接 404）
    const conversation = await this.conversationService.findById(
      conversationId,
      userId,
    );
    const shouldUpdateTitle =
      !conversation.title ||
      conversation.title === '新对话' ||
      conversation.title === '新会话';

    // 2. SSE 响应头：no-transform + X-Accel-Buffering 关掉中间层缓冲，否则 token 会攒批
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const writeFrame = (messageType: string, payload: unknown): void => {
      if (res.writableEnded || res.destroyed) return;
      res.write(
        `data: ${JSON.stringify({
          messageType,
          timestamp: new Date().toISOString(),
          payload,
        })}\n\n`,
      );
    };

    const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    try {
      // 前端第二条链路（UI 组件交互）会把 message 传成对象，这里统一成文本
      const raw = dto?.message as unknown;
      const inputContent =
        typeof raw === 'string' ? raw.trim() : JSON.stringify(raw ?? '');

      if (!inputContent) {
        writeFrame('error', { error: '消息内容不能为空' });
        return;
      }

      // 3. 先取历史（此时还未写入本轮，避免本轮被重复带入上下文）
      const history =
        await this.messageService.getHistoryAsLangChainMessages(conversationId);

      // 4. 用户消息落库
      await this.messageService.addMessage(
        conversationId,
        MessageRole.USER,
        inputContent,
      );

      // 5. 解析模型：优先根据 modelId 或用户默认模型匹配数据库 model_configs 表配置
      const model = await this.resolveChatModel(dto?.modelId, userId);

      // 6. 直接用「不带历史包装器」的链做流式输出。
      //    不用 RunnableWithMessageHistory 是因为它的 _exitHistory 依赖 run.outputs，
      //    在流式场景下不可靠，会抛 "Output values from 'Run' undefined"。
      //    这里由本方法显式负责读写历史，行为确定。
      const chain = this.runnableMemoryService.createStandardChain(model);
      const stream = await chain.stream(
        { history, input: inputContent },
        { configurable: { sessionId: conversationId } },
      );

      let persistedContent = '';
      let firstChunk = true;

      for await (const chunk of stream) {
        const text = typeof chunk === 'string' ? chunk : String(chunk ?? '');
        if (!text) continue;

        persistedContent += text;
        writeFrame(
          'markdown',
          firstChunk
            ? { messageId, content: text, isChunk: true }
            : { content: text, isChunk: true },
        );
        firstChunk = false;
      }

      // 7. 模型回复落库（上一步是流式，拿不到完整结果，只能边收边攒）
      await this.messageService.addMessage(
        conversationId,
        MessageRole.ASSISTANT,
        persistedContent,
      );

      let newTitle: string | undefined;
      // 触发首轮对话标题总结（若仍为默认标题且回复非空）
      if (shouldUpdateTitle && persistedContent.trim()) {
        newTitle = await this.summarizeAndSetTitle(
          conversationId,
          inputContent,
          persistedContent,
          dto?.modelId,
          userId,
        );
      }

      // 8. meta + done 收尾（通过 meta 帧直接带回最新标题，毫秒级推给前端）
      writeFrame('meta', {
        conversationTitle: newTitle,
        usedAgents: [],
        retrievedDocuments: [],
      });
      writeFrame('done', null);
    } catch (err) {
      this.logger.error(
        `[chat SSE] 会话 ${conversationId} 处理失败`,
        err instanceof Error ? err.stack : String(err),
      );
      writeFrame('error', {
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      if (!res.writableEnded) res.end();
    }
  }

  /**
   * 解析本次对话使用的模型配置
   * 1. 显式传入 modelId：优先按 ID 获取配置；
   * 2. 未传 modelId：优先查找当前用户专属或公开的默认模型 (isDefault = true)；
   * 3. 兜底回退：若数据库无匹配项，返回 null，由调用方回退到 YAML 与 process.env。
   */
  private async resolveModelConfig(modelId?: string, userId?: string) {
    if (modelId) {
      try {
        return await this.modelConfigService.findById(modelId);
      } catch (err) {
        this.logger.warn(
          `模型配置 ${modelId} 不存在，将尝试匹配默认配置：${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    if (userId) {
      try {
        const defaultCfg = await this.modelConfigService.findDefaultByTypeForUser(
          ModelType.general,
          userId,
        );
        if (defaultCfg) return defaultCfg;
      } catch (err) {
        this.logger.warn(
          `获取用户 ${userId} 默认模型失败：${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return null;
  }

  /**
   * 解析本次对话使用的模型
   * - 优先使用数据库 model_configs 表中的对应模型、apiKey、baseUrl 及生成参数
   * - 若无有效配置则回退到 config/langchain.yaml 和本地环境变量
   */
  private async resolveChatModel(modelId?: string, userId?: string) {
    const config = await this.resolveModelConfig(modelId, userId);
    if (!config) {
      this.logger.log('未匹配到数据库模型配置，回退到 config/langchain.yaml 默认模型');
      return createChatModel({ streaming: true });
    }

    const metadata =
      config.metadata && typeof config.metadata === 'object' && !Array.isArray(config.metadata)
        ? (config.metadata as Record<string, any>)
        : {};

    this.logger.log(
      `[对话模型解析] 成功应用数据库模型配置: [${config.name}] model=${config.model}, provider=${config.provider}, baseUrl=${config.baseUrl || 'default'}`,
    );

    return createChatModel({
      modelName: config.model,
      apiKey: config.apiKey || undefined,
      baseUrl: config.baseUrl || undefined,
      temperature: typeof metadata.temperature === 'number' ? metadata.temperature : undefined,
      maxTokens: typeof metadata.maxTokens === 'number' ? metadata.maxTokens : undefined,
      streaming: true,
    });
  }

  /**
   * 后台异步提炼首轮问答标题并更新数据库（非阻塞）
   */
  private async summarizeAndSetTitle(
    conversationId: string,
    userPrompt: string,
    assistantReply: string,
    modelId?: string,
    userId?: string,
  ): Promise<string | undefined> {
    // 预先准备用户输入首句摘要作为安全兜底，确保 100% 具备有效标题
    const fallbackTitle = userPrompt
      .replace(/[\r\n\t]/g, ' ')
      .replace(/["'“”《》`]/g, '')
      .trim()
      .slice(0, 15);

    let extractedTitle = '';

    try {
      const config = await this.resolveModelConfig(modelId, userId);

      // 使用轻量模型配置执行一次性总结，关闭思考模式避免耗尽 token
      const summarizer = createChatModel({
        modelName: config?.model,
        apiKey: config?.apiKey || undefined,
        baseUrl: config?.baseUrl || undefined,
        temperature: 0.3,
        maxTokens: 100,
        streaming: false,
        disableThinking: true,
      });

      const prompt = `你是一个会话标题提炼工具。请根据用户的提问，提取出一个简短精炼的主题标题。
要求：
1. 长度严格在 4 到 10 个中文字符以内。
2. 绝对不要带有标点符号、引号、冒号、序号或任何解释，仅输出标题文字本身。
3. 概括用户核心意图。

用户提问：${userPrompt.slice(0, 200)}

标题：`;

      const response = await summarizer.invoke(prompt);
      const rawTitle =
        typeof response.content === 'string'
          ? response.content
          : String(response.content ?? '');

      extractedTitle = rawTitle
        .replace(/["'“”《》`\r\n\t:：]/g, '')
        .trim()
        .slice(0, 15);
    } catch (err) {
      this.logger.warn(
        `[会话标题生成] 模型提炼标题异常，将使用首句兜底: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const finalTitle = extractedTitle || fallbackTitle;
    if (finalTitle) {
      try {
        await this.conversationService.updateTitle(conversationId, finalTitle);
        this.logger.log(
          `[会话标题生成] 会话 ${conversationId} 标题成功更新为: ${finalTitle}`,
        );
      } catch (dbErr) {
        this.logger.error(`[会话标题生成] 更新标题入库失败: ${dbErr}`);
      }
    }
    return finalTitle;
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
