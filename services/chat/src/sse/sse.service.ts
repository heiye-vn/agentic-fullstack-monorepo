import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import type { EmitTaskEventInput } from './dto/task-event.dto.js';
import type { TaskEvent } from '../prisma/index.js';

@Injectable()
export class SseService {
  private readonly logger = new Logger(SseService.name);

  /**
   * 维护用户与 SSE 响应对象的映射集合
   * 支持同一 userId 存在多个标签页 (Tab) 共享推送
   */
  private readonly connections = new Map<string, Set<Response>>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 注册用户 SSE 连接
   * @param userId 用户 ID
   * @param res Express Response 对象
   */
  addConnection(userId: string, res: Response): void {
    let userConnections = this.connections.get(userId);
    if (!userConnections) {
      userConnections = new Set<Response>();
      this.connections.set(userId, userConnections);
    }
    userConnections.add(res);

    this.logger.log(
      `用户 [${userId}] 新增 SSE 连接，当前该用户在线连接数: ${userConnections.size}`,
    );
  }

  /**
   * 移除用户 SSE 连接
   * @param userId 用户 ID
   * @param res Express Response 对象
   */
  removeConnection(userId: string, res: Response): void {
    const userConnections = this.connections.get(userId);
    if (userConnections) {
      userConnections.delete(res);
      this.logger.log(
        `用户 [${userId}] 断开 SSE 连接，剩余连接数: ${userConnections.size}`,
      );

      // 若该用户已无活动连接，清理 Map 键以释放内存
      if (userConnections.size === 0) {
        this.connections.delete(userId);
      }
    }
  }

  /**
   * 获取指定用户当前活跃的连接集合（主要用于测试与监控）
   * @param userId 用户 ID
   */
  getConnections(userId: string): Set<Response> | undefined {
    return this.connections.get(userId);
  }

  /**
   * 触发任务事件：先持久化到 task_events 表，再实时推送给该用户所有在线连接
   * @param userId 用户 ID
   * @param event 任务事件参数
   */
  async emit(userId: string, event: EmitTaskEventInput): Promise<TaskEvent> {
    // 1. 持久化到 task_events 表
    const record = await this.prisma.taskEvent.create({
      data: {
        userId,
        taskId: event.taskId,
        taskType: event.taskType,
        status: event.status,
        message: event.message ?? null,
        metadata: event.metadata ?? undefined,
      },
    });

    // 2. 实时推送给在线连接
    const userConnections = this.connections.get(userId);
    if (userConnections && userConnections.size > 0) {
      const payload = `data: ${JSON.stringify(record)}\n\n`;

      for (const res of userConnections) {
        try {
          if (!res.writableEnded && !res.destroyed) {
            res.write(payload);
          } else {
            userConnections.delete(res);
          }
        } catch (error) {
          this.logger.warn(
            `向用户 [${userId}] 推送 SSE 数据异常，移除失效连接:`,
            error,
          );
          userConnections.delete(res);
        }
      }

      if (userConnections.size === 0) {
        this.connections.delete(userId);
      }
    }

    return record;
  }

  /**
   * 定期清理离线连接与失效 entry（每 10 分钟执行一次）
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  cleanOfflineConnections(): void {
    let removedCount = 0;

    for (const [userId, userConnections] of this.connections.entries()) {
      for (const res of userConnections) {
        if (res.writableEnded || res.destroyed || res.socket?.destroyed) {
          userConnections.delete(res);
          removedCount++;
        }
      }

      if (userConnections.size === 0) {
        this.connections.delete(userId);
      }
    }

    if (removedCount > 0) {
      this.logger.log(
        `定期清理离线连接完成，共清理 ${removedCount} 个离线连接`,
      );
    }
  }

  /**
   * 定期清理 30 天前的历史 task_events 记录（每天午夜 00:00 执行）
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanExpiredTaskEvents(): Promise<void> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    try {
      const result = await this.prisma.taskEvent.deleteMany({
        where: {
          createdAt: {
            lt: thirtyDaysAgo,
          },
        },
      });

      this.logger.log(
        `定期清理过期任务事件完成，共删除 30 天前的记录 ${result.count} 条`,
      );
    } catch (error) {
      this.logger.error('清理过期任务事件失败:', error);
    }
  }
}
