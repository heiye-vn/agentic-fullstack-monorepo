import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiResponse } from '@autix/types';
import { createLogger, getTraceId } from '../../observability/index.js';

const errorLog = createLogger('exception');

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // 关键：若响应头已被发送（如 SSE 推送过程中出现异常），则不再重复写入 JSON 响应
    if (response.headersSent) {
      this.logger.warn(
        `响应头已发送，跳过全局异常过滤器 JSON 输出: ${request.method} ${request.url}`,
      );
      return;
    }

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: any = '系统繁忙，请稍后重试';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, any>;
        if (resObj.message !== undefined) {
          message = resObj.message;
        } else if (typeof resObj.error === 'string') {
          message = resObj.error;
        }
      }
    } else {
      // 未知内部运行时异常，记录日志并向客户端脱敏保护内部实现
      const errorStack =
        exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(
        `[未捕获系统异常] ${request.method} ${request.url}:`,
        errorStack,
      );
    }

    // 校验错误数组扁平化拼接
    if (Array.isArray(message)) {
      message = message.join(', ');
    } else {
      message = String(message);
    }

    // 语义化错误码映射（对齐标准业务错误码规范）
    let code: string;
    switch (status) {
      case 400:
        code = 'BAD_REQUEST';
        break;
      case 401:
        code = 'UNAUTHORIZED';
        break;
      case 403:
        code = 'FORBIDDEN';
        break;
      case 404:
        code = 'NOT_FOUND';
        break;
      case 409:
        code = 'CONFLICT';
        break;
      default:
        code = 'INTERNAL_ERROR';
    }

    // 第十六章：traceId 与 access 日志、LLM 日志同源，同一请求只应有一条 trace 链。
    // TraceMiddleware 通常已在响应头写过 x-trace-id —— 此时直接复用它的值，
    // 既避免覆盖也更稳（异常可能发生在 ALS 上下文之外，如守卫/过滤器阶段）。
    // 否则回落到 ALS 上下文（含 'no-trace' 兜底）并补写响应头。
    const headerTraceId = response.getHeader('x-trace-id');
    const hasHeaderTraceId =
      typeof headerTraceId === 'string' && headerTraceId.length > 0;
    const traceId = hasHeaderTraceId ? headerTraceId : getTraceId();
    if (!hasHeaderTraceId) {
      response.setHeader('x-trace-id', traceId);
    }

    errorLog.error(
      {
        status,
        code,
        method: request.method,
        path: request.path,
        // 只记截断后的错误摘要：完整 stack / message 可能夹带用户输入原文
        err: String(exception).slice(0, 300),
      },
      'unhandled_exception',
    );

    const errorResponse: ApiResponse<null> = {
      success: false,
      code,
      msg: message,
      traceId,
      data: null,
    };

    response.status(status).json(errorResponse);
  }
}
