import { describe, it, expect } from 'vitest';
import { OrchestratorService } from '../src/llm/agents/orchestrator.service.js';

describe('真实大模型 Multi-Agent 固定编排集成验证', () => {
  const TEST_INPUT =
    '开发一个面向需求分析师的会话记忆系统，支持多轮澄清并自动裁剪长对话上下文';

  it(
    '使用指定测试输入端到端跑通 5 个 Agent 固定编排工作流',
    async () => {
      const orchestrator = new OrchestratorService();
      const result = await orchestrator.orchestrate(TEST_INPUT);

      console.log('真实多 Agent 编排结果状态:', result.status);
      console.log('实际参与 Agent 列表:', result.usedAgents);
      console.log('生成的报告字数:', result.report.length);

      expect(result.mode).toBe('fixed_workflow');
      expect(['completed', 'clarification_needed']).toContain(result.status);
      expect(result.fallback).toBeNull();
      expect(result.usedAgents.length).toBeGreaterThanOrEqual(2);
      expect(result.steps.length).toBeGreaterThanOrEqual(2);

      if (result.status === 'completed') {
        expect(result.report).toBeTruthy();
        expect(result.usedAgents).toEqual([
          'extractAgent',
          'clarifyAgent',
          'analysisAgent',
          'riskAgent',
          'summaryAgent',
        ]);
      } else {
        expect(result.clarificationQuestions.length).toBeGreaterThan(0);
      }
    },
    180000,
  );
});
