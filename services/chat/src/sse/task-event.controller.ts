import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TaskStatus } from '../prisma/index.js';

@Controller('api/tasks')
@UseGuards(JwtAuthGuard)
export class TaskEventController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 分页查询当前用户的任务事件历史
   * GET /api/tasks/history?page=1&pageSize=10&taskType=document_process&status=done
   */
  @Get('history')
  async getHistory(
    @CurrentUser('userId') userId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('taskType') taskType?: string,
    @Query('status') status?: TaskStatus,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const pageSizeNum = Math.min(
      100,
      Math.max(1, parseInt(pageSize || '10', 10) || 10),
    );
    const skip = (pageNum - 1) * pageSizeNum;

    const whereCondition: {
      userId: string;
      taskType?: string;
      status?: TaskStatus;
    } = {
      userId,
    };

    if (taskType) {
      whereCondition.taskType = taskType;
    }

    if (status && Object.values(TaskStatus).includes(status)) {
      whereCondition.status = status;
    }

    const [total, items] = await Promise.all([
      this.prisma.taskEvent.count({
        where: whereCondition,
      }),
      this.prisma.taskEvent.findMany({
        where: whereCondition,
        skip,
        take: pageSizeNum,
        orderBy: {
          createdAt: 'desc',
        },
      }),
    ]);

    return {
      total,
      page: pageNum,
      pageSize: pageSizeNum,
      totalPages: Math.ceil(total / pageSizeNum),
      items,
    };
  }

  /**
   * 获取指定任务的事件记录详情
   * GET /api/tasks/:taskId
   */
  @Get(':taskId')
  async getTaskEvents(
    @CurrentUser('userId') userId: string,
    @Param('taskId') taskId: string,
  ) {
    const events = await this.prisma.taskEvent.findMany({
      where: {
        taskId,
        userId,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (!events || events.length === 0) {
      throw new NotFoundException(`未找到任务 ID 为 ${taskId} 的事件记录`);
    }

    const latest = events[events.length - 1];

    return {
      taskId,
      status: latest.status,
      latestMessage: latest.message,
      readAt: latest.readAt,
      createdAt: events[0].createdAt,
      updatedAt: latest.createdAt,
      events,
    };
  }

  /**
   * 将指定任务事件标记为已读
   * PATCH /api/tasks/:taskId/read
   */
  @Patch(':taskId/read')
  async markAsRead(
    @CurrentUser('userId') userId: string,
    @Param('taskId') taskId: string,
  ) {
    const result = await this.prisma.taskEvent.updateMany({
      where: {
        taskId,
        userId,
        readAt: null,
      },
      data: {
        readAt: new Date(),
      },
    });

    return {
      success: true,
      taskId,
      updatedCount: result.count,
    };
  }
}
