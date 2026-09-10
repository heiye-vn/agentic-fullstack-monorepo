import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { RunnableLambda } from '@langchain/core/runnables';
import { RunnableMemoryService } from './runnable-memory.service.js';
import { MemoryController } from './memory.controller.js';
import {
  REQUIREMENT_ASSISTANT_SYSTEM_PROMPT,
} from '../prompts/requirement-assistant.prompt.js';

describe('RunnableMemoryService & MemoryController', () => {
  let service: RunnableMemoryService;

  /**
   * 构造可记录历史输入并返回响应的 Fake Model
   */
  function createMockModel(replyGenerator?: (messages: any[]) => string) {
    const invocations: any[][] = [];
    const model = RunnableLambda.from(async (promptVal: any) => {
      const messages =
        typeof promptVal.toChatMessages === 'function'
          ? promptVal.toChatMessages()
          : promptVal;
      invocations.push(messages);
      const content = replyGenerator
        ? replyGenerator(messages)
        : `回复：${messages[messages.length - 1]?.content ?? ''}`;
      return new AIMessage(content);
    }) as any;

    // 模拟 ChatOpenAI 的 getNumTokens 接口
    model.getNumTokens = vi.fn().mockImplementation(async (text: string) => {
      return Math.ceil((text?.length || 0) * 1.5);
    });

    return { model, invocations };
  }

  beforeEach(() => {
    service = new RunnableMemoryService();
    vi.restoreAllMocks();
  });

  describe('1. 提示模板与系统提示词校验', () => {
    it('提示模板应包含系统提示词、history 占位符及 human 输入', async () => {
      expect(service.prompt).toBeDefined();

      const messages = await service.prompt.formatMessages({
        history: [
          new HumanMessage('之前的输入'),
          new AIMessage('之前的回复'),
        ],
        input: '本轮问题',
      });

      expect(messages).toHaveLength(4);
      expect(messages[0].getType()).toBe('system');
      expect(messages[0].content).toBe(REQUIREMENT_ASSISTANT_SYSTEM_PROMPT);
      expect(messages[1].getType()).toBe('human');
      expect(messages[1].content).toBe('之前的输入');
      expect(messages[2].getType()).toBe('ai');
      expect(messages[2].content).toBe('之前的回复');
      expect(messages[3].getType()).toBe('human');
      expect(messages[3].content).toBe('本轮问题');
    });
  });

  describe('2. 多轮对话状态累积与历史管理', () => {
    it('连续多轮 chat 调用应自动在 InMemoryChatMessageHistory 中累积消息', async () => {
      const { model, invocations } = createMockModel();
      const sessionId = 'test-session-multi-turn';

      // 第 1 轮
      const res1 = await service.chat(sessionId, '你好，我是测试用户', {
        customModel: model,
      });
      expect(res1).toBe('回复：你好，我是测试用户');

      let history = await service.getHistory(sessionId);
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({
        role: 'human',
        content: '你好，我是测试用户',
      });
      expect(history[1]).toEqual({
        role: 'ai',
        content: '回复：你好，我是测试用户',
      });

      // 第 2 轮
      const res2 = await service.chat(sessionId, '第二轮提问', {
        customModel: model,
      });
      expect(res2).toBe('回复：第二轮提问');

      history = await service.getHistory(sessionId);
      expect(history).toHaveLength(4);
      expect(history[2]).toEqual({
        role: 'human',
        content: '第二轮提问',
      });
      expect(history[3]).toEqual({
        role: 'ai',
        content: '回复：第二轮提问',
      });

      // 验证第 2 轮调用时传入模型的上下文包含了第 1 轮的历史记录
      expect(invocations).toHaveLength(2);
      const secondRoundMessages = invocations[1];
      expect(secondRoundMessages).toHaveLength(4); // system + human1 + ai1 + human2
      expect(secondRoundMessages[0].getType()).toBe('system');
      expect(secondRoundMessages[1].content).toBe('你好，我是测试用户');
      expect(secondRoundMessages[2].content).toBe('回复：你好，我是测试用户');
      expect(secondRoundMessages[3].content).toBe('第二轮提问');
    });
  });

  describe('3. Session 隔离性测试 (Session Isolation)', () => {
    it('不同 sessionId 的会话历史应严格隔离、互不干扰', async () => {
      const { model } = createMockModel();
      const sessionA = 'session-A';
      const sessionB = 'session-B';

      await service.chat(sessionA, 'A 的独有信息：单号 AAA-001', {
        customModel: model,
      });
      await service.chat(sessionB, 'B 的独有信息：单号 BBB-002', {
        customModel: model,
      });

      const historyA = await service.getHistory(sessionA);
      const historyB = await service.getHistory(sessionB);

      expect(historyA).toHaveLength(2);
      expect(historyA[0].content).toBe('A 的独有信息：单号 AAA-001');

      expect(historyB).toHaveLength(2);
      expect(historyB[0].content).toBe('B 的独有信息：单号 BBB-002');

      // 互不包含对方的内容
      expect(historyA.some((m) => m.content.includes('BBB-002'))).toBe(false);
      expect(historyB.some((m) => m.content.includes('AAA-001'))).toBe(false);
    });
  });

  describe('4. trimMessages 裁剪版机制 (maxTokens: 2000, strategy: last)', () => {
    it('裁剪版链应执行 trimMessages 并在超出 token 时保留最新消息与 system', async () => {
      const { model, invocations } = createMockModel();
      const sessionId = 'session-trim-test';

      // 预先向裁剪版注入超长历史（模拟超过 2000 tokens）
      const longText = '非常长的历史需求文本详细描述。'.repeat(150); // 每段约 2000 字符
      for (let i = 1; i <= 5; i++) {
        await service.appendMessage(
          sessionId,
          `历史轮次 ${i}: ${longText}`,
          `助手确认回复 ${i}`,
          'trimmed',
        );
      }

      const rawHistBefore = await service.getHistory(sessionId, 'trimmed');
      expect(rawHistBefore).toHaveLength(10); // 5 对消息未被清理前依然保留在持久层

      // 发起裁剪版对话调用
      await service.chat(sessionId, '最新提问：基于以上需求评估', {
        version: 'trimmed',
        customModel: model,
      });

      expect(invocations).toHaveLength(1);
      const passedToModel = invocations[0];

      // 验证经 trimMessages 处理后送入模型的总消息数被裁剪（不应全量传递 10 条历史 + 当前输入）
      expect(passedToModel.length).toBeLessThan(12);
      // 第一条必须保留系统提示词（includeSystem: true）
      expect(passedToModel[0].getType()).toBe('system');
      // 截断后的历史第一条必须起始于 human（startOn: 'human'）
      expect(passedToModel[1].getType()).toBe('human');
      // 最后一条必须为本轮最新输入
      expect(passedToModel[passedToModel.length - 1].content).toBe(
        '最新提问：基于以上需求评估',
      );
    });
  });

  describe('5. appendMessage 与 clearSession 操作测试', () => {
    it('appendMessage 应能手动向指定 session 追加消息对', async () => {
      const sessionId = 'session-manual-append';
      await service.appendMessage(sessionId, '人工注入用户消息', '人工注入AI回复');

      const history = await service.getHistory(sessionId);
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({
        role: 'human',
        content: '人工注入用户消息',
      });
      expect(history[1]).toEqual({
        role: 'ai',
        content: '人工注入AI回复',
      });
    });

    it('clearSession 应彻底清除会话历史', async () => {
      const sessionId = 'session-to-be-cleared';
      await service.appendMessage(sessionId, '待删除消息', '待删除回复');

      expect((await service.getHistory(sessionId)).length).toBe(2);

      await service.clearSession(sessionId);
      const historyAfter = await service.getHistory(sessionId);
      expect(historyAfter).toHaveLength(0);
    });
  });

  describe('6. MemoryController 端点行为与校验', () => {
    let controller: MemoryController;

    beforeEach(() => {
      controller = new MemoryController(service);
    });

    it('POST /api/memory/chat 成功返回结构化结果', async () => {
      vi.spyOn(service, 'chat').mockResolvedValue('好的，已记录单号');

      const res = await controller.chat({
        sessionId: 'c-session-1',
        input: '需求单号 REQ-2026-001',
      });

      expect(res).toEqual({
        success: true,
        sessionId: 'c-session-1',
        output: '好的，已记录单号',
        version: 'standard',
      });
    });

    it('POST /api/memory/chat 校验失败应抛出 BadRequestException', async () => {
      await expect(
        controller.chat({ sessionId: '', input: '内容' }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.chat({ sessionId: 's1', input: undefined as any }),
      ).rejects.toThrow(BadRequestException);
    });

    it('GET /api/memory/history/:sessionId 返回历史并包含 count', async () => {
      await service.appendMessage('c-session-2', '问', '答');

      const res = await controller.getHistory('c-session-2');
      expect(res.success).toBe(true);
      expect(res.sessionId).toBe('c-session-2');
      expect(res.count).toBe(2);
      expect(res.history).toHaveLength(2);
    });

    it('DELETE /api/memory/history/:sessionId 成功清除会话', async () => {
      await service.appendMessage('c-session-3', '问', '答');
      const deleteRes = await controller.clearSession('c-session-3');

      expect(deleteRes.success).toBe(true);
      expect(deleteRes.message).toContain('c-session-3');

      const checkRes = await controller.getHistory('c-session-3');
      expect(checkRes.count).toBe(0);
    });
  });

  describe('7. 需求分析助手测试场景端到端闭环验证', () => {
    it('同一 sessionId "s1" 依次执行三轮对话，第 3 轮应完整保留前两轮上下文', async () => {
      const { model, invocations } = createMockModel((msgs) => {
        const last = msgs[msgs.length - 1]?.content ?? '';
        if (last.includes('判断这个需求是否完整')) {
          // 模拟真实需求分析助手基于历史对话给出判断
          return '经判断当前需求不完整。历史单号 REQ-2026-001 与需求分析助手背景已记录，但缺失具体用户角色、功能用例及验收标准。';
        }
        return `已收到并记录：${last}`;
      });

      const sessionId = 's1';

      // 轮次 1
      const turn1Output = await service.chat(
        sessionId,
        '我们想做一个需求分析助手，希望它能记住多轮对话',
        { customModel: model },
      );
      expect(turn1Output).toContain('我们想做一个需求分析助手');

      // 轮次 2
      const turn2Output = await service.chat(
        sessionId,
        '需求单号是 REQ-2026-001',
        { customModel: model },
      );
      expect(turn2Output).toContain('REQ-2026-001');

      // 轮次 3
      const turn3Output = await service.chat(
        sessionId,
        '帮我判断这个需求是否完整',
        { customModel: model },
      );
      expect(turn3Output).toContain('REQ-2026-001');
      expect(turn3Output).toContain('经判断当前需求不完整');

      // 验证第 3 轮调用时，模型接收到的消息列表中完整包含了第 1 轮与第 2 轮
      const thirdInvocation = invocations[2];
      expect(thirdInvocation).toHaveLength(6); // system + human1 + ai1 + human2 + ai2 + human3
      expect(thirdInvocation[0].content).toBe(REQUIREMENT_ASSISTANT_SYSTEM_PROMPT);
      expect(thirdInvocation[1].content).toBe(
        '我们想做一个需求分析助手，希望它能记住多轮对话',
      );
      expect(thirdInvocation[3].content).toBe('需求单号是 REQ-2026-001');
      expect(thirdInvocation[5].content).toBe('帮我判断这个需求是否完整');

      // 验证最终保存的历史记录总数为 6（3 轮对话）
      const finalHistory = await service.getHistory(sessionId);
      expect(finalHistory).toHaveLength(6);
    });
  });
});
