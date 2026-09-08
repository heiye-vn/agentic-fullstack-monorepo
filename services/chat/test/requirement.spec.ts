import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { RequirementService } from '../src/llm/requirement.service.js';
import {
  RequirementResultSchema,
  type RequirementResult,
} from '@autix/contracts';

describe('Requirement E2E & Service Spec (/requirement/extract)', () => {
  let app: INestApplication;
  let requirementService: RequirementService;

  const mockExtractResult: RequirementResult = {
    action: '用户注册',
    constraints: ['必须绑定手机号', '密码至少8位'],
    entities: ['用户', '手机号', '密码'],
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    requirementService = moduleFixture.get<RequirementService>(RequirementService);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  describe('POST /requirement/extract (Controller E2E)', () => {
    it('正常请求应返回 201 状态码与符合 RequirementResult 契约的结构化数据', async () => {
      const extractSpy = vi
        .spyOn(requirementService, 'extract')
        .mockResolvedValue(mockExtractResult);

      const testInput = '用户注册时必须绑定手机号，密码至少8位';

      const response = await request(app.getHttpServer())
        .post('/requirement/extract')
        .send({ input: testInput })
        .expect(201);

      expect(extractSpy).toHaveBeenCalledWith(testInput);
      expect(response.body).toEqual(mockExtractResult);

      // 验证返回结果严格符合契约 Schema
      const parseCheck = RequirementResultSchema.safeParse(response.body);
      expect(parseCheck.success).toBe(true);
    });

    it('支持自定义业务需求输入并正确透传至服务层', async () => {
      const customResult: RequirementResult = {
        action: '导出报表',
        constraints: ['必须包含操作日志', '单次导出不能超过1000条'],
        entities: ['报表', '操作日志'],
      };

      const extractSpy = vi
        .spyOn(requirementService, 'extract')
        .mockResolvedValue(customResult);

      const customInput = '导出报表时必须包含操作日志，单次导出不能超过1000条';

      const response = await request(app.getHttpServer())
        .post('/requirement/extract')
        .send({ input: customInput })
        .expect(201);

      expect(extractSpy).toHaveBeenCalledWith(customInput);
      expect(response.body).toEqual(customResult);
    });

    it('当输入包含多余空格时，服务层应能正常响应', async () => {
      vi.spyOn(requirementService, 'extract').mockResolvedValue(mockExtractResult);

      const response = await request(app.getHttpServer())
        .post('/requirement/extract')
        .send({ input: '  用户注册时必须绑定手机号，密码至少8位   ' })
        .expect(201);

      expect(response.body.action).toBe('用户注册');
      expect(response.body.constraints).toHaveLength(2);
      expect(response.body.entities).toHaveLength(3);
    });
  });

  describe('RequirementService 单元与模型绑定验证', () => {
    it('extract 应该使用 prompt 格式化消息并调用 withStructuredOutput', async () => {
      const service = new RequirementService();

      const mockInvoke = vi.fn().mockResolvedValue(mockExtractResult);
      const mockStructuredModel = { invoke: mockInvoke };
      const mockWithStructuredOutput = vi.fn().mockReturnValue(mockStructuredModel);
      const mockCustomModel = {
        withStructuredOutput: mockWithStructuredOutput,
      } as any;

      const input = '用户注册时必须绑定手机号，密码至少8位';
      const result = await service.extract(input, mockCustomModel);

      expect(mockWithStructuredOutput).toHaveBeenCalledWith(RequirementResultSchema);
      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockExtractResult);
    });
  });
});
