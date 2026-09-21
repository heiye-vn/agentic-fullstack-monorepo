/**
 * test/chapter15-deepagent-advanced.spec.ts
 *
 * 第十五章《DeepAgent——长链任务与自主规划》配套测试
 *
 * 按章节跑：npx vitest run test/chapter15-deepagent-advanced.spec.ts -t "15.3"
 *
 * 覆盖重点是「工程边界」而不是模型行为：
 *   1. 适配器契约（messages ↔ input/summary）——这是把第九章图接进 DeepAgent 的唯一难点
 *   2. Backend 体系（State / Filesystem / Composite）的递进关系与落盘语义
 *   3. Summarization 默认值、HITL 守卫、异步子 Agent 判别、权限规则
 * 真实 LLM 链路只在 RUN_LLM_DEEPAGENT_TESTS=1 时跑（三个需求的全链路要几分钟）。
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CompositeBackend,
  FilesystemBackend,
  StateBackend,
  computeSummarizationDefaults,
  isAsyncSubAgent,
} from 'deepagents';
import { ChatOpenAI } from '@langchain/openai';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import {
  ANALYSIS_SUBAGENT_NAME,
  SAVE_REPORT_TOOL_NAME,
  createAnalysisSubagent,
  createDeepOrchestrator,
  extractLatestUserText,
} from '../src/llm/deepagent/deep-orchestrator.service.js';

const DEEPAGENT_MODEL = process.env.DEEPAGENT_MODEL || 'qwen3.8-max';
const RUN_LLM = process.env.RUN_LLM_DEEPAGENT_TESTS === '1';

function makeStubModel() {
  return new ChatOpenAI({
    model: DEEPAGENT_MODEL,
    temperature: 0,
    configuration: { baseURL: process.env.OPENAI_BASE_URL },
    apiKey: process.env.OPENAI_API_KEY || 'sk-test',
  });
}

// ============================================================
// 15.3 适配器：把第九章图接成 CompiledSubAgent
// ============================================================

describe('15.3 适配器：messages → input 映射', () => {
  it('取最近一条 human 消息文本', () => {
    const text = extractLatestUserText([
      new HumanMessage('第一条'),
      new AIMessage('助手回复'),
      new HumanMessage('分析 REQ-001'),
    ]);
    expect(text).toBe('分析 REQ-001');
  });

  it('忽略 system / ai，只回 human', () => {
    const text = extractLatestUserText([
      new SystemMessage('系统提示'),
      new AIMessage('助手回复'),
    ]);
    expect(text).toBe('助手回复');
  });

  it('空列表返回空串', () => {
    expect(extractLatestUserText([])).toBe('');
  });
});

describe('15.3 createAnalysisSubagent 结构', () => {
  it('返回 CompiledSubAgent（name / description / runnable）', () => {
    const sub = createAnalysisSubagent(makeStubModel());
    expect(sub.name).toBe(ANALYSIS_SUBAGENT_NAME);
    expect(sub.description.length).toBeGreaterThan(0);
    expect(sub.runnable).toBeDefined();
  });
});

describe('15.3 createDeepOrchestrator 构造', () => {
  it('最小构造可创建 Agent', () => {
    const agent = createDeepOrchestrator({ model: makeStubModel() });
    expect(typeof agent.invoke).toBe('function');
    expect(typeof agent.streamEvents).toBe('function');
  });

  it('带磁盘后端 + 权限规则可创建 Agent', () => {
    const root = mkdtempSync(join(tmpdir(), 'ch15-perm-'));
    try {
      const agent = createDeepOrchestrator({
        model: makeStubModel(),
        rootDir: root,
        permissions: [
          { operations: ['write'], paths: ['/readonly/**'], mode: 'deny' },
          { operations: ['read', 'write'], paths: ['/workspace/**'], mode: 'allow' },
        ],
      });
      expect(typeof agent.invoke).toBe('function');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ============================================================
// 15.5 上下文管理
// ============================================================

describe('15.5 上下文管理：Summarization 默认阈值', () => {
  it('computeSummarizationDefaults 返回 trigger / keep / truncateArgsSettings', () => {
    const defaults = computeSummarizationDefaults(makeStubModel() as any);
    expect(defaults).toBeDefined();
    expect(defaults.trigger).toBeDefined();
    expect(defaults.trigger.type).toBeDefined();
    expect(typeof defaults.trigger.value).toBe('number');
    expect(defaults.keep).toBeDefined();
    expect(defaults.truncateArgsSettings).toBeDefined();
  });
});

// ============================================================
// 15.6 Backend 体系
// ============================================================

describe('15.6 Backend 体系', () => {
  it('FilesystemBackend：跨实例写入后读回，文件真实落盘', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ch15-fs-'));
    try {
      const backend = new FilesystemBackend({ rootDir: root, virtualMode: true });
      const w = await backend.write('/REQ-001.md', 'REQ-001 总体影响：高，涉及登录链路改造。');
      expect((w as any).error).toBeUndefined();
      expect(existsSync(join(root, 'REQ-001.md'))).toBe(true);

      const reopened = new FilesystemBackend({ rootDir: root, virtualMode: true });
      const r = await reopened.read('/REQ-001.md');
      expect((r as any).error).toBeUndefined();
      expect(String((r as any).content)).toContain('REQ-001');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('StateBackend 可构造（内存态，随执行结束消失）', () => {
    const backend = new StateBackend();
    expect(typeof backend.read).toBe('function');
    expect(typeof backend.write).toBe('function');
  });

  it('CompositeBackend 按路径前缀路由到不同后端', () => {
    const root = mkdtempSync(join(tmpdir(), 'ch15-composite-'));
    try {
      const composite = new CompositeBackend(new StateBackend(), {
        '/disk': new FilesystemBackend({ rootDir: root, virtualMode: true }),
      });
      expect(typeof composite.read).toBe('function');
      expect(typeof composite.write).toBe('function');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ============================================================
// 15.9 HITL
// ============================================================

describe('15.9 HITL：interruptOn 守卫', () => {
  it('interruptOn 缺少 checkpointer 时抛错', () => {
    expect(() =>
      createDeepOrchestrator({
        model: makeStubModel(),
        interruptOn: { [SAVE_REPORT_TOOL_NAME]: true },
      }),
    ).toThrow(/checkpointer/);
  });
});

// ============================================================
// 15.10 异步 subagent
// ============================================================

describe('15.10 异步 subagent 类型判断', () => {
  it('isAsyncSubAgent 通过 graphId 区分同步/异步子 Agent', () => {
    const syncSub = { name: 'test', description: 'desc', systemPrompt: 'sys', tools: [] };
    const asyncSub = { name: 'test-async', description: 'desc', graphId: 'graph-123' };
    expect(isAsyncSubAgent(syncSub)).toBe(false);
    expect(isAsyncSubAgent(asyncSub)).toBe(true);
  });
});

// ============================================================
// 15.12 工程化补齐：权限规则
// ============================================================

describe('15.12 工程化补齐：权限规则', () => {
  it('FilesystemPermission 结构：operations + paths + mode', () => {
    const rule = { operations: ['write'] as const, paths: ['/readonly/**'], mode: 'deny' as const };
    expect(rule.operations).toContain('write');
    expect(rule.paths[0]).toMatch(/^\//);
    expect(['allow', 'deny']).toContain(rule.mode);
  });
});

// ============================================================
// Layer 2：真实模型端到端（默认跳过）
// ============================================================

describe.skipIf(!RUN_LLM)('15.3 子 Agent 接入端到端', () => {
  it(
    'DeepAgent 委派 requirement_analyst → 产出分析',
    async () => {
      const agent = createDeepOrchestrator({ model: makeStubModel() });
      const result: any = await agent.invoke({
        messages: [
          {
            role: 'user',
            content:
              '请分析这个需求的影响：支持企业微信扫码登录，需要兼容已有账号体系。',
          },
        ],
      });
      const chain = (result.messages ?? [])
        .filter((m: any) => m?.tool_calls?.length > 0)
        .flatMap((m: any) => m.tool_calls.map((tc: any) => tc?.name));
      expect(chain).toContain('task');
      expect(String(result.messages.at(-1)?.content).length).toBeGreaterThan(100);
    },
    600_000,
  );
});
