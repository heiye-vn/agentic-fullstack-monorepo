import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import {
  OrchestratorService,
  type OrchestrationResult,
} from '../src/llm/agents/orchestrator.service.js';

describe('Agents Controller E2E Spec (/api/agents/orchestrate)', () => {
  let app: INestApplication;
  let orchestratorService: OrchestratorService;

  const TEST_INPUT =
    '开发一个面向需求分析师的会话记忆系统，支持多轮澄清并自动裁剪长对话上下文';

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
      { agent: 'extractAgent', status: 'success', durationMs: 120 },
      { agent: 'clarifyAgent', status: 'success', durationMs: 85 },
      { agent: 'analysisAgent', status: 'success', durationMs: 340 },
      { agent: 'riskAgent', status: 'success', durationMs: 310 },
      { agent: 'summaryAgent', status: 'success', durationMs: 260 },
    ],
    report:
      '# 需求分析规格报告：开发面向需求分析师的会话记忆系统\n## 1. 需求概述\n面向需求分析师的会话记忆系统...',
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    orchestratorService =
      moduleFixture.get<OrchestratorService>(OrchestratorService);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  describe('POST /api/agents/orchestrate', () => {
    it('正常请求应返回 201 状态码与全部指定字段', async () => {
      const orchestrateSpy = vi
        .spyOn(orchestratorService, 'orchestrate')
        .mockResolvedValue(mockOrchestrationResult);

      const response = await request(app.getHttpServer())
        .post('/api/agents/orchestrate')
        .send({ input: TEST_INPUT })
        .expect(201);

      expect(orchestrateSpy).toHaveBeenCalledWith(TEST_INPUT);
      expect(response.body).toEqual(mockOrchestrationResult);
      expect(response.body.mode).toBe('fixed_workflow');
      expect(response.body.status).toBe('completed');
      expect(response.body.clarificationQuestions).toEqual([]);
      expect(response.body.usedAgents).toEqual([
        'extractAgent',
        'clarifyAgent',
        'analysisAgent',
        'riskAgent',
        'summaryAgent',
      ]);
      expect(response.body.fallback).toBeNull();
      expect(response.body.steps).toHaveLength(5);
      expect(response.body.report).toContain('面向需求分析师的会话记忆系统');
    });

    it('当输入为空或无 input 字段时，应返回 400 错误', async () => {
      await request(app.getHttpServer())
        .post('/api/agents/orchestrate')
        .send({})
        .expect(400);

      await request(app.getHttpServer())
        .post('/api/agents/orchestrate')
        .send({ input: '   ' })
        .expect(400);
    });

    it('当需求需要澄清时，返回 status 为 clarification_needed 且附带澄清问题', async () => {
      const mockClarifyResult: OrchestrationResult = {
        mode: 'fixed_workflow',
        status: 'clarification_needed',
        clarificationQuestions: [
          '请明确长对话上下文裁剪采用按 Token 数滑动窗口还是关键实体摘要保留策略？',
        ],
        usedAgents: ['extractAgent', 'clarifyAgent'],
        fallback: null,
        steps: [
          { agent: 'extractAgent', status: 'success', durationMs: 100 },
          { agent: 'clarifyAgent', status: 'success', durationMs: 90 },
        ],
        report: '',
      };

      vi.spyOn(orchestratorService, 'orchestrate').mockResolvedValue(
        mockClarifyResult,
      );

      const response = await request(app.getHttpServer())
        .post('/api/agents/orchestrate')
        .send({ input: '做一个记忆系统' })
        .expect(201);

      expect(response.body.status).toBe('clarification_needed');
      expect(response.body.clarificationQuestions).toHaveLength(1);
      expect(response.body.usedAgents).toEqual(['extractAgent', 'clarifyAgent']);
      expect(response.body.report).toBe('');
    });

    it('当编排遇到严重异常时，返回 status 为 failed 且 fallback 为 manual_review', async () => {
      const mockFailedResult: OrchestrationResult = {
        mode: 'fixed_workflow',
        status: 'failed',
        clarificationQuestions: [],
        usedAgents: ['extractAgent'],
        fallback: 'manual_review',
        steps: [
          {
            agent: 'extractAgent',
            status: 'failed',
            durationMs: 0,
            error: 'Downstream timeout',
          },
        ],
        report: '',
      };

      vi.spyOn(orchestratorService, 'orchestrate').mockResolvedValue(
        mockFailedResult,
      );

      const response = await request(app.getHttpServer())
        .post('/api/agents/orchestrate')
        .send({ input: TEST_INPUT })
        .expect(201);

      expect(response.body.status).toBe('failed');
      expect(response.body.fallback).toBe('manual_review');
      expect(response.body.report).toBe('');
    });
  });
});
