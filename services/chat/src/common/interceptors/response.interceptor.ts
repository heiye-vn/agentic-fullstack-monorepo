import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { Response } from 'express';
import type { ApiResponse } from '@autix/types';
import { getTraceId } from '../../observability/index.js';

/**
 * 必须原样输出的端点：这些响应体不是业务 JSON，被包进 { success, code, data } 就废了。
 * 典型受害者是 /metrics —— Prometheus 只认 `# HELP/# TYPE/指标行` 的纯文本，
 * 拿到包了一层壳的 JSON 会直接抓取失败（且失败是静默的：HTTP 200，指标为空）。
 */
const RAW_RESPONSE_PATHS = new Set(['/metrics']);

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const httpContext = context.switchToHttp();
    const response = httpContext.getResponse<Response>();
    const request = httpContext.getRequest<{ path?: string }>();

    // 关键：若响应头已发送（如 SSE 长连接或流式响应），或声明为 text/event-stream，则跳过包装
    if (
      response.headersSent ||
      response.getHeader('content-type')?.toString().includes('text/event-stream')
    ) {
      return next.handle();
    }

    // 非 JSON 的裸响应端点同样跳过包装
    if (request.path && RAW_RESPONSE_PATHS.has(request.path)) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        // 若在流式传输过程中响应头已被写入发送，直接返回原始数据
        if (response.headersSent) {
          return data;
        }

        // 第十六章：复用 TraceMiddleware 在请求入口建立的 traceId。
        // 改造前这里自己 randomUUID()，与异常过滤器各生成一个互不关联的 ID，
        // 前端拿到 traceId 反而在服务端日志里检索不到。
        const traceId = getTraceId();
        if (!response.getHeader('x-trace-id')) {
          response.setHeader('x-trace-id', traceId);
        }

        // 防二次包装保护：若数据已具备 success 属性（如已封装或直接返回的 ApiResponse），则直接透传
        if (data && typeof data === 'object' && 'success' in data) {
          return data;
        }

        return {
          success: true,
          code: '200',
          msg: '请求成功',
          traceId,
          data: data !== undefined ? data : null,
        } as ApiResponse;
      }),
    );
  }
}
