import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { Request, Response } from 'express';
import type { ApiResponse } from '@autix/types';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const httpContext = context.switchToHttp();
    const response = httpContext.getResponse<Response>();
    const request = httpContext.getRequest<Request>();

    // 关键：若响应头已发送（如 SSE 长连接或流式响应），或声明为 text/event-stream，则跳过包装
    if (
      response.headersSent ||
      response.getHeader('content-type')?.toString().includes('text/event-stream')
    ) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        // 若在流式传输过程中响应头已被写入发送，直接返回原始数据
        if (response.headersSent) {
          return data;
        }

        // 优先使用请求头传入的 x-trace-id，缺失时生成唯一 UUID 并回填至响应头
        const traceId =
          (request.headers['x-trace-id'] as string) || crypto.randomUUID();
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
