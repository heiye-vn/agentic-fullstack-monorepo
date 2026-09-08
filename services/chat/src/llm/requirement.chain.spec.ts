import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requirementChain, createRequirementChain } from './requirement.chain.js';
import { requirementPrompt } from './requirement.prompt-builder.js';
import { LlmService, DEFAULT_USER_INPUT } from './llm.service.js';
import { LlmController } from './llm.controller.js';

describe('Requirement Chain (LCEL pipe)', () => {
  const DEFAULT_TEST_INPUT = DEFAULT_USER_INPUT;

  describe('1. LCEL 链构建与导出 (requirement.chain.ts)', () => {
    it('应成功导出 requirementChain 实例且包含 invoke, stream, batch 方法', () => {
      expect(requirementChain).toBeDefined();
      expect(typeof requirementChain.invoke).toBe('function');
      expect(typeof requirementChain.stream).toBe('function');
      expect(typeof requirementChain.batch).toBe('function');
    });

    it('createRequirementChain 工厂函数能够正常返回具有 pipe 特性的 Runnable 链', () => {
      const chain = createRequirementChain();
      expect(chain).toBeDefined();
      expect(typeof chain.invoke).toBe('function');
    });

    it('requirementPrompt 别名应与 requirementPromptTemplate 一致', () => {
      expect(requirementPrompt).toBeDefined();
      expect(typeof requirementPrompt.formatMessages).toBe('function');
    });
  });

  describe('2. 服务层链式调用 (LlmService)', () => {
    let service: LlmService;

    beforeEach(() => {
      service = new LlmService();
      vi.restoreAllMocks();
    });

    it('chainInvoke: 未传参时应使用默认输入兜底，并调用 requirementChain.invoke', async () => {
      const mockResult = '提取结果：注册需要手机号和至少8位密码';
      const invokeSpy = vi
        .spyOn(requirementChain, 'invoke')
        .mockResolvedValue(mockResult);

      const res = await service.chainInvoke();

      expect(invokeSpy).toHaveBeenCalledWith({ input: DEFAULT_TEST_INPUT });
      expect(res).toEqual({ content: mockResult });
    });

    it('chainInvoke: 传入自定义 input 时应使用自定义输入', async () => {
      const customInput = '管理员登录需二次验证码';
      const mockResult = '提取结果：管理员登录需要二次验证';
      const invokeSpy = vi
        .spyOn(requirementChain, 'invoke')
        .mockResolvedValue(mockResult);

      const res = await service.chainInvoke(customInput);

      expect(invokeSpy).toHaveBeenCalledWith({ input: customInput });
      expect(res).toEqual({ content: mockResult });
    });

    it('chainStream: 未传参时流式逐 chunk 返回', async () => {
      async function* fakeStream() {
        yield 'chunk1 ';
        yield 'chunk2';
      }
      const streamSpy = vi
        .spyOn(requirementChain, 'stream')
        .mockResolvedValue(fakeStream() as any);

      const chunks: string[] = [];
      for await (const chunk of service.chainStream()) {
        chunks.push(chunk);
      }

      expect(streamSpy).toHaveBeenCalledWith({ input: DEFAULT_TEST_INPUT });
      expect(chunks).toEqual(['chunk1 ', 'chunk2']);
    });

    it('chainBatch: 未传参时使用包含默认输入的数组并发调用', async () => {
      const mockBatchResults = ['结果1'];
      const batchSpy = vi
        .spyOn(requirementChain, 'batch')
        .mockResolvedValue(mockBatchResults);

      const res = await service.chainBatch();

      expect(batchSpy).toHaveBeenCalledWith([{ input: DEFAULT_TEST_INPUT }]);
      expect(res.results).toEqual(mockBatchResults);
      expect(res.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('chainBatch: 传入多个 input 时正确映射为 batch 载荷', async () => {
      const inputs = ['需求一', '需求二'];
      const mockBatchResults = ['解析1', '解析2'];
      const batchSpy = vi
        .spyOn(requirementChain, 'batch')
        .mockResolvedValue(mockBatchResults);

      const res = await service.chainBatch(inputs);

      expect(batchSpy).toHaveBeenCalledWith([{ input: '需求一' }, { input: '需求二' }]);
      expect(res.results).toEqual(mockBatchResults);
    });
  });

  describe('3. 控制器路由委托 (LlmController)', () => {
    let controller: LlmController;
    let service: LlmService;

    beforeEach(() => {
      service = new LlmService();
      controller = new LlmController(service);
      vi.restoreAllMocks();
    });

    it('POST chain-invoke: 应当正确委托给 service.chainInvoke', async () => {
      const expected = { content: '提取成功' };
      const spy = vi.spyOn(service, 'chainInvoke').mockResolvedValue(expected);

      const res = await controller.chainInvoke({ input: DEFAULT_TEST_INPUT });

      expect(spy).toHaveBeenCalledWith(DEFAULT_TEST_INPUT);
      expect(res).toEqual(expected);
    });

    it('POST chain-stream: 应当正确输出流并结束响应', async () => {
      async function* mockStream() {
        yield '流式分块1';
        yield '流式分块2';
      }
      vi.spyOn(service, 'chainStream').mockReturnValue(mockStream());

      const writeMock = vi.fn();
      const endMock = vi.fn();
      const setHeaderMock = vi.fn();
      const flushHeadersMock = vi.fn();

      const mockRes: any = {
        setHeader: setHeaderMock,
        flushHeaders: flushHeadersMock,
        write: writeMock,
        end: endMock,
      };

      await controller.chainStream({ input: DEFAULT_TEST_INPUT }, mockRes);

      expect(setHeaderMock).toHaveBeenCalledWith('Content-Type', 'text/plain; charset=utf-8');
      expect(writeMock).toHaveBeenCalledWith('流式分块1');
      expect(writeMock).toHaveBeenCalledWith('流式分块2');
      expect(endMock).toHaveBeenCalled();
    });

    it('POST chain-batch: 应当正确委托给 service.chainBatch', async () => {
      const expected = { results: ['结果1'], totalDurationMs: 12 };
      const spy = vi.spyOn(service, 'chainBatch').mockResolvedValue(expected);

      const res = await controller.chainBatch({ inputs: [DEFAULT_TEST_INPUT] });

      expect(spy).toHaveBeenCalledWith([DEFAULT_TEST_INPUT]);
      expect(res).toEqual(expected);
    });
  });
});
