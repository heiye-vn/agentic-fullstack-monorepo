/**
 * chapter16-observability.spec.ts
 *
 * 第十六章《可观测性》配套测试
 *
 * Layer 1：零 LLM 依赖（确定性，默认全部执行）
 *   - trace-context：ALS 在嵌套异步里保持同一 traceId，并发请求互不串台
 *   - trace-context：conversationId / graphName 的写入与读取
 *   - logger.traceMixin：从 ALS 读当前 traceId
 *   - metrics：自定义指标注册、recordLlmCall 累加、normalizeRoute 防高基数
 *   - llm-tracer：usage 双口径提取；节点归属来自 metadata.langgraph_node；
 *                 usage 缺失时降级估算并标 isEstimated；失败调用也计数
 *   - llm-tracer + usageSink：配置了 sink 就落库，未配置不落库
 *   - TraceMiddleware：x-trace-id 复用/回写、SSE 与普通 HTTP 分开计时、
 *                      探针端点不打点
 *   - model.factory：模型收口处确实挂上了观测回调（这是「生产不漏采」的保证）
 *
 * Layer 2：真实 LLM 端到端（需 RUN_LLM_OBS_TESTS=1，会消耗额度）
 *   - 跑一次真实的单次模型调用，断言 llm_* 指标增长 + token_usages 落到 sink
 *
 * 运行方式：
 *   npx vitest run test/chapter16-observability.spec.ts
 *   RUN_LLM_OBS_TESTS=1 npx vitest run test/chapter16-observability.spec.ts
 */
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  Controller,
  Get,
  MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AppController } from '../src/app.controller.js';
import { AppService } from '../src/app.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RequirementService } from '../src/llm/requirement.service.js';
import {
  runWithTrace,
  getTraceId,
  getElapsedMs,
  newTraceId,
  setConversationId,
  getConversationId,
  setGraphName,
  getGraphName,
} from '../src/observability/trace-context.js';
import { traceMixin } from '../src/observability/logger.js';
import { registry, recordLlmCall, normalizeRoute } from '../src/observability/metrics.js';
import {
  LlmTracer,
  setUsageSink,
  flushUsageWrites,
  extractUsageFromLLMResult,
} from '../src/observability/llm-tracer.js';
import { TraceMiddleware } from '../src/observability/trace.middleware.js';
import { createChatModel } from '../src/llm/model.factory.js';
import type { TokenUsageRecord } from '../src/llm/cost/token-usage.service.js';
import { CostController } from '../src/llm/cost/cost.controller.js';

const RUN_LLM_OBS_TESTS = process.env.RUN_LLM_OBS_TESTS === '1';
const OBS_TEST_MODEL = process.env.LLM_OBS_TEST_MODEL || 'qwen3.7-flash-2026-07-15';

/** 取某个指标当前文本，便于做「调用前后是否增长」的断言 */
async function metricText(name: string): Promise<string> {
  return registry.getSingleMetricAsString(name);
}

/** 内存版 sink：断言「被调用 + 收到的字段」 */
function makeCapturingSink() {
  const records: TokenUsageRecord[] = [];
  const sink = {
    recordUsage: async (r: TokenUsageRecord) => {
      records.push(r);
    },
  };
  return { sink, records };
}

/** 最小可用的 express Response 替身：能捕获 finish 回调手动触发 */
function makeFakeRes() {
  const handlers: Record<string, () => void> = {};
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader: vi.fn((k: string, v: string) => {
      res.headers[k.toLowerCase()] = v;
    }),
    getHeader: (k: string) => res.headers[k.toLowerCase()],
    on: (ev: string, cb: () => void) => {
      handlers[ev] = cb;
    },
  };
  return { res, fire: (ev: string) => handlers[ev]?.() };
}

afterEach(() => {
  setUsageSink(null);
});

// ============================================================================
// Layer 1
// ============================================================================

describe('16.2 trace-context：AsyncLocalStorage', () => {
  it('上下文外读到 no-trace', () => {
    expect(getTraceId()).toBe('no-trace');
  });

  it('嵌套异步调用链里保持同一 traceId', async () => {
    const id = newTraceId();
    const seen: string[] = [];
    await runWithTrace(id, async () => {
      seen.push(getTraceId());
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 1));
      seen.push(getTraceId());
      await (async () => {
        seen.push(getTraceId());
      })();
    });
    expect(seen).toEqual([id, id, id]);
  });

  it('并发的两个请求互不串台', async () => {
    const a = newTraceId();
    const b = newTraceId();
    const [ra, rb] = await Promise.all([
      runWithTrace(a, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getTraceId();
      }),
      runWithTrace(b, async () => {
        await new Promise((r) => setTimeout(r, 2));
        return getTraceId();
      }),
    ]);
    expect(ra).toBe(a);
    expect(rb).toBe(b);
  });

  it('getElapsedMs 在上下文内 >= 0，上下文外为 0', async () => {
    expect(getElapsedMs()).toBe(0);
    const elapsed = await runWithTrace(newTraceId(), async () => {
      await new Promise((r) => setTimeout(r, 3));
      return getElapsedMs();
    });
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });

  it('conversationId 可在上下文内读写，上下文外写入是空操作', async () => {
    await runWithTrace(newTraceId(), async () => {
      expect(getConversationId()).toBeUndefined();
      setConversationId('conv-777');
      expect(getConversationId()).toBe('conv-777');
    });

    // 上下文外调用不应把状态泄漏到别的请求
    setConversationId('should-not-leak');
    expect(getConversationId()).toBeUndefined();
  });

  it('graphName 可在上下文内读写，上下文外写入是空操作', async () => {
    await runWithTrace(newTraceId(), async () => {
      expect(getGraphName()).toBeUndefined();
      setGraphName('requirement-analysis');
      expect(getGraphName()).toBe('requirement-analysis');
    });

    setGraphName('should-not-leak');
    expect(getGraphName()).toBeUndefined();
  });
});

describe('16.2 logger：traceMixin 自动注入 traceId', () => {
  it('mixin 在上下文内返回当前 traceId', async () => {
    const id = newTraceId();
    const injected = await runWithTrace(id, async () => traceMixin());
    expect(injected).toEqual({ traceId: id });
  });

  it('mixin 在上下文外返回 no-trace', () => {
    expect(traceMixin()).toEqual({ traceId: 'no-trace' });
  });
});

describe('16.7.1 metrics：注册、累加与防高基数', () => {
  it('registry 暴露自定义指标与进程默认指标', async () => {
    const text = await registry.metrics();
    expect(text).toContain('llm_calls_total');
    expect(text).toContain('llm_tokens_total');
    expect(text).toContain('llm_call_duration_seconds');
    expect(text).toContain('llm_node_duration_seconds');
    expect(text).toContain('http_request_duration_seconds');
    expect(text).toContain('sse_stream_duration_seconds');
    expect(text).toContain('sse_active_connections');
    expect(text).toContain('process_cpu_user_seconds_total');
  });

  it('recordLlmCall 让 llm_calls_total 与 token 计数增长', async () => {
    const before = await metricText('llm_calls_total');
    recordLlmCall({ latencyMs: 1200, inputTokens: 100, outputTokens: 40, ok: true });
    const after = await metricText('llm_calls_total');

    expect(after).toContain('llm_calls_total{ok="true"}');
    expect(after).not.toBe(before);
  });

  it('normalizeRoute 把实体 ID 归一成 :id（否则每个会话一条时间序列）', () => {
    expect(normalizeRoute('/api/conversations/8f3c1b2a-1111-4a2b-9c3d-1f2e3d4c5b6a/chat')).toBe(
      '/api/conversations/:id/chat',
    );
    expect(normalizeRoute('/api/orders/123456789')).toBe('/api/orders/:id');
    expect(normalizeRoute('/api/tasks/507f1f77bcf86cd799439011')).toBe('/api/tasks/:id');
    // 非 ID 段必须原样保留，否则会把不同接口聚成一条
    expect(normalizeRoute('/api/v1/conversations')).toBe('/api/v1/conversations');
    expect(normalizeRoute('/health')).toBe('/health');
    expect(normalizeRoute('/')).toBe('/');
  });
});

describe('16.4 llm-tracer：usage 提取与节点归属', () => {
  it('从 llmOutput.tokenUsage 提取（OpenAI callbacks 口径）', () => {
    const usage = extractUsageFromLLMResult({
      generations: [],
      llmOutput: { tokenUsage: { promptTokens: 30, completionTokens: 12 } },
    } as any);
    expect(usage).toMatchObject({ inputTokens: 30, outputTokens: 12 });
  });

  it('从 generations[].message.usage_metadata 提取（v2 口径）', () => {
    const usage = extractUsageFromLLMResult({
      generations: [[{ message: { usage_metadata: { input_tokens: 7, output_tokens: 3 } } } as any]],
      llmOutput: {},
    } as any);
    expect(usage).toMatchObject({ inputTokens: 7, outputTokens: 3 });
  });

  it('拿不到 usage 时返回 0 而不抛错', () => {
    expect(extractUsageFromLLMResult({ generations: [], llmOutput: {} } as any)).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it('handleLLMEnd 把 token 写进 sink，并从 metadata.langgraph_node 取节点名', async () => {
    const tracer = new LlmTracer();
    const { sink, records } = makeCapturingSink();
    setUsageSink(sink);

    const traceId = newTraceId();
    await runWithTrace(traceId, async () => {
      setConversationId('conv-obs');
      setGraphName('requirement-analysis');

      tracer.handleLLMStart(
        { id: ['langchain', 'chat_models', 'ChatOpenAI'] } as any,
        ['请分析这个需求'],
        'run-1',
        undefined,
        {},
        [],
        { langgraph_node: 'summaryStep', ls_model_name: 'qwen3.7-flash' },
      );
      tracer.handleLLMEnd(
        {
          generations: [],
          llmOutput: { tokenUsage: { promptTokens: 500, completionTokens: 200 } },
        } as any,
        'run-1',
      );

      await flushUsageWrites();
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      conversationId: 'conv-obs',
      graphName: 'requirement-analysis',
      nodeName: 'summaryStep',
      agentName: 'summaryStep',
      modelName: 'qwen3.7-flash',
      inputTokens: 500,
      outputTokens: 200,
      totalTokens: 700,
      isEstimated: false,
    });
    expect(records[0]!.latencyMs).toBeGreaterThanOrEqual(0);
    expect(records[0]!.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('usage 缺失时降级估算，并明确标记 isEstimated', async () => {
    const tracer = new LlmTracer();
    const { sink, records } = makeCapturingSink();
    setUsageSink(sink);

    tracer.handleLLMStart(
      { id: ['ChatOpenAI'] } as any,
      ['这是一段中文提示词用于估算输入 token'],
      'run-2',
      undefined,
      {},
      [],
      { langgraph_node: 'triage' },
    );
    // 模拟流式：provider 不回 usage，只能靠 new token 累计
    tracer.handleLLMNewToken('这', {} as any, 'run-2');
    tracer.handleLLMNewToken('是输出', {} as any, 'run-2');
    tracer.handleLLMEnd({ generations: [], llmOutput: {} } as any, 'run-2');
    await flushUsageWrites();

    expect(records).toHaveLength(1);
    expect(records[0]!.isEstimated).toBe(true);
    expect(records[0]!.inputTokens).toBeGreaterThan(0);
    expect(records[0]!.outputTokens).toBeGreaterThan(0);
  });

  it('未配置 sink 时只打指标不落库', async () => {
    const tracer = new LlmTracer();
    setUsageSink(null);

    tracer.handleLLMStart({ id: ['ChatOpenAI'] } as any, ['hi'], 'run-3', undefined, {}, [], {
      langgraph_node: 'chatHandler',
    });
    tracer.handleLLMEnd(
      { generations: [], llmOutput: { tokenUsage: { promptTokens: 3, completionTokens: 1 } } } as any,
      'run-3',
    );
    await flushUsageWrites();
    // 无 sink ⇒ 不抛错即可（落库出口由 sink 决定）
    expect(true).toBe(true);
  });

  it('handleLLMError 记为失败调用（错误率分母要对）', async () => {
    const tracer = new LlmTracer();
    const before = await metricText('llm_calls_total');
    tracer.handleLLMStart({ id: ['ChatOpenAI'] } as any, ['hi'], 'run-4', undefined, {}, [], {
      langgraph_node: 'riskStep',
    });
    tracer.handleLLMError(new Error('网关 502'), 'run-4');
    const after = await metricText('llm_calls_total');

    expect(after).toContain('llm_calls_total{ok="false"}');
    expect(after).not.toBe(before);
  });
});

describe('16.2.4 TraceMiddleware：入口建上下文与分场景计时', () => {
  let middleware: TraceMiddleware;

  beforeEach(() => {
    middleware = new TraceMiddleware();
  });

  it('复用上游 x-trace-id 并回写响应头', () => {
    const { res, fire } = makeFakeRes();
    const next = vi.fn();
    const req: any = { method: 'GET', path: '/hello', headers: { 'x-trace-id': 'upstream-id' } };

    middleware.use(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.setHeader).toHaveBeenCalledWith('x-trace-id', 'upstream-id');
    fire('finish');
  });

  it('没有上游 x-trace-id 时新建一个', () => {
    const { res, fire } = makeFakeRes();
    const req: any = { method: 'GET', path: '/hello', headers: {} };

    middleware.use(req, res, vi.fn());
    const header = res.headers['x-trace-id'];
    expect(typeof header).toBe('string');
    expect(header.length).toBeGreaterThan(10);
    fire('finish');
  });

  it('即使 finish 回调在 ALS 上下文外被触发，也能拿到 traceId 与耗时（中间件已捕获 store 引用）', async () => {
    const { res, fire } = makeFakeRes();
    const req: any = { method: 'GET', path: '/api/things', headers: { 'x-trace-id': 'flow-id' } };
    const before = await metricText('http_request_duration_seconds');

    middleware.use(req, res, vi.fn());
    // 关键：这里刻意在「没有任何 ALS 上下文」的同步栈里调用 finish 回调，
    // 模拟异步资源不传播上下文的情况。中间件若依赖 ALS 就会退化成 no-trace / 0ms。
    fire('finish');

    const after = await metricText('http_request_duration_seconds');
    expect(after).not.toBe(before);
    expect(after).toContain('route="/api/things"');
  });

  it('普通 HTTP 请求计入 http_request_duration_seconds', async () => {
    const before = await metricText('http_request_duration_seconds');
    const { res, fire } = makeFakeRes();
    const req: any = { method: 'POST', path: '/api/conversations', headers: {} };

    middleware.use(req, res, vi.fn());
    fire('finish');
    const after = await metricText('http_request_duration_seconds');

    expect(after).not.toBe(before);
    expect(after).toContain('route="/api/conversations"');
  });

  it('SSE 流单独计时，不污染 HTTP 直方图（否则全落 +Inf 桶）', async () => {
    const httpBefore = await metricText('http_request_duration_seconds');
    const sseBefore = await metricText('sse_stream_duration_seconds');

    const { res, fire } = makeFakeRes();
    res.headers['content-type'] = 'text/event-stream; charset=utf-8';
    const req: any = {
      method: 'POST',
      path: '/api/conversations/8f3c1b2a-1111-4a2b-9c3d-1f2e3d4c5b6a/chat',
      headers: {},
    };

    middleware.use(req, res, vi.fn());
    fire('finish');

    const httpAfter = await metricText('http_request_duration_seconds');
    const sseAfter = await metricText('sse_stream_duration_seconds');

    expect(sseAfter).not.toBe(sseBefore);
    expect(httpAfter).toBe(httpBefore);
  });

  it('探针端点自身不打点，避免抓取流量盖过业务', async () => {
    const before = await metricText('http_request_duration_seconds');
    const { res, fire } = makeFakeRes();
    const req: any = { method: 'GET', path: '/metrics', headers: {} };

    middleware.use(req, res, vi.fn());
    fire('finish');

    expect(await metricText('http_request_duration_seconds')).toBe(before);
  });
});

describe('16.4 模型收口：createChatModel 必须挂上观测回调', () => {
  it('工厂产出的模型实例 callbacks 里带 llm-tracer', () => {
    const model = createChatModel({ streaming: false });
    const callbacks = (model as any).callbacks as Array<{ name?: string }> | undefined;

    expect(Array.isArray(callbacks)).toBe(true);
    expect(callbacks!.map((c) => c?.name)).toContain('llm-tracer');
  });

  it('同一个 handler 实例被复用（runId 表只有一份）', () => {
    const a = createChatModel({ streaming: false });
    const b = createChatModel({ streaming: true });
    expect((a as any).callbacks?.[0]).toBe((b as any).callbacks?.[0]);
  });
});

// ============================================================================
// 真实 HTTP 往返：验证中间件在真实的 Express + Node 栈里的行为
// （单测里手工触发 finish 是合成场景，ALS 传播行为与真实链路上并不等价）
// ============================================================================

let httpProbeSeen: Array<{ where: string; traceId: string }> = [];

@Controller('api/things')
class HttpProbeController {
  @Get(':id')
  get(): { traceId: string; conversationId?: string } {
    setConversationId('conv-http');
    httpProbeSeen.push({ where: 'handler', traceId: getTraceId() });
    return { traceId: getTraceId(), conversationId: getConversationId() };
  }
}

@Module({ controllers: [HttpProbeController] })
class HttpProbeModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceMiddleware).forRoutes('*');
  }
}

describe('16.2.4 真实 HTTP 往返：traceId 贯穿业务代码与 access 阶段', () => {
  it('业务侧读到同一 traceId，响应头回写，路由 label 归一化', async () => {
    httpProbeSeen = [];
    const app = await NestFactory.create(HttpProbeModule, { logger: false });
    await app.listen(0);
    const port = (app.getHttpServer().address() as { port: number }).port;
    const before = await metricText('http_request_duration_seconds');

    let body: { traceId: string; conversationId?: string };
    let echoedHeader: string | null;
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/things/8f3c1b2a-1111-4a2b-9c3d-1f2e3d4c5b6a`,
        { headers: { 'x-trace-id': 'http-probe-trace' } },
      );
      body = (await res.json()) as { traceId: string; conversationId?: string };
      echoedHeader = res.headers.get('x-trace-id');
    } finally {
      await app.close();
    }

    await new Promise((r) => setTimeout(r, 20));
    const after = await metricText('http_request_duration_seconds');

    // 业务代码（controller 内部）能看到请求级 traceId 与会话 ID
    expect(echoedHeader).toBe('http-probe-trace');
    expect(body.traceId).toBe('http-probe-trace');
    expect(body.conversationId).toBe('conv-http');
    expect(httpProbeSeen.every((p) => p.traceId === 'http-probe-trace')).toBe(true);

    // 带 UUID 的真实路径被归一化，不会给每个会话造一条时间序列
    expect(after).not.toBe(before);
    expect(after).toContain('route="/api/things/:id"');
  }, 30_000);
});

// ============================================================================
// 16.7.2 readiness 与 16.7.1 /metrics：端点行为
// ============================================================================

describe('16.7 readiness 与 /metrics 端点', () => {
  async function makeApp(prisma: unknown) {
    const moduleRef = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: PrismaService, useValue: prisma },
        { provide: RequirementService, useValue: { extract: vi.fn() } },
      ],
    }).compile();
    return moduleRef.get(AppController);
  }

  function fakeRes() {
    const res: any = {
      statusCode: 200,
      body: undefined as unknown,
      status: vi.fn((code: number) => {
        res.statusCode = code;
        return res;
      }),
      json: vi.fn((payload: unknown) => {
        res.body = payload;
        return res;
      }),
    };
    return res;
  }

  it('DB 可用时 /ready 返回 200 且 checks.db = ok', async () => {
    const controller = await makeApp({ $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]) });
    const res = fakeRes();

    await controller.ready(res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ready: true, checks: { db: 'ok' } });
  });

  it('DB 不可用时 /ready 返回 503（摘流而不是重启）', async () => {
    const controller = await makeApp({
      $queryRaw: vi.fn().mockRejectedValue(new Error('connection refused')),
    });
    const res = fakeRes();

    await controller.ready(res);

    expect(res.statusCode).toBe(503);
    expect((res.body as { ready: boolean }).ready).toBe(false);
    expect((res.body as { checks: Record<string, string> }).checks.db).toContain('fail');
  });

  it('liveness 刻意不探依赖，永远 ok', async () => {
    const controller = await makeApp({
      $queryRaw: vi.fn().mockRejectedValue(new Error('down')),
    });
    expect(controller.getHealth()).toEqual({ ok: true });
  });

  it('/metrics 返回 Prometheus 文本格式且含本章新增指标', async () => {
    const controller = await makeApp({ $queryRaw: vi.fn() });

    const text = await controller.metrics();

    expect(text).toContain('llm_calls_total');
    expect(text).toContain('sse_stream_duration_seconds');
    expect(text).toContain('llm_node_duration_seconds');
    expect(text).toContain('http_request_duration_seconds');
  });
});

// ============================================================================
// Layer 2：真实 LLM（需 RUN_LLM_OBS_TESTS=1，会消耗额度）
// ============================================================================

describe('16.4 真实调用端到端（Layer 2）', () => {
  it.skipIf(!RUN_LLM_OBS_TESTS)(
    '一次真实模型调用 → llm_* 指标增长且落进 token_usages',
    async () => {
      const { sink, records } = makeCapturingSink();
      setUsageSink(sink);

      const model = createChatModel({
        modelName: OBS_TEST_MODEL,
        streaming: false,
        disableThinking: true,
      });

      const traceId = newTraceId();
      const callsBefore = await metricText('llm_calls_total');

      await runWithTrace(traceId, async () => {
        setConversationId('obs-e2e');
        await model.invoke('只回复两个字：收到');
        await flushUsageWrites();
      });

      const callsAfter = await metricText('llm_calls_total');
      expect(callsAfter).not.toBe(callsBefore);
      expect(records.length).toBeGreaterThanOrEqual(1);
      expect(records.some((r) => (r.totalTokens ?? 0) > 0)).toBe(true);
      // 非图调用走 direct-call 分支
      expect(records.every((r) => r.graphName === 'direct-call')).toBe(true);
    },
    180_000,
  );
});

// ============================================================================
// 16.4.3 成本查询端点：GET /api/cost/summary
// ============================================================================

describe('16.4.3 /api/cost/summary 成本查询', () => {
  /**
   * 三个聚合查询的最小替身。顺带用「在途计数」探针记录并发峰值：
   * 若控制器写成了串行 await，峰值只会是 1；并行发出才会达到 3。
   */
  function makeUsage() {
    let inFlight = 0;
    let peakInFlight = 0;

    const probe = <T>(value: T) =>
      vi.fn(async () => {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return value;
      });

    const usage = {
      getMonthlyStats: probe({
        totalCost: 1.23,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        totalCachedTokens: 0,
        calls: 7,
      }),
      getStatsByNode: probe([
        { nodeName: 'analysisStep', totalCost: 0.9, calls: 5, avgInputTokens: 180 },
      ]),
      getStatsByAgent: probe([{ agentName: 'functional', totalCost: 0.9, calls: 5 }]),
      peakInFlight: () => peakInFlight,
    };
    return usage;
  }

  it('汇总总账 + 按节点 + 按 Agent 三张表，且三个查询并行发出', async () => {
    const usage = makeUsage();
    const controller = new CostController(usage as never);

    const result = await controller.summary();

    expect(result.monthly.calls).toBe(7);
    expect(result.byNode[0].nodeName).toBe('analysisStep');
    expect(result.byAgent[0].agentName).toBe('functional');

    // 三张表都必须被取到（漏掉任何一张，前端就拿不到完整成本视图）
    expect(usage.getMonthlyStats).toHaveBeenCalledTimes(1);
    expect(usage.getStatsByNode).toHaveBeenCalledTimes(1);
    expect(usage.getStatsByAgent).toHaveBeenCalledTimes(1);
    // 峰值 3 证明是 Promise.all 并行，而不是串行 await 白等两轮
    expect(usage.peakInFlight()).toBe(3);
  });

  it('必须在 JwtAuthGuard 之下 —— 成本数据不能裸奔', () => {
    // 用 Nest 的守卫元数据锁定这一约束，避免后续重构顺手删掉 @UseGuards
    const guards: unknown[] =
      Reflect.getMetadata('__guards__', CostController) ?? [];
    expect(guards.length).toBeGreaterThan(0);
  });
});
