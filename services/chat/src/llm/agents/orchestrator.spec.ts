import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  extractPrompt,
  clarifyPrompt,
  analysisPrompt,
  riskPrompt,
  summaryPrompt,
} from '../prompts/orchestrator.prompts.js';
import {
  createSubAgents,
  extractAgent,
  clarifyAgent,
  analysisAgent,
  riskAgent,
  summaryAgent,
  type SubAgents,
} from './sub-agents.js';
import {
  OrchestratorService,
  safeParseJson,
} from './orchestrator.service.js';
import { AgentsController } from './agents.controller.js';

describe('Multi-Agent Fixed Workflow Orchestration', () => {
  const TEST_REQUIREMENT_INPUT =
    '开发一个面向需求分析师的会话记忆系统，支持多轮澄清并自动裁剪长对话上下文';

  describe('1. 需求分析 Agent 提示词定义 (orchestrator.prompts.ts)', () => {
    it('应成功导出 5 个 ChatPromptTemplate 提示词实例', () => {
      expect(extractPrompt).toBeDefined();
      expect(clarifyPrompt).toBeDefined();
      expect(analysisPrompt).toBeDefined();
      expect(riskPrompt).toBeDefined();
      expect(summaryPrompt).toBeDefined();

      expect(typeof extractPrompt.formatMessages).toBe('function');
      expect(typeof clarifyPrompt.formatMessages).toBe('function');
      expect(typeof analysisPrompt.formatMessages).toBe('function');
      expect(typeof riskPrompt.formatMessages).toBe('function');
      expect(typeof summaryPrompt.formatMessages).toBe('function');
    });

    it('extractPrompt: 能正常格式化输入参数 { input }', async () => {
      const messages = await extractPrompt.formatMessages({
        input: TEST_REQUIREMENT_INPUT,
      });
      expect(messages.length).toBe(2);
      expect(messages[0]._getType()).toBe('system');
      expect(messages[1]._getType()).toBe('human');
      expect(messages[1].text).toContain(TEST_REQUIREMENT_INPUT);
    });

    it('clarifyPrompt: 能正常格式化 { input, extractResult }', async () => {
      const messages = await clarifyPrompt.formatMessages({
        input: TEST_REQUIREMENT_INPUT,
        extractResult: '{"coreFeature":"开发会话记忆系统"}',
      });
      expect(messages.length).toBe(2);
      expect(messages[1].text).toContain(TEST_REQUIREMENT_INPUT);
      expect(messages[1].text).toContain('开发会话记忆系统');
    });

    it('analysisPrompt: 能正常格式化多维需求分析参数', async () => {
      const messages = await analysisPrompt.formatMessages({
        input: TEST_REQUIREMENT_INPUT,
        extractResult: '{"coreFeature":"开发会话记忆系统"}',
      });
      expect(messages.length).toBe(2);
      expect(messages[0].text).toContain('资深需求分析师');
      expect(messages[0].text).toContain('功能分解');
      expect(messages[0].text).toContain('用户故事');
      expect(messages[0].text).toContain('验收标准');
      expect(messages[0].text).toContain('依赖关系');
      expect(messages[0].text).toContain('实现建议');
    });

    it('riskPrompt: 能正常格式化风险评估提示词', async () => {
      const messages = await riskPrompt.formatMessages({
        input: TEST_REQUIREMENT_INPUT,
        extractResult: '{"coreFeature":"开发会话记忆系统"}',
      });
      expect(messages.length).toBe(2);
      expect(messages[0].text).toContain('需求风险评估专家');
      expect(messages[0].text).toContain('模糊性风险');
      expect(messages[0].text).toContain('范围风险');
      expect(messages[0].text).toContain('技术风险');
      expect(messages[0].text).toContain('业务风险');
      expect(messages[0].text).toContain('规格缺失');
    });

    it('summaryPrompt: 能正常格式化汇总参数 { input, extractResult, analysisResult, riskResult, retrievedContext }', async () => {
      const messages = await summaryPrompt.formatMessages({
        input: TEST_REQUIREMENT_INPUT,
        extractResult: '{"coreFeature":"开发会话记忆系统"}',
        analysisResult: '功能分解完成',
        riskResult: '风险评估完成',
        retrievedContext: '参考文档片段',
      });
      expect(messages.length).toBe(2);
      expect(messages[0].text).toContain('需求分析报告撰写专家');
      expect(messages[0].text).toContain('知识库参考');
      expect(messages[1].text).toContain('功能分解完成');
      expect(messages[1].text).toContain('风险评估完成');
      expect(messages[1].text).toContain('参考文档片段');
    });
  });

  describe('2. 子 Agent 管道构建 (sub-agents.ts)', () => {
    it('单例导出的子 Agent 应全部包含 invoke 与 stream 方法', () => {
      const agents = [
        extractAgent,
        clarifyAgent,
        analysisAgent,
        riskAgent,
        summaryAgent,
      ];
      for (const agent of agents) {
        expect(agent).toBeDefined();
        expect(typeof agent.invoke).toBe('function');
        expect(typeof agent.stream).toBe('function');
      }
    });

    it('createSubAgents 工厂函数能基于自定义参数返回完整子 Agent 集合', () => {
      const customSubAgents = createSubAgents();
      expect(customSubAgents.extractAgent).toBeDefined();
      expect(customSubAgents.clarifyAgent).toBeDefined();
      expect(customSubAgents.analysisAgent).toBeDefined();
      expect(customSubAgents.riskAgent).toBeDefined();
      expect(customSubAgents.summaryAgent).toBeDefined();
    });
  });

  describe('3. 工具函数安全解析 (safeParseJson)', () => {
    it('应正确解析纯 JSON', () => {
      const json = safeParseJson('{"action": "test"}', {});
      expect(json).toEqual({ action: 'test' });
    });

    it('应正确去除 Markdown 代码块并解析 JSON', () => {
      const markdownJson = '```json\n{"needsClarification": false, "clarificationQuestions": []}\n```';
      const parsed = safeParseJson(markdownJson, null);
      expect(parsed).toEqual({
        needsClarification: false,
        clarificationQuestions: [],
      });
    });

    it('非法 JSON 文本时应优雅回退到 fallbackValue', () => {
      const parsed = safeParseJson('invalid-string', { fallback: true });
      expect(parsed).toEqual({ fallback: true });
    });
  });

  describe('4. 固定编排服务测试 (OrchestratorService)', () => {
    let service: OrchestratorService;
    let mockSubAgents: SubAgents;

    beforeEach(() => {
      service = new OrchestratorService();
      mockSubAgents = {
        extractAgent: { invoke: vi.fn() } as any,
        clarifyAgent: { invoke: vi.fn() } as any,
        analysisAgent: { invoke: vi.fn() } as any,
        riskAgent: { invoke: vi.fn() } as any,
        summaryAgent: { invoke: vi.fn() } as any,
      };
      service.setSubAgents(mockSubAgents);
      vi.restoreAllMocks();
    });

    it('正常流程：抽取 -> 无需澄清 -> 并行（分析+风控）-> 汇总生成报告', async () => {
      const mockExtraction = JSON.stringify({
        action: '开发会话记忆系统',
        targetUsers: ['需求分析师'],
        coreFeatures: ['多轮澄清', '自动裁剪长对话上下文'],
        constraints: ['长上下文自动截断', '保证关键信息不丢失'],
        entities: ['会话记忆', '需求分析师', '上下文'],
      });

      const mockClarification = JSON.stringify({
        needsClarification: false,
        clarificationQuestions: [],
        reason: '需求核心功能与受众明确',
      });

      const mockAnalysis = '### 需求分析报告\n- 功能拆解：会话管理、自动裁剪引擎';
      const mockRisk = '### 风险评估\n- 风险：上下文裁剪导致信息丢失；对策：结合总结摘要压缩';
      const mockSummary = '# 最终需求分析规格报告\n开发面向需求分析师的会话记忆系统...';

      (mockSubAgents.extractAgent.invoke as any).mockResolvedValue(mockExtraction);
      (mockSubAgents.clarifyAgent.invoke as any).mockResolvedValue(mockClarification);
      (mockSubAgents.analysisAgent.invoke as any).mockResolvedValue(mockAnalysis);
      (mockSubAgents.riskAgent.invoke as any).mockResolvedValue(mockRisk);
      (mockSubAgents.summaryAgent.invoke as any).mockResolvedValue(mockSummary);

      const result = await service.orchestrate(TEST_REQUIREMENT_INPUT);

      expect(result.mode).toBe('fixed_workflow');
      expect(result.status).toBe('completed');
      expect(result.clarificationQuestions).toEqual([]);
      expect(result.fallback).toBeNull();
      expect(result.report).toBe(mockSummary);
      expect(result.usedAgents).toEqual([
        'extractAgent',
        'clarifyAgent',
        'analysisAgent',
        'riskAgent',
        'summaryAgent',
      ]);
      expect(result.steps.length).toBe(5);
      expect(result.steps.every((s) => s.status === 'success')).toBe(true);

      // 验证并行调用
      expect(mockSubAgents.analysisAgent.invoke).toHaveBeenCalledTimes(1);
      expect(mockSubAgents.riskAgent.invoke).toHaveBeenCalledTimes(1);
      expect(mockSubAgents.summaryAgent.invoke).toHaveBeenCalledTimes(1);
    });

    it('澄清中断流程：当需要澄清时，提前终止流程并返回澄清问题', async () => {
      const mockExtraction = JSON.stringify({
        action: '开发系统',
      });

      const mockClarification = JSON.stringify({
        needsClarification: true,
        clarificationQuestions: [
          '请明确长对话上下文裁剪的具体策略（如按Token数还是按轮次）？',
          '会话记忆存储是依赖本地缓存还是持久化数据库？',
        ],
        reason: '缺少存储与裁剪策略细节',
      });

      (mockSubAgents.extractAgent.invoke as any).mockResolvedValue(mockExtraction);
      (mockSubAgents.clarifyAgent.invoke as any).mockResolvedValue(mockClarification);

      const result = await service.orchestrate(TEST_REQUIREMENT_INPUT);

      expect(result.mode).toBe('fixed_workflow');
      expect(result.status).toBe('clarification_needed');
      expect(result.clarificationQuestions.length).toBe(2);
      expect(result.clarificationQuestions[0]).toContain('裁剪的具体策略');
      expect(result.usedAgents).toEqual(['extractAgent', 'clarifyAgent']);
      expect(result.report).toBe('');
      expect(result.fallback).toBeNull();

      // 后续 Agent 不应被调用
      expect(mockSubAgents.analysisAgent.invoke).not.toHaveBeenCalled();
      expect(mockSubAgents.riskAgent.invoke).not.toHaveBeenCalled();
      expect(mockSubAgents.summaryAgent.invoke).not.toHaveBeenCalled();
    });

    it('异常降级：当任一子 Agent 抛出异常时，捕获并返回 fallback: "manual_review"', async () => {
      (mockSubAgents.extractAgent.invoke as any).mockRejectedValue(
        new Error('LLM connection timeout'),
      );

      const result = await service.orchestrate(TEST_REQUIREMENT_INPUT);

      expect(result.mode).toBe('fixed_workflow');
      expect(result.status).toBe('failed');
      expect(result.fallback).toBe('manual_review');
      expect(result.report).toBe('');
      expect(result.usedAgents).toContain('extractAgent');
      expect(result.steps.some((s) => s.status === 'failed')).toBe(true);
    });
  });

  describe('5. 控制器路由委派 (AgentsController)', () => {
    let controller: AgentsController;
    let orchestratorService: OrchestratorService;

    beforeEach(() => {
      orchestratorService = new OrchestratorService();
      controller = new AgentsController(orchestratorService);
    });

    it('POST orchestrate: 正常输入时正确委托给服务并返回结果', async () => {
      const mockResult: any = {
        mode: 'fixed_workflow',
        status: 'completed',
        clarificationQuestions: [],
        usedAgents: ['extractAgent', 'clarifyAgent', 'analysisAgent', 'riskAgent', 'summaryAgent'],
        fallback: null,
        steps: [],
        report: '# 需求分析报告',
      };

      const spy = vi
        .spyOn(orchestratorService, 'orchestrate')
        .mockResolvedValue(mockResult);

      const res = await controller.orchestrate({
        input: TEST_REQUIREMENT_INPUT,
      });

      expect(spy).toHaveBeenCalledWith(TEST_REQUIREMENT_INPUT);
      expect(res).toEqual(mockResult);
    });

    it('POST orchestrate: 空 input 时应抛出 BadRequestException', async () => {
      await expect(controller.orchestrate({ input: '' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(controller.orchestrate({ input: '   ' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(controller.orchestrate(null as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
