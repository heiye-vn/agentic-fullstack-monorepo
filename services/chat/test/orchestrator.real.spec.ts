import { describe, it, expect } from 'vitest';
import { OrchestratorService } from '../src/llm/agents/orchestrator.service.js';

/**
 * Layer 2：真实大模型 Multi-Agent 编排集成验证（第九章产物）
 *
 * 第十九章补齐分层守卫：本文件写于 Layer 1 / Layer 2 约定确立之前，
 * 是无条件跑真模型的 Layer 2 用例——在没有 OPENAI_API_KEY 的环境（典型如 CI）
 * 必然失败。这里按第十四/十五/十六/十七章的既定约定补上 skipIf 守卫：
 *
 *   pnpm vitest run test/orchestrator.real.spec.ts                  # 默认跳过
 *   RUN_LLM_ORCHESTRATOR_TESTS=1 OPENAI_API_KEY=... pnpm vitest ... # 本地显式开启
 *
 * 这样 CI 天然只跑便宜且确定的 Layer 1，无需为个别用例做特殊处理。
 */
const RUN_LLM = process.env.RUN_LLM_ORCHESTRATOR_TESTS === '1';

// RUN_LLM 为假时整个 describe 跳过，下面的 it 不会被执行
describe.skipIf(!RUN_LLM)('真实大模型 Multi-Agent 固定编排集成验证', () => {
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
