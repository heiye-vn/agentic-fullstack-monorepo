import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskEventController } from './task-event.controller.js';
import { TaskStatus } from '../prisma/index.js';
import { NotFoundException } from '@nestjs/common';

describe('TaskEventController Unit Tests', () => {
  let controller: TaskEventController;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      taskEvent: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'evt_1',
            userId: 'user_1',
            taskId: 'task_abc',
            taskType: 'document_process',
            status: TaskStatus.done,
            message: '处理完成',
            createdAt: new Date('2026-09-11T10:00:00Z'),
            readAt: null,
          },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    controller = new TaskEventController(mockPrisma as any);
  });

  describe('GET /api/tasks/history', () => {
    it('应该正确返回分页数据并强制按 userId 过滤', async () => {
      const res = await controller.getHistory('user_1', '1', '10', 'document_process', TaskStatus.done);

      expect(mockPrisma.taskEvent.count).toHaveBeenCalledWith({
        where: {
          userId: 'user_1',
          taskType: 'document_process',
          status: TaskStatus.done,
        },
      });

      expect(mockPrisma.taskEvent.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user_1',
          taskType: 'document_process',
          status: TaskStatus.done,
        },
        skip: 0,
        take: 10,
        orderBy: { createdAt: 'desc' },
      });

      expect(res.total).toBe(1);
      expect(res.page).toBe(1);
      expect(res.pageSize).toBe(10);
      expect(res.items.length).toBe(1);
    });
  });

  describe('GET /api/tasks/:taskId', () => {
    it('查询存在任务时应返回任务事件详情及最新状态', async () => {
      const res = await controller.getTaskEvents('user_1', 'task_abc');

      expect(mockPrisma.taskEvent.findMany).toHaveBeenCalledWith({
        where: {
          taskId: 'task_abc',
          userId: 'user_1',
        },
        orderBy: { createdAt: 'asc' },
      });

      expect(res.taskId).toBe('task_abc');
      expect(res.status).toBe(TaskStatus.done);
      expect(res.events.length).toBe(1);
    });

    it('无记录时应该抛出 NotFoundException', async () => {
      mockPrisma.taskEvent.findMany.mockResolvedValueOnce([]);

      await expect(
        controller.getTaskEvents('user_1', 'non_existent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('PATCH /api/tasks/:taskId/read', () => {
    it('应该更新未读记录的 readAt 字段并返回更新数量', async () => {
      const res = await controller.markAsRead('user_1', 'task_abc');

      expect(mockPrisma.taskEvent.updateMany).toHaveBeenCalledWith({
        where: {
          taskId: 'task_abc',
          userId: 'user_1',
          readAt: null,
        },
        data: {
          readAt: expect.any(Date),
        },
      });

      expect(res).toEqual({
        success: true,
        taskId: 'task_abc',
        updatedCount: 1,
      });
    });
  });
});
