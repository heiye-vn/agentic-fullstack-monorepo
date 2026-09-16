import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableWithMessageHistory } from '@langchain/core/runnables';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RunnableMemoryService } from '../src/llm/memory/runnable-memory.service.js';
import { OrchestratorService } from '../src/llm/agents/orchestrator.service.js';
import { SearchService } from '../src/document/search.service.js';
import { ConversationService } from '../src/conversation/conversation.service.js';
import { DbChatMessageHistory } from '../src/message/db-chat-history.js';
import { MessageRole } from '../src/prisma/index.js';

describe('ConversationController E2E / API Tests', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let prisma: PrismaService;
  let runnableMemoryService: RunnableMemoryService;
  let orchestratorService: OrchestratorService;
  let searchService: SearchService;

  // 整个 spec 的底线：**绝不触发外部真实模型调用**。
  // chat 接口的链路是「RAG 检索 → 编排管道 → 编排无产出时回退普通对话链」，
  // 每个环节默认都会打真实的 embedding / LLM，所以必须逐层 mock。
  const jwtSecret =
    process.env.JWT_SECRET || 'autix_rbac_jwt_secret_key_2026_super_secure';

  const user1 = { sub: 'e2e_user_1', username: 'alice' };
  const user2 = { sub: 'e2e_user_2', username: 'bob' };

  let user1Token: string;
  let user2Token: string;
  let createdConvId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    jwtService = app.get(JwtService);
    prisma = app.get(PrismaService);
    runnableMemoryService = app.get(RunnableMemoryService);
    orchestratorService = app.get(OrchestratorService);
    searchService = app.get(SearchService);

    // RAG 检索：跳过本地 embedding 模型预热与 pgvector 查询，走「无命中」分支
    vi.spyOn(searchService, 'similaritySearch').mockResolvedValue([]);

    // 编排管道：产出零事件，让 ChatStreamService 判定「管道无内容」从而走下面的兜底链。
    // 这样既覆盖了 SSE 帧协议与消息落库，又不会真的去跑多 Agent 多轮 LLM。
    vi.spyOn(orchestratorService, 'streamOrchestrate').mockImplementation(
      async function* () {
        /* intentionally emits nothing */
      },
    );

    // Mock createRunnableWithDbHistory 与 createStandardChain 避免调用外部真实 OpenAI API
    vi.spyOn(runnableMemoryService, 'createStandardChain').mockImplementation(() => {
      return {
        stream: async function* () {
          yield '这是 Controller E2E Mock 的回复内容';
        },
      } as any;
    });

    vi.spyOn(runnableMemoryService, 'createRunnableWithDbHistory').mockImplementation(
      (msgService) => {
        const prompt = ChatPromptTemplate.fromMessages([
          ['system', '你是一个全栈助手。'],
          new MessagesPlaceholder('history'),
          ['human', '{input}'],
        ]);
        const mockModel = new FakeListChatModel({
          responses: ['这是 Controller E2E Mock 的回复内容'],
        });
        const chain = prompt.pipe(mockModel).pipe(new StringOutputParser());

        return new RunnableWithMessageHistory({
          runnable: chain,
          getMessageHistory: (sessionId: string) =>
            new DbChatMessageHistory(sessionId, msgService),
          inputMessagesKey: 'input',
          historyMessagesKey: 'history',
        });
      },
    );

    user1Token = jwtService.sign(user1, { secret: jwtSecret });
    user2Token = jwtService.sign(user2, { secret: jwtSecret });
  });

  afterAll(async () => {
    if (createdConvId) {
      await prisma.conversation.deleteMany({
        where: { id: createdConvId },
      });
    }
    await app.close();
  });

  it('未携带 Token 访问受保护路由应该返回 401 Unauthorized', async () => {
    await request(app.getHttpServer())
      .get('/api/conversations')
      .expect(401);
  });

  it('携带非法 Token 访问应该返回 401 Unauthorized', async () => {
    await request(app.getHttpServer())
      .get('/api/conversations')
      .set('Authorization', 'Bearer invalid_token_123456')
      .expect(401);
  });

  it('POST /api/conversations 应该成功为 Alice 创建会话', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/conversations')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ title: 'Alice 的第一场对话' })
      .expect(201);

    expect(res.body.id).toBeDefined();
    createdConvId = res.body.id;
    expect(res.body.title).toBe('Alice 的第一场对话');
    expect(res.body.userId).toBe(user1.sub);
  });

  it('GET /api/conversations 应该返回当前用户 Alice 的会话列表', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/conversations')
      .set('Authorization', `Bearer ${user1Token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((c: { id: string }) => c.id === createdConvId)).toBe(true);
  });

  it('GET /api/conversations/:id/messages 应该返回当前会话的消息列表（初始为空）', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/conversations/${createdConvId}/messages`)
      .set('Authorization', `Bearer ${user1Token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });

  it('Bob (User 2) 尝试获取 Alice 的会话消息应该返回 403 Forbidden', async () => {
    await request(app.getHttpServer())
      .get(`/api/conversations/${createdConvId}/messages`)
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(403);
  });

  it('POST /api/conversations/:id/chat 应该能在会话中流式对话并自动将两端消息持久化至 PostgreSQL', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/conversations/${createdConvId}/chat`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ message: '你好，请帮我生成一个功能' })
      .expect(201);

    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('markdown');
    expect(res.text).toContain('done');

    // 校验 PostgreSQL messages 表中真实落库了两条记录 (USER 和 ASSISTANT)
    const messages = await prisma.message.findMany({
      where: { conversationId: createdConvId },
      orderBy: { createdAt: 'asc' },
    });

    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe(MessageRole.USER);
    expect(messages[0].content).toBe('你好，请帮我生成一个功能');
    expect(messages[1].role).toBe(MessageRole.ASSISTANT);
    expect(messages[1].content).toBe('这是 Controller E2E Mock 的回复内容');
  });

  it('ConversationService 应该能够成功更新会话标题', async () => {
    const conversationService = app.get(ConversationService);
    const updated = await conversationService.updateTitle(createdConvId, '自动化提炼的新标题');
    expect(updated.title).toBe('自动化提炼的新标题');

    const inDb = await prisma.conversation.findUnique({ where: { id: createdConvId } });
    expect(inDb?.title).toBe('自动化提炼的新标题');
  });

  it('Bob (User 2) 尝试向 Alice 的会话发送消息应该返回 403 Forbidden', async () => {
    await request(app.getHttpServer())
      .post(`/api/conversations/${createdConvId}/chat`)
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ message: '恶意尝试越权发送' })
      .expect(403);
  });

  it('DELETE /api/conversations/:id 应该成功删除会话及其级联消息', async () => {
    await request(app.getHttpServer())
      .delete(`/api/conversations/${createdConvId}`)
      .set('Authorization', `Bearer ${user1Token}`)
      .expect(200);

    // 确认已删除
    const checkConv = await prisma.conversation.findUnique({
      where: { id: createdConvId },
    });
    expect(checkConv).toBeNull();

    const checkMsgs = await prisma.message.findMany({
      where: { conversationId: createdConvId },
    });
    expect(checkMsgs.length).toBe(0);

    createdConvId = '';
  });
});
