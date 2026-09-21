/**
 * metrics.ts
 *
 * Prometheus 指标注册中心（prom-client）。暴露 RED 指标（Rate/Errors/Duration）+ AI 特化指标。
 *
 * 边界声明：prom-client 只在【本进程内】累加指标，并由 `GET /metrics` 暴露文本格式。
 * Prometheus Server / Grafana 属于外部基建，不在本服务职责内。
 *
 * 高基数纪律：metrics 的 label 必须是低基数的（method / route / status / node）。
 * traceId、会话 ID、用户输入原文**绝不能**出现在 label 里——那会让 Prometheus 内存爆炸。
 * 见 normalizeRoute()：它把路由里的 ID 段归一成 `:id`，从根上避免「每个会话一条时间序列」。
 */
import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry }); // 进程级默认指标（CPU/内存/GC/句柄）

/** 普通 HTTP 请求耗时。SSE 不进这个直方图（见 sseStreamDuration 注释）。 */
export const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP 请求耗时（不含 SSE 长连接）',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.05, 0.1, 0.3, 1, 3, 10, 30],
  registers: [registry],
});

/**
 * SSE 长连接存活时长。
 *
 * 为什么必须单独一个直方图：SSE 的 `res.on('finish')` 在客户端断开时才触发，
 * 此时 elapsedMs 是「整条流的分钟级耗时」，而 HTTP 直方图的 buckets 上限是 30s——
 * 混在一起会让所有 SSE 请求落进 +Inf 桶，把 P99 彻底带偏。
 */
export const sseStreamDuration = new Histogram({
  name: 'sse_stream_duration_seconds',
  help: 'SSE 流从建连到断开的总时长',
  buckets: [1, 5, 15, 30, 60, 180, 600, 1800],
  registers: [registry],
});

const llmCalls = new Counter({
  name: 'llm_calls_total',
  help: 'LLM 调用次数',
  labelNames: ['ok'],
  registers: [registry],
});

const llmTokens = new Counter({
  name: 'llm_tokens_total',
  help: 'LLM token 总量',
  labelNames: ['direction'], // direction=input|output
  registers: [registry],
});

const llmLatency = new Histogram({
  name: 'llm_call_duration_seconds',
  help: '单次 LLM 调用耗时',
  buckets: [0.3, 1, 3, 10, 30, 60],
  registers: [registry],
});

/**
 * 按 LangGraph 节点切分的 LLM 耗时。
 * node 的取值集合受图节点数量约束（十几个），属于低基数，可以安全作为 label。
 */
const llmNodeLatency = new Histogram({
  name: 'llm_node_duration_seconds',
  help: '按图节点切分的单次 LLM 调用耗时',
  labelNames: ['node'],
  buckets: [0.3, 1, 3, 10, 30, 60],
  registers: [registry],
});

export const sseConnections = new Gauge({
  name: 'sse_active_connections',
  help: '当前活跃 SSE 连接数',
  registers: [registry],
});

/** SSE 建连时调用（在 sse.service 的连接登记处）。 */
export function incSseConnection(): void {
  sseConnections.inc();
}

/** SSE 断开时调用。 */
export function decSseConnection(): void {
  sseConnections.dec();
}

/** 供 LlmTracer 在每次 LLM 调用结束时调用。 */
export function recordLlmCall(p: {
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  ok: boolean;
  /** 可选：LangGraph 节点名（低基数）。不传则只累加全局指标。 */
  node?: string;
}): void {
  llmCalls.inc({ ok: String(p.ok) });
  llmTokens.inc({ direction: 'input' }, p.inputTokens);
  llmTokens.inc({ direction: 'output' }, p.outputTokens);
  llmLatency.observe(p.latencyMs / 1000);
  if (p.node) {
    llmNodeLatency.observe({ node: p.node }, p.latencyMs / 1000);
  }
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const HEX_ID_RE = /^[0-9a-fA-F]{16,}$/;
const LONG_NUMERIC_RE = /^\d{6,}$/;

/**
 * 把路由路径里的实体 ID 归一成 `:id`，避免 label 高基数。
 *
 * 背景：Nest 的中间件里 `req.route` 未必已就绪，一旦回落到 `req.path`，
 * `/api/conversations/8f3c.../chat` 这种路径就会给每个会话创建一条独立时间序列。
 * 归一化后所有会话共享同一条序列。
 */
export function normalizeRoute(route: string): string {
  const path = (route.split('?')[0] ?? '').slice(0, 200);
  if (!path) return '/';
  return path
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      if (UUID_RE.test(seg) || HEX_ID_RE.test(seg) || LONG_NUMERIC_RE.test(seg)) return ':id';
      return seg;
    })
    .join('/');
}
