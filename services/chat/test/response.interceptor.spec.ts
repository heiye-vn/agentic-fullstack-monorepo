import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of, lastValueFrom } from 'rxjs';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor.js';
import { runWithTrace } from '../src/observability/trace-context.js';
import type { ExecutionContext, CallHandler } from '@nestjs/common';

describe('ResponseInterceptor Unit Tests', () => {
  let interceptor: ResponseInterceptor;
  let mockContext: ExecutionContext;
  let mockRequest: any;
  let mockResponse: any;
  let mockCallHandler: CallHandler;

  beforeEach(() => {
    interceptor = new ResponseInterceptor();

    mockRequest = {
      headers: {},
    };

    mockResponse = {
      headersSent: false,
      headers: {} as Record<string, string>,
      getHeader: vi.fn((name: string) => mockResponse.headers[name.toLowerCase()]),
      setHeader: vi.fn((name: string, value: string) => {
        mockResponse.headers[name.toLowerCase()] = value;
      }),
    };

    mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as any;
  });

  it('应该将常规数据正确包装为 ApiResponse 规范结构', async () => {
    mockCallHandler = {
      handle: () => of({ username: 'alice', age: 18 }),
    };

    const observable = interceptor.intercept(mockContext, mockCallHandler);
    const result = await lastValueFrom(observable);

    expect(result).toMatchObject({
      success: true,
      code: '200',
      msg: '请求成功',
      data: { username: 'alice', age: 18 },
    });
    expect(result.traceId).toBeDefined();
    expect(typeof result.traceId).toBe('string');
    expect(mockResponse.setHeader).toHaveBeenCalledWith('x-trace-id', result.traceId);
  });

  // 第十六章：traceId 不再由拦截器自己生成，而是复用 TraceMiddleware 建立的请求级 ID。
  // 改造前「请求头带的 ID」和「拦截器生成的 ID」是两个，前端拿到后无法在服务端日志检索。
  it('应复用 TraceMiddleware 建立的 traceId（而不是自己 randomUUID）', async () => {
    mockCallHandler = {
      handle: () => of('hello'),
    };

    const traceId = 'mw-established-trace-id';
    const result = await runWithTrace(traceId, async () => {
      const observable = interceptor.intercept(mockContext, mockCallHandler);
      return lastValueFrom(observable);
    });

    expect(result.traceId).toBe(traceId);
    expect(mockResponse.setHeader).toHaveBeenCalledWith('x-trace-id', traceId);
  });

  it('不在 trace 上下文里（如单测直调）时回退为 no-trace 占位符', async () => {
    mockCallHandler = {
      handle: () => of('hello'),
    };

    const observable = interceptor.intercept(mockContext, mockCallHandler);
    const result = await lastValueFrom(observable);

    expect(result.traceId).toBe('no-trace');
  });

  it('防二次包装保护：若数据中已包含 success 字段，应当原样透传', async () => {
    const alreadyWrapped = {
      success: true,
      code: '200',
      msg: '已自定义封装',
      traceId: 'pre-existing-id',
      data: [1, 2, 3],
    };

    mockCallHandler = {
      handle: () => of(alreadyWrapped),
    };

    const observable = interceptor.intercept(mockContext, mockCallHandler);
    const result = await lastValueFrom(observable);

    expect(result).toBe(alreadyWrapped);
  });

  // 第十六章：/metrics 是给 Prometheus 抓的裸文本端点。
  // 一旦被包成 { success, code, data } 的 JSON，抓取会「HTTP 200 但指标为空」——静默失效。
  it('/metrics 这类裸文本端点必须原样输出', async () => {
    mockRequest.path = '/metrics';
    const promText = '# HELP llm_calls_total LLM 调用次数\nllm_calls_total{ok="true"} 1\n';

    mockCallHandler = {
      handle: () => of(promText),
    };

    const observable = interceptor.intercept(mockContext, mockCallHandler);
    const result = await lastValueFrom(observable);

    expect(result).toBe(promText);
  });

  it('SSE 长连接保护：当响应头标记为 text/event-stream 时应直接跳过包装', async () => {
    mockResponse.headers['content-type'] = 'text/event-stream';
    const sseRawData = ': heartbeat\n\n';

    mockCallHandler = {
      handle: () => of(sseRawData),
    };

    const observable = interceptor.intercept(mockContext, mockCallHandler);
    const result = await lastValueFrom(observable);

    expect(result).toBe(sseRawData);
  });

  it('若响应头已发送 (headersSent 为 true)，应直接跳过包装', async () => {
    mockResponse.headersSent = true;
    const rawData = 'stream-chunk';

    mockCallHandler = {
      handle: () => of(rawData),
    };

    const observable = interceptor.intercept(mockContext, mockCallHandler);
    const result = await lastValueFrom(observable);

    expect(result).toBe(rawData);
  });
});
