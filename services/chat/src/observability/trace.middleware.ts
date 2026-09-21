/**
 * trace.middleware.ts
 *
 * NestJS 中间件：在每个请求入口
 * 1. 复用上游传来的 x-trace-id（便于跨服务/前端串联），没有则新建一个
 * 2. 用 runWithTrace 建立 ALS 上下文，包住整个请求处理链（含之后的 SSE 流）
 * 3. 把 traceId 回写到响应头 x-trace-id（前端与网关可见）
 * 4. 请求结束时打一条 access 日志（含 status、elapsedMs）并记录耗时直方图
 *
 * 两个刻意的细节：
 * - SSE 长连接单独计时（sse_stream_duration_seconds），不混进 HTTP 直方图。
 *   否则每条 SSE 都落进 +Inf 桶，P99 会被彻底带偏。
 * - 路由 label 走 normalizeRoute() 归一化，避免 /api/conversations/<uuid>/chat
 *   给每个会话造一条时间序列（label 高基数会让 Prometheus 内存爆炸）。
 */
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { runWithTrace, newTraceId, peekTraceStore } from './trace-context.js';
import { createLogger } from './logger.js';
import { httpDuration, normalizeRoute, sseStreamDuration } from './metrics.js';

const accessLog = createLogger('http');

/** 探针端点自身不打点，否则抓取频率会盖过业务流量 */
const QUIET_PATHS = new Set(['/metrics', '/ready', '/health']);

@Injectable()
export class TraceMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-trace-id'];
    const traceId = (typeof incoming === 'string' && incoming) || newTraceId();

    runWithTrace(traceId, () => {
      // 先把 store 引用捕获下来：finish 阶段直接用它的字段算耗时、取 traceId，
      // 不依赖「ALS 上下文能否传播到 res 的 finish 回调」这种隐晦前提
      const store = peekTraceStore();

      res.setHeader('x-trace-id', traceId);
      accessLog.debug({ method: req.method, path: req.path }, 'http_request_start');

      res.on('finish', () => {
        const elapsedMs = store ? Date.now() - store.startedAt : 0;
        const status = res.statusCode;
        const route = normalizeRoute(
          ((req as any).route?.path as string | undefined) ?? req.path,
        );

        if (QUIET_PATHS.has(req.path)) return;

        // SSE：finish 在客户端断开时才触发，elapsedMs 是整条流的存活时长
        if (String(res.getHeader('content-type') ?? '').includes('text/event-stream')) {
          sseStreamDuration.observe(elapsedMs / 1000);
          accessLog.info(
            {
              traceId: store?.traceId ?? traceId,
              method: req.method,
              path: req.path,
              route,
              status,
              elapsedMs,
              kind: 'sse',
            },
            'sse_stream_end',
          );
          return;
        }

        httpDuration.observe(
          { method: req.method, route, status: String(status) },
          elapsedMs / 1000,
        );
        accessLog.info(
          {
            traceId: store?.traceId ?? traceId,
            method: req.method,
            path: req.path,
            route,
            status,
            elapsedMs,
          },
          'http_request',
        );
      });

      next();
    });
  }
}
