import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { AdvancedAnalysisService } from './advanced-analysis.service.js';
import {
  AdvancedController,
  MemoryController,
  FilesystemController,
  EmbeddingController,
  AgentsController,
} from './advanced.controller.js';
import { RunnableMemoryService } from './memory/runnable-memory.service.js';
import {
  OrchestratorService,
  type OrchestrationResult,
} from './agents/orchestrator.service.js';
import {
  DEFAULT_WORKSPACE_ROOT,
  resolveSafePath,
} from './tools/business.tools.js';

describe('Chapter 4 Unified Entry: AdvancedModule & AdvancedAnalysisService', () => {
  let memoryService: RunnableMemoryService;
  let orchestratorService: OrchestratorService;
  let analysisService: AdvancedAnalysisService;
  let controller: AdvancedController;

  const testSessionId = 'test-session-ch4-eval';
  const testReqId = 'REQ-2026-001';
  let createdReportPath: string | null = null;

  beforeEach(() => {
    memoryService = new RunnableMemoryService();
    orchestratorService = new OrchestratorService();
    analysisService = new AdvancedAnalysisService(
      memoryService,
      orchestratorService,
    );
    controller = new AdvancedController(analysisService);
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    // 清理测试生成的报告文件
    if (createdReportPath && existsSync(createdReportPath)) {
      try {
        await fs.unlink(createdReportPath);
      } catch {
        // 忽略清理异常
      }
      createdReportPath = null;
    }
  });

  describe('1. 模块统一 Controller 导出与承载校验', () => {
    it('advanced.controller.ts 应完整承载并导出第四章所有核心 Controller', () => {
      expect(AdvancedController).toBeDefined();
      expect(MemoryController).toBeDefined();
      expect(FilesystemController).toBeDefined();
      expect(EmbeddingController).toBeDefined();
      expect(AgentsController).toBeDefined();
    });

    it('AdvancedController POST analyze 应正确进行 DTO 校验', async () => {
      // sessionId 为空
      await expect(
        controller.analyze({ sessionId: '', input: '有效输入' }),
      ).rejects.toThrow(BadRequestException);

      // input 为空
      await expect(
        controller.analyze({ sessionId: 's1', input: '   ' }),
      ).rejects.toThrow(BadRequestException);

      // input 类型不合法
      await expect(
        controller.analyze({ sessionId: 's1', input: null as any }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('2. 核心测试场景闭环：前三轮累积会话 -> 第四轮触发 analyze 产出需求分析报告', () => {
    it('同一 sessionId 依次发送前三轮，第四轮触发 analyze 应融合历史、生成报告、写入 reports 目录并通过 appendMessage 写回记忆', async () => {
      // 1. 模拟前三轮对话依次向同一个 sessionId 注入历史记忆
      // 轮次 1: 声明目标
      await memoryService.appendMessage(
        testSessionId,
        '我们想做一个需求分析助手，希望它能记住多轮对话',
        '已收到！我们将为您设计具备多轮会话记忆功能的需求分析助手。',
      );

      // 轮次 2: 补充需求单号
      await memoryService.appendMessage(
        testSessionId,
        `需求单号是 ${testReqId}`,
        `已为您关联需求单号 ${testReqId}，请继续补充具体的功能与约束。`,
      );

      // 轮次 3: 补充详细核心功能与用户受众
      await memoryService.appendMessage(
        testSessionId,
        '核心功能包括多轮需求抽取、自动裁剪长对话上下文以及生成标准化分析报告，目标用户是系统架构师与需求分析师。',
        '已完整记录核心功能范围与目标受众，要素已基本齐备。',
      );

      // 验证前三轮已累积 6 条历史消息
      const historyBeforeTurn4 = await memoryService.getHistory(testSessionId);
      expect(historyBeforeTurn4).toHaveLength(6);

      // 2. 构造第四轮 Orchestrator 模拟返回（验证多 Agent 固定编排协作）
      const mockReportMarkdown = `# 需求分析规格报告：${testReqId}
## 一、 需求基本信息
- 需求单号：${testReqId}
- 核心功能：面向需求分析师的会话记忆系统与标准化报告生成

## 二、 需求要素完整性评估
| 检查项 | 状态 | 审查说明 |
| :--- | :--- | :--- |
| 需求单号 | 通过 | 符合规范 |
| 核心功能 | 通过 | 具备多轮抽取与长上下文裁剪 |

## 三、 综合结论
最终裁定：【通过】。建议即刻进入开发阶段。`;

      const mockOrchestrationResult: OrchestrationResult = {
        mode: 'fixed_workflow',
        status: 'completed',
        clarificationQuestions: [],
        usedAgents: [
          'extractAgent',
          'clarifyAgent',
          'analysisAgent',
          'riskAgent',
          'summaryAgent',
        ],
        fallback: null,
        steps: [
          { agent: 'extractAgent', status: 'success', durationMs: 50 },
          { agent: 'clarifyAgent', status: 'success', durationMs: 40 },
          { agent: 'analysisAgent', status: 'success', durationMs: 120 },
          { agent: 'riskAgent', status: 'success', durationMs: 110 },
          { agent: 'summaryAgent', status: 'success', durationMs: 80 },
        ],
        report: mockReportMarkdown,
      };

      // 监听 orchestrate 调用，检查入参是否包含了前三轮的历史对话内容
      const orchestrateSpy = vi
        .spyOn(orchestratorService, 'orchestrate')
        .mockImplementation(async (combinedInput: string) => {
          expect(combinedInput).toContain('历史对话上下文');
          expect(combinedInput).toContain('我们想做一个需求分析助手');
          expect(combinedInput).toContain(testReqId);
          expect(combinedInput).toContain('帮我判断这个需求是否完整');
          return mockOrchestrationResult;
        });

      // 3. 第四轮：通过 Controller 触发 analyze
      const turn4Input = '帮我判断这个需求是否完整，并产出一份需求分析报告';
      const response = await controller.analyze({
        sessionId: testSessionId,
        input: turn4Input,
      });

      // 验证编排服务被正确调用
      expect(orchestrateSpy).toHaveBeenCalledTimes(1);

      // 4. 验证返回的完整分析报告响应结构
      expect(response.status).toBe('completed');
      expect(response.needsClarification).toBe(false);
      expect(response.sessionId).toBe(testSessionId);
      expect(response.report).toBe(mockReportMarkdown);
      expect(response.reportPath).toBe(`reports/${testReqId}-analysis.md`);

      // 5. 验证文件系统写入：检查 workspace/reports/REQ-2026-001-analysis.md 是否被创建
      createdReportPath = resolveSafePath(
        `reports/${testReqId}-analysis.md`,
        DEFAULT_WORKSPACE_ROOT,
      );
      expect(existsSync(createdReportPath)).toBe(true);

      const savedContent = await fs.readFile(createdReportPath, 'utf-8');
      expect(savedContent).toBe(mockReportMarkdown);

      // 6. 验证用 appendMessage() 写回最终结论（历史总数变为 8 条，且不重新调用模型）
      const historyAfterTurn4 = await memoryService.getHistory(testSessionId);
      expect(historyAfterTurn4).toHaveLength(8);

      // 第 7 条：第 4 轮用户提问
      expect(historyAfterTurn4[6]).toEqual({
        role: 'human',
        content: turn4Input,
      });

      // 第 8 条：写回的完整分析报告结论
      expect(historyAfterTurn4[7]).toEqual({
        role: 'ai',
        content: mockReportMarkdown,
      });
    });
  });

  describe('3. 澄清中断流程分支校验', () => {
    it('当多 Agent 编排判断需求不完整时，应直接返回澄清问题，且不写入 reports 目录也不写回记忆', async () => {
      const clarifySessionId = 'session-needs-clarify';
      const clarifyQuestions = [
        '请问系统的并发量和长对话上下文裁剪的最大 Token 阈值是多少？',
        '报告存储是否需要支持多租户隔离？',
      ];

      vi.spyOn(orchestratorService, 'orchestrate').mockResolvedValue({
        mode: 'fixed_workflow',
        status: 'clarification_needed',
        clarificationQuestions: clarifyQuestions,
        usedAgents: ['extractAgent', 'clarifyAgent'],
        fallback: null,
        steps: [],
        report: '',
      });

      const appendMessageSpy = vi.spyOn(memoryService, 'appendMessage');

      const response = await controller.analyze({
        sessionId: clarifySessionId,
        input: '我想做个系统',
      });

      // 验证返回状态为 clarification_needed 并返回澄清问题列表
      expect(response.status).toBe('clarification_needed');
      expect(response.needsClarification).toBe(true);
      expect(response.clarificationQuestions).toEqual(clarifyQuestions);
      expect(response.report).toBe('');

      // 验证未写入记忆
      expect(appendMessageSpy).not.toHaveBeenCalled();

      // 验证会话历史仍为空
      const history = await memoryService.getHistory(clarifySessionId);
      expect(history).toHaveLength(0);
    });
  });
});
