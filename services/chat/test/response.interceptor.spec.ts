import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of, lastValueFrom } from 'rxjs';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor.js';
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

  it('若请求头传入 x-trace-id，应当沿用该 traceId', async () => {
    mockRequest.headers['x-trace-id'] = 'custom-trace-id-12345';
    mockCallHandler = {
      handle: () => of('hello'),
    };

    const observable = interceptor.intercept(mockContext, mockCallHandler);
    const result = await lastValueFrom(observable);

    expect(result.traceId).toBe('custom-trace-id-12345');
    expect(mockResponse.setHeader).toHaveBeenCalledWith('x-trace-id', 'custom-trace-id-12345');
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
