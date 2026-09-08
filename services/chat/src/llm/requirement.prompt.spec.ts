import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  REQUIREMENT_SYSTEM_PROMPT,
  REQUIREMENT_USER_TEMPLATE,
} from './prompts/requirement.prompt.js';
import {
  createRequirementPromptTemplate,
  requirementPromptTemplate,
} from './requirement.prompt-builder.js';
import { LlmService, DEFAULT_USER_INPUT } from './llm.service.js';
import { LlmController } from './llm.controller.js';
import * as modelFactory from './model.factory.js';

describe('Requirement Prompt & Template Builder', () => {
  const TEST_INPUT = '用户注册时必须绑定手机号，密码至少8位';

  describe('1. 提示模板常量定义 (requirement.prompt.ts)', () => {
    it('应成功导出 REQUIREMENT_SYSTEM_PROMPT', () => {
      expect(REQUIREMENT_SYSTEM_PROMPT).toBeDefined();
      expect(typeof REQUIREMENT_SYSTEM_PROMPT).toBe('string');
      expect(REQUIREMENT_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    });

    it('应成功导出 REQUIREMENT_USER_TEMPLATE 且包含 {input} 占位符', () => {
      expect(REQUIREMENT_USER_TEMPLATE).toBeDefined();
      expect(REQUIREMENT_USER_TEMPLATE).toContain('{input}');
    });
  });

  describe('2. 模板构建器 (requirement.prompt-builder.ts)', () => {
    it('应使用 ChatPromptTemplate 组装 system 和 human 消息并正确替换占位符', async () => {
      const template = createRequirementPromptTemplate();
      const messages = await template.formatMessages({ input: TEST_INPUT });

      expect(messages).toHaveLength(2);
      expect(messages[0].type).toBe('system');
      expect(messages[0].content).toBe(REQUIREMENT_SYSTEM_PROMPT);

      expect(messages[1].type).toBe('human');
      expect(messages[1].content).toContain(TEST_INPUT);
      expect(messages[1].content).not.toContain('{input}');
    });

    it('单例 requirementPromptTemplate 实例可直接正常格式化', async () => {
      const messages = await requirementPromptTemplate.formatMessages({
        input: TEST_INPUT,
      });
      expect(messages).toHaveLength(2);
      expect(messages[1].content).toContain(TEST_INPUT);
    });
  });

  describe('3. 服务层接口逻辑 (LlmService)', () => {
    let service: LlmService;

    beforeEach(() => {
      service = new LlmService();
      vi.restoreAllMocks();
    });

    it('previewPrompt: 未传参数时应降级使用统一默认输入，仅渲染模板不调模型', async () => {
      const preview = await service.previewPrompt();
      expect(preview.input).toBe(DEFAULT_USER_INPUT);
      expect(preview.messages).toHaveLength(2);
      expect(preview.messages[0]).toEqual({
        role: 'system',
        content: REQUIREMENT_SYSTEM_PROMPT,
      });
      expect(preview.messages[1].role).toBe('human');
      expect(preview.messages[1].content).toContain(DEFAULT_USER_INPUT);
    });

    it('previewPrompt: 传入自定义 input 时应正确渲染', async () => {
      const customInput = '购物车支持批量删除商品';
      const preview = await service.previewPrompt(customInput);
      expect(preview.input).toBe(customInput);
      expect(preview.messages[1].content).toContain(customInput);
    });

    it('invokeWithPrompt: 渲染模板后应传给模型 invoke 并返回 InvokeResult', async () => {
      const mockModel = {
        invoke: vi.fn().mockResolvedValue({
          content: '结构化需求输出示例',
          response_metadata: { model_name: 'gpt-4o-mini' },
          usage_metadata: { input_tokens: 20, output_tokens: 30, total_tokens: 50 },
        }),
      };
      vi.spyOn(modelFactory, 'createChatModel').mockReturnValue(mockModel as any);

      const result = await service.invokeWithPrompt(TEST_INPUT);

      expect(mockModel.invoke).toHaveBeenCalledTimes(1);
      const invokedMessages = mockModel.invoke.mock.calls[0][0];
      expect(invokedMessages).toHaveLength(2);
      expect(invokedMessages[0].content).toBe(REQUIREMENT_SYSTEM_PROMPT);
      expect(invokedMessages[1].content).toContain(TEST_INPUT);

      expect(result).toEqual({
        content: '结构化需求输出示例',
        model: 'gpt-4o-mini',
        usage: {
          inputTokens: 20,
          outputTokens: 30,
          totalTokens: 50,
        },
      });
    });
  });

  describe('4. 控制器路由映射 (LlmController)', () => {
    let controller: LlmController;
    let service: LlmService;

    beforeEach(() => {
      service = new LlmService();
      controller = new LlmController(service);
      vi.restoreAllMocks();
    });

    it('POST prompt-preview: 应当正确委托给 service.previewPrompt', async () => {
      const spy = vi.spyOn(service, 'previewPrompt').mockResolvedValue({
        input: TEST_INPUT,
        messages: [
          { role: 'system', content: REQUIREMENT_SYSTEM_PROMPT },
          { role: 'human', content: `请对以下用户需求进行结构化分析与提取：\n${TEST_INPUT}` },
        ],
      });

      const res = await controller.promptPreview({ input: TEST_INPUT });

      expect(spy).toHaveBeenCalledWith(TEST_INPUT);
      expect(res.input).toBe(TEST_INPUT);
      expect(res.messages).toHaveLength(2);
    });

    it('POST prompt-to-model: 应当正确委托给 service.invokeWithPrompt', async () => {
      const expectedResult = {
        content: '模型调用结果',
        model: 'test-model',
        usage: { inputTokens: 10, outputTokens: 15, totalTokens: 25 },
      };
      const spy = vi.spyOn(service, 'invokeWithPrompt').mockResolvedValue(expectedResult);

      const res = await controller.promptToModel({ input: TEST_INPUT });

      expect(spy).toHaveBeenCalledWith(TEST_INPUT);
      expect(res).toEqual(expectedResult);
    });
  });
});
