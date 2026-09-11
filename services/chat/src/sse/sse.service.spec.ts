import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SseService } from './sse.service.js';
import { TaskStatus } from '../prisma/index.js';

describe('SseService Unit Tests', () => {
  let sseService: SseService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      taskEvent: {
        create: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'evt_123',
            createdAt: new Date(),
            readAt: null,
            ...data,
          }),
        ),
        deleteMany: vi.fn().mockResolvedValue({ count: 5 }),
      },
    };

    sseService = new SseService(mockPrisma as any);
  });

  describe('连接池管理 (多 Tab 支持)', () => {
    it('应该能够成功添加连接并支持同一用户多个连接', () => {
      const mockRes1: any = {
        writableEnded: false,
        destroyed: false,
        write: vi.fn(),
      };
      const mockRes2: any = {
        writableEnded: false,
        destroyed: false,
        write: vi.fn(),
      };

      sseService.addConnection('user_1', mockRes1);
      sseService.addConnection('user_1', mockRes2);

      const connections = sseService.getConnections('user_1');
      expect(connections).toBeDefined();
      expect(connections?.size).toBe(2);
      expect(connections?.has(mockRes1)).toBe(true);
      expect(connections?.has(mockRes2)).toBe(true);
    });

    it('移除单个连接后，另一个连接应仍然保持', () => {
      const mockRes1: any = { write: vi.fn() };
      const mockRes2: any = { write: vi.fn() };

      sseService.addConnection('user_1', mockRes1);
      sseService.addConnection('user_1', mockRes2);

      sseService.removeConnection('user_1', mockRes1);
      const connections = sseService.getConnections('user_1');
      expect(connections?.size).toBe(1);
      expect(connections?.has(mockRes2)).toBe(true);
    });

    it('当用户所有连接断开时，应该从 Map 中清理该用户的 entry', () => {
      const mockRes: any = { write: vi.fn() };

      sseService.addConnection('user_1', mockRes);
      expect(sseService.getConnections('user_1')).toBeDefined();

      sseService.removeConnection('user_1', mockRes);
      expect(sseService.getConnections('user_1')).toBeUndefined();
    });
  });

  describe('emit (先持久化再推送)', () => {
    it('应该先调用 Prisma 持久化到 task_events，再向所有在线连接推送数据', async () => {
      const mockRes1: any = {
        writableEnded: false,
        destroyed: false,
        write: vi.fn(),
      };
      const mockRes2: any = {
        writableEnded: false,
        destroyed: false,
        write: vi.fn(),
      };

      sseService.addConnection('user_1', mockRes1);
      sseService.addConnection('user_1', mockRes2);

      const eventPayload = {
        taskId: 'doc_1',
        taskType: 'document_process',
        status: TaskStatus.processing,
        message: '处理中',
        metadata: { filename: 'test.pdf' },
      };

      const result = await sseService.emit('user_1', eventPayload);

      // 验证 Prisma 持久化调用
      expect(mockPrisma.taskEvent.create).toHaveBeenCalledWith({
        data: {
          userId: 'user_1',
          taskId: 'doc_1',
          taskType: 'document_process',
          status: TaskStatus.processing,
          message: '处理中',
          metadata: { filename: 'test.pdf' },
        },
      });

      // 验证推送内容格式为 SSE 标准 data: {...}\n\n
      expect(mockRes1.write).toHaveBeenCalledTimes(1);
      expect(mockRes2.write).toHaveBeenCalledTimes(1);

      const writtenData = mockRes1.write.mock.calls[0][0];
      expect(writtenData).toContain('data: ');
      expect(writtenData).toContain('"taskId":"doc_1"');
      expect(writtenData.endsWith('\n\n')).toBe(true);

      expect(result.id).toBe('evt_123');
    });

    it('写入异常或已关闭连接时应平滑移除，不影响其他连接和主流程', async () => {
      const mockResDead: any = {
        writableEnded: true,
        destroyed: false,
        write: vi.fn(),
      };
      const mockResAlive: any = {
        writableEnded: false,
        destroyed: false,
        write: vi.fn(),
      };

      sseService.addConnection('user_1', mockResDead);
      sseService.addConnection('user_1', mockResAlive);

      await sseService.emit('user_1', {
        taskId: 'doc_1',
        taskType: 'document_process',
        status: TaskStatus.done,
      });

      expect(mockResDead.write).not.toHaveBeenCalled();
      expect(mockResAlive.write).toHaveBeenCalledTimes(1);
      expect(sseService.getConnections('user_1')?.size).toBe(1);
    });
  });

  describe('定期清理调度', () => {
    it('cleanOfflineConnections 应该剔除已关闭的连接并释放空 entry', () => {
      const mockDeadRes: any = {
        writableEnded: true,
        destroyed: true,
        socket: { destroyed: true },
      };

      sseService.addConnection('user_offline', mockDeadRes);
      expect(sseService.getConnections('user_offline')?.size).toBe(1);

      sseService.cleanOfflineConnections();
      expect(sseService.getConnections('user_offline')).toBeUndefined();
    });

    it('cleanExpiredTaskEvents 应该调用 deleteMany 清除 30 天前的记录', async () => {
      await sseService.cleanExpiredTaskEvents();
      expect(mockPrisma.taskEvent.deleteMany).toHaveBeenCalled();
      const callArg = mockPrisma.taskEvent.deleteMany.mock.calls[0][0];
      expect(callArg.where.createdAt.lt).toBeInstanceOf(Date);
    });
  });
});
