import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { MessageRole, TaskStatus } from '../src/prisma/index.js';

describe('PrismaService & Schema Integration Test', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('应该成功连接 PostgreSQL 并执行基础查询', async () => {
    const result = await prisma.$queryRaw<Array<{ result: number }>>`SELECT 1 as result`;
    expect(result).toBeDefined();
    expect(result.length).toBe(1);
    expect(Number(result[0].result)).toBe(1);
  });

  it('应该确认 vector 扩展已在数据库中正确加载', async () => {
    const ext = await prisma.$queryRaw<Array<{ extname: string }>>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'
    `;
    expect(ext).toBeDefined();
    expect(ext.length).toBe(1);
    expect(ext[0].extname).toBe('vector');
  });

  it('应该支持 Conversation 与 Message 级联操作', async () => {
    const testUserId = 'test_user_' + Date.now();

    // 1. 创建会话
    const conversation = await prisma.conversation.create({
      data: {
        userId: testUserId,
        title: '测试会话',
      },
    });
    expect(conversation.id).toBeDefined();
    expect(conversation.title).toBe('测试会话');

    // 2. 创建消息
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: MessageRole.USER,
        content: '你好，测试消息',
        metadata: { source: 'unit-test' },
      },
    });
    expect(message.id).toBeDefined();
    expect(message.role).toBe(MessageRole.USER);

    // 3. 查询会话包含消息
    const found = await prisma.conversation.findUnique({
      where: { id: conversation.id },
      include: { messages: true },
    });
    expect(found?.messages.length).toBe(1);
    expect(found?.messages[0].content).toBe('你好，测试消息');

    // 4. 删除会话应级联删除消息 (onDelete: Cascade)
    await prisma.conversation.delete({
      where: { id: conversation.id },
    });

    const deletedMessage = await prisma.message.findUnique({
      where: { id: message.id },
    });
    expect(deletedMessage).toBeNull();
  });

  it('应该支持 Document 与 DocumentChunk 级联操作', async () => {
    const testUserId = 'test_doc_user_' + Date.now();

    // 1. 创建文档
    const document = await prisma.document.create({
      data: {
        userId: testUserId,
        filename: 'test.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        storageType: 'local',
        status: 'processing',
        chunkCount: 1,
      },
    });
    expect(document.id).toBeDefined();

    // 2. 创建切片
    const chunk = await prisma.documentChunk.create({
      data: {
        documentId: document.id,
        content: '这是文档的切片内容',
        chunkIndex: 0,
      },
    });
    expect(chunk.id).toBeDefined();

    // 3. 删除文档级联删除切片
    await prisma.document.delete({
      where: { id: document.id },
    });

    const deletedChunk = await prisma.documentChunk.findUnique({
      where: { id: chunk.id },
    });
    expect(deletedChunk).toBeNull();
  });

  it('应该支持 TaskEvent 创建与状态流转', async () => {
    const testUserId = 'test_task_user_' + Date.now();
    const taskId = 'task_' + Date.now();

    const event = await prisma.taskEvent.create({
      data: {
        userId: testUserId,
        taskType: 'document_embedding',
        taskId: taskId,
        status: TaskStatus.pending,
        message: '任务排队中',
        metadata: { priority: 'high' },
      },
    });
    expect(event.id).toBeDefined();
    expect(event.status).toBe(TaskStatus.pending);

    // 更新状态
    const updated = await prisma.taskEvent.update({
      where: { id: event.id },
      data: {
        status: TaskStatus.done,
        message: '处理完成',
        readAt: new Date(),
      },
    });
    expect(updated.status).toBe(TaskStatus.done);
    expect(updated.readAt).toBeDefined();

    // 清理测试数据
    await prisma.taskEvent.delete({
      where: { id: event.id },
    });
  });
});
