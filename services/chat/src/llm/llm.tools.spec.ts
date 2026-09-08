import { describe, it, expect, vi } from 'vitest';
import { AIMessage } from '@langchain/core/messages';
import { LlmService, DEFAULT_USER_INPUT } from './llm.service.js';
import { LlmController } from './llm.controller.js';

describe('LlmService & LlmController Tool Calling', () => {
  describe('LlmService.toolBind', () => {
    it('应正确调用模型并解析模型返回的 tool_calls', async () => {
      const mockModel = {
        bindTools: vi.fn().mockReturnThis(),
        invoke: vi.fn().mockResolvedValue(
          new AIMessage({
            content: '我将调用工具分析约束与实体。',
            tool_calls: [
              {
                id: 'call_1',
                name: 'check_constraint_validity',
                args: { constraint: '必须绑定手机号' },
              },
              {
                id: 'call_2',
                name: 'lookup_entity_definition',
                args: { entity: '手机号' },
              },
            ],
            response_metadata: {
              model_name: 'test-model',
            },
            usage_metadata: {
              input_tokens: 150,
              output_tokens: 60,
              total_tokens: 210,
            },
          }),
        ),
      };

      const service = new LlmService();
      const result = await service.toolBind('测试需求：必须绑定手机号', mockModel);

      expect(mockModel.bindTools).toHaveBeenCalled();
      expect(mockModel.invoke).toHaveBeenCalled();

      // 验证提示词中包含用户需求
      const invokedMessages = mockModel.invoke.mock.calls[0][0];
      expect(invokedMessages[0].content).toContain('需求分析');
      expect(invokedMessages[1].content).toContain('测试需求：必须绑定手机号');

      // 验证解析结果
      expect(result.content).toBe('我将调用工具分析约束与实体。');
      expect(result.model).toBe('test-model');
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0]).toEqual({
        id: 'call_1',
        name: 'check_constraint_validity',
        args: { constraint: '必须绑定手机号' },
      });
      expect(result.toolCalls[1]).toEqual({
        id: 'call_2',
        name: 'lookup_entity_definition',
        args: { entity: '手机号' },
      });
      expect(result.usage).toEqual({
        inputTokens: 150,
        outputTokens: 60,
        totalTokens: 210,
      });
    });

    it('当未传入用户输入时，默认使用 DEFAULT_USER_INPUT', async () => {
      const mockModel = {
        bindTools: vi.fn().mockReturnThis(),
        invoke: vi.fn().mockResolvedValue(
          new AIMessage({
            content: '默认调用',
            tool_calls: [],
          }),
        ),
      };

      const service = new LlmService();
      await service.toolBind(undefined, mockModel);

      const invokedMessages = mockModel.invoke.mock.calls[0][0];
      expect(invokedMessages[1].content).toContain(DEFAULT_USER_INPUT);
    });
  });

  describe('LlmService.toolLoop', () => {
    it('完整多轮调用链路：第一轮触发 tool_calls，本地执行工具后传回 ToolMessage，第二轮生成最终总结', async () => {
      const round1Response = new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'call_validity_1',
            name: 'check_constraint_validity',
            args: { constraint: '必须绑定手机号' },
          },
          {
            id: 'call_lookup_1',
            name: 'lookup_entity_definition',
            args: { entity: '手机号' },
          },
        ],
      });

      const round2Response = new AIMessage({
        content: '经过校验，“必须绑定手机号”是合法强约束，“手机号”是系统核心安全认证实体。需求抽取结构完备。',
        tool_calls: [],
        response_metadata: {
          model_name: 'test-model',
        },
        usage_metadata: {
          input_tokens: 300,
          output_tokens: 120,
          total_tokens: 420,
        },
      });

      const invokeMock = vi
        .fn()
        .mockResolvedValueOnce(round1Response)
        .mockResolvedValueOnce(round2Response);

      const mockModel = {
        bindTools: vi.fn().mockReturnThis(),
        invoke: invokeMock,
      };

      const service = new LlmService();
      const result = await service.toolLoop('用户注册必须绑定手机号', 5, mockModel);

      // 验证循环了 2 轮
      expect(result.iterations).toBe(2);
      expect(invokeMock).toHaveBeenCalledTimes(2);

      // 验证记录的 steps 轨迹
      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].toolCall.name).toBe('check_constraint_validity');
      const step1Output = JSON.parse(result.steps[0].toolOutput);
      expect(step1Output.isValid).toBe(true);
      expect(step1Output.level).toBe('strict');

      expect(result.steps[1].toolCall.name).toBe('lookup_entity_definition');
      const step2Output = JSON.parse(result.steps[1].toolOutput);
      expect(step2Output.found).toBe(true);
      expect(step2Output.domain).toBe('安全与身份认证');

      // 验证第 2 轮调用时传入的消息历史（引用数组共包含 6 条消息记录）
      // [0: SystemMessage, 1: HumanMessage, 2: round1 AIMessage, 3: ToolMessage 1, 4: ToolMessage 2, 5: round2 AIMessage]
      const secondCallMessages = invokeMock.mock.calls[1][0];
      expect(secondCallMessages.length).toBe(6);
      expect(secondCallMessages[2].getType()).toBe('ai');
      expect(secondCallMessages[3].getType()).toBe('tool');
      expect(secondCallMessages[3].tool_call_id).toBe('call_validity_1');
      expect(secondCallMessages[4].getType()).toBe('tool');
      expect(secondCallMessages[4].tool_call_id).toBe('call_lookup_1');
      expect(secondCallMessages[5].getType()).toBe('ai');

      // 验证最终输出与 usage
      expect(result.finalContent).toContain('需求抽取结构完备');
      expect(result.usage?.totalTokens).toBe(420);
    });

    it('达到最大迭代轮次后应终止循环，避免死循环', async () => {
      const loopingResponse = new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'infinite_call',
            name: 'check_constraint_validity',
            args: { constraint: '测试约束' },
          },
        ],
      });

      const invokeMock = vi.fn().mockResolvedValue(loopingResponse);
      const mockModel = {
        bindTools: vi.fn().mockReturnThis(),
        invoke: invokeMock,
      };

      const service = new LlmService();
      const result = await service.toolLoop('测试需求', 3, mockModel);

      expect(result.iterations).toBe(3);
      expect(invokeMock).toHaveBeenCalledTimes(3);
      expect(result.steps).toHaveLength(3);
    });
  });

  describe('LlmController Routes', () => {
    it('POST /tool-bind 控制器正确代理到 llmService.toolBind', async () => {
      const mockResult = {
        content: 'bind-content',
        toolCalls: [],
        model: 'test-model',
      };
      const service = new LlmService();
      vi.spyOn(service, 'toolBind').mockResolvedValue(mockResult);

      const controller = new LlmController(service);
      const res = await controller.toolBind({ input: '自定义输入' });

      expect(service.toolBind).toHaveBeenCalledWith('自定义输入');
      expect(res).toEqual(mockResult);
    });

    it('POST /tool-loop 控制器正确代理到 llmService.toolLoop', async () => {
      const mockResult = {
        input: '自定义输入',
        finalContent: 'loop-content',
        iterations: 1,
        steps: [],
        model: 'test-model',
      };
      const service = new LlmService();
      vi.spyOn(service, 'toolLoop').mockResolvedValue(mockResult);

      const controller = new LlmController(service);
      const res = await controller.toolLoop({ input: '自定义输入' });

      expect(service.toolLoop).toHaveBeenCalledWith('自定义输入');
      expect(res).toEqual(mockResult);
    });
  });
});
