import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { AppModule } from '../src/app.module.js';
import { OrchestratorService } from '../src/llm/agents/orchestrator.service.js';
import { RunnableMemoryService } from '../src/llm/memory/runnable-memory.service.js';
import {
  DEFAULT_WORKSPACE_ROOT,
  resolveSafePath,
} from '../src/llm/tools/business.tools.js';

describe('Advanced Analysis E2E Spec (/api/advanced/analyze)', () => {
  let app: INestApplication;
  let orchestratorService: OrchestratorService;
  let memoryService: RunnableMemoryService;

  const sessionId = 'e2e-session-advanced-001';
  const reqId = 'REQ-2026-001';
  let createdReportFile: string | null = null;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    orchestratorService =
      moduleFixture.get<OrchestratorService>(OrchestratorService);
    memoryService =
      moduleFixture.get<RunnableMemoryService>(RunnableMemoryService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    if (createdReportFile && existsSync(createdReportFile)) {
      try {
        await fs.unlink(createdReportFile);
      } catch {
        // ignore
      }
      createdReportFile = null;
    }
    vi.restoreAllMocks();
  });

  describe('完整四轮多轮闭环分析测试场景', () => {
    it('前三轮通过 /api/memory/chat 发送，第四轮通过 /api/advanced/analyze 触发分析并完成闭环', async () => {
      // 模拟第 1-3 轮 memoryService.chat 回复并写入历史记录
      vi.spyOn(memoryService, 'chat').mockImplementation(
        async (sid: string, input: string) => {
          const reply = `已收到：${input}`;
          await memoryService.appendMessage(sid, input, reply);
          return reply;
        },
      );

      // 1. 发送第 1 轮
      const r1 = await request(app.getHttpServer())
        .post('/api/memory/chat')
        .send({
          sessionId,
          input: '我们想做一个需求分析助手，希望它能记住多轮对话',
        });
      expect(r1.status).toBe(201);
      expect(r1.body.success).toBe(true);

      // 2. 发送第 2 轮
      const r2 = await request(app.getHttpServer())
        .post('/api/memory/chat')
        .send({
          sessionId,
          input: `需求单号是 ${reqId}`,
        });
      expect(r2.status).toBe(201);

      // 3. 发送第 3 轮
      const r3 = await request(app.getHttpServer())
        .post('/api/memory/chat')
        .send({
          sessionId,
          input: '核心功能是多轮需求分析、上下文自动裁剪与报告生成，面向系统架构师',
        });
      expect(r3.status).toBe(201);

      // 验证历史中已累积 6 条记录（3 轮 human + ai）
      const histRes = await request(app.getHttpServer()).get(
        `/api/memory/history/${sessionId}`,
      );
      expect(histRes.status).toBe(200);
      expect(histRes.body.count).toBe(6);

      // 4. 模拟第 4 轮 Orchestrator 返回
      const expectedReport = `# 需求分析规格报告：${reqId}\n## 一、 需求基本信息\n- 单号：${reqId}\n## 二、 完整性评估\n通过 (100分)`;
      const orchestrateSpy = vi
        .spyOn(orchestratorService, 'orchestrate')
        .mockImplementation(async (combinedInput: string) => {
          expect(combinedInput).toContain(reqId);
          expect(combinedInput).toContain('我们想做一个需求分析助手');
          expect(combinedInput).toContain('帮我判断这个需求是否完整');
          return {
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
            steps: [],
            report: expectedReport,
          };
        });

      // 发送第 4 轮 POST /api/advanced/analyze
      const r4 = await request(app.getHttpServer())
        .post('/api/advanced/analyze')
        .send({
          sessionId,
          input: '帮我判断这个需求是否完整，并产出一份需求分析报告',
        });

      expect(r4.status).toBe(201);
      expect(orchestrateSpy).toHaveBeenCalledTimes(1);
      expect(r4.body.status).toBe('completed');
      expect(r4.body.needsClarification).toBe(false);
      expect(r4.body.report).toBe(expectedReport);
      expect(r4.body.reportPath).toBe(`reports/${reqId}-analysis.md`);

      // 验证报告文件确实在 workspace/reports 写入
      createdReportFile = resolveSafePath(
        `reports/${reqId}-analysis.md`,
        DEFAULT_WORKSPACE_ROOT,
      );
      expect(existsSync(createdReportFile)).toBe(true);
      const savedReport = await fs.readFile(createdReportFile, 'utf-8');
      expect(savedReport).toBe(expectedReport);

      // 验证第 4 轮写回会话记忆，此时历史总数应增加为 8 条（无需重新调用模型）
      const histAfter = await request(app.getHttpServer()).get(
        `/api/memory/history/${sessionId}`,
      );
      expect(histAfter.status).toBe(200);
      expect(histAfter.body.count).toBe(8);
      expect(histAfter.body.history[7].content).toBe(expectedReport);
    });

    it('当缺少必要字段时应返回 400 BadRequest 错误', async () => {
      const badRes1 = await request(app.getHttpServer())
        .post('/api/advanced/analyze')
        .send({ sessionId: '', input: '有效问题' });
      expect(badRes1.status).toBe(400);

      const badRes2 = await request(app.getHttpServer())
        .post('/api/advanced/analyze')
        .send({ sessionId: 's1', input: '' });
      expect(badRes2.status).toBe(400);
    });

    it('当需求不完整需要澄清时，应返回 201 且 status 为 clarification_needed', async () => {
      vi.spyOn(orchestratorService, 'orchestrate').mockResolvedValue({
        mode: 'fixed_workflow',
        status: 'clarification_needed',
        clarificationQuestions: ['请问目标系统有哪些性能指标？'],
        usedAgents: ['extractAgent', 'clarifyAgent'],
        fallback: null,
        steps: [],
        report: '',
      });

      const res = await request(app.getHttpServer())
        .post('/api/advanced/analyze')
        .send({
          sessionId: 'new-session-clarify',
          input: '请问该如何做',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('clarification_needed');
      expect(res.body.needsClarification).toBe(true);
      expect(res.body.clarificationQuestions).toHaveLength(1);
      expect(res.body.report).toBe('');
    });
  });
});
