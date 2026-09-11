import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import {
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  HttpStatus,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';

describe('AllExceptionsFilter Unit Tests', () => {
  let filter: AllExceptionsFilter;
  let mockRequest: any;
  let mockResponse: any;
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    filter = new AllExceptionsFilter();

    mockRequest = {
      method: 'GET',
      url: '/api/test',
      headers: {},
    };

    mockResponse = {
      headersSent: false,
      headers: {} as Record<string, string>,
      statusCode: 200,
      status: vi.fn(function (this: any, code: number) {
        this.statusCode = code;
        return this;
      }),
      json: vi.fn(),
      setHeader: vi.fn((name: string, value: string) => {
        mockResponse.headers[name.toLowerCase()] = value;
      }),
    };

    mockHost = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as any;
  });

  it('应该捕获 404 并映射为 code: NOT_FOUND', () => {
    const exception = new NotFoundException('指定资源不存在');

    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: 'NOT_FOUND',
        msg: '指定资源不存在',
        data: null,
      }),
    );
    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      'x-trace-id',
      expect.any(String),
    );
  });

  it('若异常包含数组形式的消息，应以逗号扁平化拼接，并映射为 code: BAD_REQUEST', () => {
    const exception = new BadRequestException({
      message: ['title 不能为空', 'size 必须大于 0'],
      error: 'Bad Request',
    });

    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: 'BAD_REQUEST',
        msg: 'title 不能为空, size 必须大于 0',
        data: null,
      }),
    );
  });

  it('应该正确映射 401 UNAUTHORIZED, 403 FORBIDDEN, 409 CONFLICT', () => {
    filter.catch(new UnauthorizedException('未登录'), mockHost);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'UNAUTHORIZED',
        msg: '未登录',
      }),
    );

    filter.catch(new ForbiddenException('无权限'), mockHost);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'FORBIDDEN',
        msg: '无权限',
      }),
    );

    filter.catch(new ConflictException('资源冲突'), mockHost);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'CONFLICT',
        msg: '资源冲突',
      }),
    );
  });

  it('捕获未知运行时异常时应返回 500 与 INTERNAL_ERROR 并脱敏提示', () => {
    const exception = new Error('致命的数据库死锁或空指针错误');

    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: 'INTERNAL_ERROR',
        msg: '系统繁忙，请稍后重试',
        data: null,
      }),
    );
  });

  it('若响应头已发送 (如 SSE 流传输中途)，应安全跳过 JSON 写入', () => {
    mockResponse.headersSent = true;
    const exception = new Error('流式传输中断');

    filter.catch(exception, mockHost);

    expect(mockResponse.status).not.toHaveBeenCalled();
    expect(mockResponse.json).not.toHaveBeenCalled();
  });
});
