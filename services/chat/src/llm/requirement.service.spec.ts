import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RequirementService } from './requirement.service.js';
import {
  REQUIREMENT_SYSTEM_PROMPT,
  REQUIREMENT_USER_TEMPLATE,
} from './prompts/requirement.prompt.js';
import {
  RequirementSchema,
  RequirementResultSchema,
  type RequirementResult,
} from '@autix/contracts';
import { LlmController } from './llm.controller.js';
import { LlmService, DEFAULT_USER_INPUT } from './llm.service.js';

describe('RequirementService & Structured Output', () => {
  describe('1. 共享契约模式校验 (RequirementSchema & RequirementResultSchema)', () => {
    it('应成功导出 RequirementSchema 与 RequirementResultSchema', () => {
      expect(RequirementSchema).toBeDefined();
      expect(RequirementResultSchema).toBeDefined();
      expect(RequirementResultSchema).toBe(RequirementSchema);
    });

    it('合法结构化数据应当通过 Schema 校验', () => {
      const validData: RequirementResult = {
        action: '用户注册',
        constraints: ['必须绑定手机号', '密码至少8位'],
        entities: ['用户', '手机号', '密码'],
      };

      const parseResult = RequirementResultSchema.safeParse(validData);
      expect(parseResult.success).toBe(true);
      if (parseResult.success) {
        expect(parseResult.data).toEqual(validData);
      }
    });

    it('当缺失 action 或字段类型不合法时应当校验失败', () => {
      const invalidData = {
        constraints: ['必须绑定手机号'],
        entities: ['用户'],
      };

      const parseResult = RequirementResultSchema.safeParse(invalidData);
      expect(parseResult.success).toBe(false);
    });
  });

  describe('2. 提示词构建与常量复用 (RequirementService)', () => {
    let service: RequirementService;

    beforeEach(() => {
      service = new RequirementService();
    });

    it('提示模板应正确复用 REQUIREMENT_SYSTEM_PROMPT 与 REQUIREMENT_USER_TEMPLATE', async () => {
      expect(service.prompt).toBeDefined();

      const testInput = '用户重置密码时必须发送邮件验证码';
      const messages = await service.prompt.formatMessages({ input: testInput });

      expect(messages).toHaveLength(2);
      expect(messages[0].type).toBe('system');
      expect(messages[0].content).toBe(REQUIREMENT_SYSTEM_PROMPT);

      expect(messages[1].type).toBe('human');
      expect(messages[1].content).toContain(testInput);
      expect(messages[1].content).toBe(
        REQUIREMENT_USER_TEMPLATE.replace('{input}', testInput),
      );
    });
  });

  describe('3. 结构化抽取业务逻辑 (RequirementService.extract)', () => {
    let service: RequirementService;

    beforeEach(() => {
      service = new RequirementService();
      vi.restoreAllMocks();
    });

    it('extract 应当调用 model.withStructuredOutput 并传递 RequirementResultSchema', async () => {
      const expectedResult: RequirementResult = {
        action: '找回密码',
        constraints: ['必须输入图形验证码'],
        entities: ['密码', '图形验证码'],
      };

      const mockInvoke = vi.fn().mockResolvedValue(expectedResult);
      const mockStructuredModel = { invoke: mockInvoke };
      const mockWithStructuredOutput = vi.fn().mockReturnValue(mockStructuredModel);
      const mockModel = {
        withStructuredOutput: mockWithStructuredOutput,
      } as any;

      const input = '找回密码必须输入图形验证码';
      const result = await service.extract(input, mockModel);

      expect(mockWithStructuredOutput).toHaveBeenCalledWith(RequirementResultSchema);
      expect(mockInvoke).toHaveBeenCalledTimes(1);

      // 验证传递给 invoke 的消息包含格式化后的 system 与 human 消息
      const invokedMessages = mockInvoke.mock.calls[0][0];
      expect(invokedMessages).toHaveLength(2);
      expect(invokedMessages[0].content).toBe(REQUIREMENT_SYSTEM_PROMPT);
      expect(invokedMessages[1].content).toContain(input);

      expect(result).toEqual(expectedResult);
    });
  });

  describe('4. 控制器路由端点 (POST /api/langchain/structured)', () => {
    let controller: LlmController;
    let llmService: LlmService;
    let requirementService: RequirementService;

    beforeEach(() => {
      llmService = new LlmService();
      requirementService = new RequirementService();
      controller = new LlmController(llmService, requirementService);
      vi.restoreAllMocks();
    });

    it('POST structured: 传入自定义 input 时应正确透传至 requirementService.extract', async () => {
      const customInput = '发票开具必须上传营业执照图片';
      const expectedResult: RequirementResult = {
        action: '发票开具',
        constraints: ['必须上传营业执照图片'],
        entities: ['发票', '营业执照图片'],
      };

      const extractSpy = vi
        .spyOn(requirementService, 'extract')
        .mockResolvedValue(expectedResult);

      const res = await controller.structured({ input: customInput });

      expect(extractSpy).toHaveBeenCalledWith(customInput);
      expect(res).toEqual(expectedResult);
    });

    it('POST structured: 未提供 input 时应使用 DEFAULT_USER_INPUT 兜底', async () => {
      const expectedResult: RequirementResult = {
        action: '用户注册',
        constraints: ['必须绑定手机号', '密码至少8位'],
        entities: ['用户', '手机号', '密码'],
      };

      const extractSpy = vi
        .spyOn(requirementService, 'extract')
        .mockResolvedValue(expectedResult);

      const res = await controller.structured({});

      expect(extractSpy).toHaveBeenCalledWith(DEFAULT_USER_INPUT);
      expect(res).toEqual(expectedResult);
    });

    it('POST structured: body 为空或 undefined 时正常兜底', async () => {
      const expectedResult: RequirementResult = {
        action: '用户注册',
        constraints: ['必须绑定手机号', '密码至少8位'],
        entities: ['用户', '手机号', '密码'],
      };

      const extractSpy = vi
        .spyOn(requirementService, 'extract')
        .mockResolvedValue(expectedResult);

      const res = await controller.structured(undefined);

      expect(extractSpy).toHaveBeenCalledWith(DEFAULT_USER_INPUT);
      expect(res).toEqual(expectedResult);
    });
  });
});
