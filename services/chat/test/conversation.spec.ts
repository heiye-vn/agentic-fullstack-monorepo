import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { RunnableWithMessageHistory } from '@langchain/core/runnables';
import { FakeListChatModel } from '@langchain/core/utils/testing';

import { PrismaService } from '../src/prisma/prisma.service.js';
import { MessageRole } from '../src/prisma/index.js';
import { MessageService } from '../src/message/message.service.js';
import { DbChatMessageHistory } from '../src/message/db-chat-history.js';
import { ConversationService } from '../src/conversation/conversation.service.js';

describe('PostgreSQL Chat History & Conversation Integration Tests', () => {
  let prisma: PrismaService;
  let messageService: MessageService;
  let conversationService: ConversationService;

  const userA = 'test_user_a_' + Date.now();
  const userB = 'test_user_b_' + Date.now();
  let conversationAId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    messageService = new MessageService(prisma);
    conversationService = new ConversationService(prisma);
  });

  afterAll(async () => {
    // 清理测试会话及级联消息
    if (conversationAId) {
      await prisma.conversation.deleteMany({
        where: { id: conversationAId },
      });
    }
    await prisma.$disconnect();
  });

  describe('1. ConversationService CRUD & 权限隔离校验', () => {
    it('应该能为 User A 成功创建会话', async () => {
      const conv = await conversationService.create(userA, '测试会话-A');
      expect(conv).toBeDefined();
      expect(conv.id).toBeDefined();
      expect(conv.userId).toBe(userA);
      expect(conv.title).toBe('测试会话-A');
      conversationAId = conv.id;
    });

    it('应该能查询出 User A 的会话列表，且不包含 User B 的会话', async () => {
      // 为 User B 创建一个会话
      const convB = await conversationService.create(userB, '测试会话-B');

      const listA = await conversationService.findByUser(userA);
      expect(listA.some((c) => c.id === conversationAId)).toBe(true);
      expect(listA.some((c) => c.id === convB.id)).toBe(false);

      // 清理 User B 会话
      await prisma.conversation.delete({ where: { id: convB.id } });
    });

    it('User A 应该可以正常查询自己的会话详情', async () => {
      const conv = await conversationService.findById(conversationAId, userA);
      expect(conv.id).toBe(conversationAId);
      expect(conv.userId).toBe(userA);
    });

    it('User B 尝试查询 User A 的会话应该抛出 403 ForbiddenException 越权拒绝', async () => {
      await expect(
        conversationService.findById(conversationAId, userB),
      ).rejects.toThrow(ForbiddenException);
    });

    it('查询不存在的会话应该抛出 404 NotFoundException', async () => {
      await expect(
        conversationService.findById('non_existing_conv_id', userA),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('2. MessageService & DbChatMessageHistory 角色映射与持久化', () => {
    it('应该能通过 MessageService 向数据库添加消息并获取历史', async () => {
      const msg = await messageService.addMessage(
        conversationAId,
        MessageRole.USER,
        '你好，这是测试第一条消息',
      );
      expect(msg.id).toBeDefined();
      expect(msg.role).toBe(MessageRole.USER);
      expect(msg.content).toBe('你好，这是测试第一条消息');

      const history = await messageService.getHistory(conversationAId);
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].content).toBe('你好，这是测试第一条消息');
    });

    it('DbChatMessageHistory 应该严格执行角色映射：HumanMessage -> USER，其余 -> ASSISTANT', async () => {
      const history = new DbChatMessageHistory(conversationAId, messageService);

      // 1. 写入 HumanMessage
      await history.addMessage(new HumanMessage('人类用户提问'));
      // 2. 写入 AIMessage
      await history.addMessage(new AIMessage('AI模型助手回复'));
      // 3. 写入 SystemMessage (按规则映射为 ASSISTANT)
      await history.addMessage(new SystemMessage('系统设定提示词'));

      // 从数据库直接校验 messages 表中的记录角色
      const messagesInDb = await prisma.message.findMany({
        where: { conversationId: conversationAId },
        orderBy: { createdAt: 'desc' },
        take: 3,
      });

      // 倒序取的3条应该对应上面写入的 3 条
      const sysMsg = messagesInDb.find((m) => m.content === '系统设定提示词');
      const aiMsg = messagesInDb.find((m) => m.content === 'AI模型助手回复');
      const humanMsg = messagesInDb.find((m) => m.content === '人类用户提问');

      expect(humanMsg?.role).toBe(MessageRole.USER);
      expect(aiMsg?.role).toBe(MessageRole.ASSISTANT);
      expect(sysMsg?.role).toBe(MessageRole.ASSISTANT);
    });

    it('DbChatMessageHistory.getMessages() 应该正确返回 BaseMessage 数组', async () => {
      const history = new DbChatMessageHistory(conversationAId, messageService);
      const messages = await history.getMessages();
      expect(Array.isArray(messages)).toBe(true);
      expect(messages.length).toBeGreaterThanOrEqual(3);

      const lastHuman = messages.find((m) => m.content === '人类用户提问');
      const lastAi = messages.find((m) => m.content === 'AI模型助手回复');
      expect(lastHuman).toBeInstanceOf(HumanMessage);
      expect(lastAi).toBeInstanceOf(AIMessage);
    });
  });

  describe('3. RunnableWithMessageHistory 与 PostgreSQL 持久化完整链路', () => {
    it('应该与 LangChain RunnableWithMessageHistory 无缝协同，自动保存问答历史到数据库', async () => {
      // 1. 创建用于测试的新独立会话
      const conv = await conversationService.create(userA, 'Runnable-History-测试');

      // 2. 准备 Prompt 与 Mock LLM
      const prompt = ChatPromptTemplate.fromMessages([
        ['system', '你是一个全栈助手。'],
        new MessagesPlaceholder('history'),
        ['human', '{input}'],
      ]);

      const mockModel = new FakeListChatModel({
        responses: ['这是Mock生成的AI回复第一轮', '这是Mock生成的AI回复第二轮'],
      });

      const chain = prompt.pipe(mockModel);

      // 3. 包装 RunnableWithMessageHistory，使用基于 PostgreSQL 的 DbChatMessageHistory
      const chainWithHistory = new RunnableWithMessageHistory({
        runnable: chain,
        getMessageHistory: (sessionId: string) => {
          return new DbChatMessageHistory(sessionId, messageService);
        },
        inputMessagesKey: 'input',
        historyMessagesKey: 'history',
      });

      // 4. 第一轮提问
      const res1 = await chainWithHistory.invoke(
        { input: '你好，我是测试用户。' },
        { configurable: { sessionId: conv.id } },
      );
      expect(res1.content).toBe('这是Mock生成的AI回复第一轮');

      // 5. 验证数据库中已经自动落库 2 条记录（1 条 USER，1 条 ASSISTANT）
      const recordsRound1 = await messageService.getHistory(conv.id);
      expect(recordsRound1.length).toBe(2);
      expect(recordsRound1[0].role).toBe(MessageRole.USER);
      expect(recordsRound1[0].content).toBe('你好，我是测试用户。');
      expect(recordsRound1[1].role).toBe(MessageRole.ASSISTANT);
      expect(recordsRound1[1].content).toBe('这是Mock生成的AI回复第一轮');

      // 6. 第二轮提问，验证上一轮历史自动生效
      const res2 = await chainWithHistory.invoke(
        { input: '第二轮问题' },
        { configurable: { sessionId: conv.id } },
      );
      expect(res2.content).toBe('这是Mock生成的AI回复第二轮');

      // 7. 再次验证数据库已有 4 条记录
      const recordsRound2 = await messageService.getHistory(conv.id);
      expect(recordsRound2.length).toBe(4);

      // 8. 测试删除会话：验证级联删除（PostgreSQL 会自动把 messages 删除）
      await conversationService.delete(conv.id, userA);

      const afterDeleteConv = await prisma.conversation.findUnique({
        where: { id: conv.id },
      });
      expect(afterDeleteConv).toBeNull();

      const afterDeleteMsgs = await prisma.message.findMany({
        where: { conversationId: conv.id },
      });
      expect(afterDeleteMsgs.length).toBe(0);
    });
  });
});
