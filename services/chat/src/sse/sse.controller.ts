import {
  Controller,
  Get,
  Req,
  Res,
  UseGuards,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { SseService } from './sse.service.js';

@Controller('api/sse')
@UseGuards(JwtAuthGuard)
export class SseController {
  private readonly logger = new Logger(SseController.name);

  constructor(private readonly sseService: SseService) {}

  /**
   * 建立 SSE 任务长连接通道
   * 格式: text/event-stream
   * 支持多 Tab 连接与定时心跳保活，连接断开时自动清理
   */
  @Get('tasks')
  connectTasks(
    @CurrentUser('userId') userId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    // 1. 设置 SSE 必备 HTTP 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 2. 注册当前连接至 SseService
    this.sseService.addConnection(userId, res);

    // 3. 发送初始连接成功注释帧
    res.write(': connected\n\n');

    // 4. 设置心跳保活定时器（每 15 秒发送一次 SSE 注释帧）
    const heartbeatTimer = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) {
        res.write(': heartbeat\n\n');
      }
    }, 15000);

    // 5. 监听连接关闭事件，清理定时器并移除连接
    let isCleanedUp = false;
    const cleanup = () => {
      if (isCleanedUp) return;
      isCleanedUp = true;
      clearInterval(heartbeatTimer);
      this.sseService.removeConnection(userId, res);
    };

    req.on('close', cleanup);
    res.on('close', cleanup);
    res.on('finish', cleanup);
    res.on('error', (err) => {
      this.logger.warn(`SSE 连接发生异常 (userId: ${userId}):`, err);
      cleanup();
    });
  }
}
