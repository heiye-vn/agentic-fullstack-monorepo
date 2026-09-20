/**
 * src/mcp/mcp-trace.ts
 *
 * 第十二章 12.12 — MCP 可观测性
 *
 * 一次 Agent 请求里往往会有多次 MCP 调用（分析 → 检索 → 搜索 → 估算），
 * 没有 trace 就只能看到"最终回答慢"，却说不清慢在哪个 Server。
 *
 * 这里的字段与第十章 Token Usage、第十一章 RAG Trace 共用 requestId /
 * conversationId / userId 三个维度，便于后续合并到同一条链路。
 */

export type MCPCallStatus =
  | 'success'
  | 'error'
  | 'timeout'
  | 'denied'
  | 'fallback';

export interface MCPCallTrace {
  /** 一次 Agent 请求内共享，用于把多次 MCP 调用串成一条链 */
  requestId: string;
  conversationId?: string;
  userId?: string;
  /** 来源 Server（注册时的 id） */
  serverId: string;
  /** 调用时的工具名（已带前缀） */
  toolName: string;
  /** 底层 MCP Server 里的原始工具名 */
  rawToolName: string;
  /** 入参序列化后的字节数，用于发现"模型塞了超长参数" */
  inputSize: number;
  /** 出参序列化后的字节数，用于发现"工具结果撑爆上下文" */
  outputSize: number;
  /** 出参的粗估 token 数，便于和第十章预算对齐 */
  estimatedOutputTokens: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  status: MCPCallStatus;
  /** 实际尝试次数（>1 说明发生过重试/重连） */
  attempts: number;
  errorMessage?: string;
}

export interface TraceContext {
  requestId?: string;
  conversationId?: string;
  userId?: string;
}

/**
 * 粗估 token 数：中文按 1 字 ≈ 0.6 token、英文按 4 字符 ≈ 1 token 折中处理。
 * 只用于监控告警量级判断，不用于计费（计费走第十章的精确统计）。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk * 0.6 + rest / 4);
}

/** 环形缓冲，避免长跑进程里 trace 无限增长 */
export class MCPTraceCollector {
  private traces: MCPCallTrace[] = [];

  constructor(private readonly limit = 500) {}

  add(trace: MCPCallTrace): void {
    this.traces.push(trace);
    if (this.traces.length > this.limit) {
      this.traces.splice(0, this.traces.length - this.limit);
    }
  }

  list(): MCPCallTrace[] {
    return [...this.traces];
  }

  clear(): void {
    this.traces = [];
  }
}

export interface MCPTraceSummary {
  totalCalls: number;
  successRate: number;
  avgDurationMs: number;
  p95DurationMs: number;
  totalOutputBytes: number;
  totalEstimatedOutputTokens: number;
  byStatus: Record<string, number>;
  byServer: Record<string, { calls: number; avgDurationMs: number; errors: number }>;
  byTool: Record<string, { calls: number; avgDurationMs: number; errors: number }>;
}

/** 12.12 监控指标聚合：回答"哪些 Server 慢、哪些工具常失败" */
export function summarizeTraces(traces: MCPCallTrace[]): MCPTraceSummary {
  const byStatus: Record<string, number> = {};
  const byServer: MCPTraceSummary['byServer'] = {};
  const byTool: MCPTraceSummary['byTool'] = {};
  const durations: number[] = [];

  let totalOutputBytes = 0;
  let totalEstimatedOutputTokens = 0;

  for (const t of traces) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    durations.push(t.durationMs);
    totalOutputBytes += t.outputSize;
    totalEstimatedOutputTokens += t.estimatedOutputTokens;

    const isError = t.status !== 'success';
    const server = (byServer[t.serverId] ??= { calls: 0, avgDurationMs: 0, errors: 0 });
    server.calls += 1;
    server.avgDurationMs += t.durationMs;
    if (isError) server.errors += 1;

    const tool = (byTool[t.toolName] ??= { calls: 0, avgDurationMs: 0, errors: 0 });
    tool.calls += 1;
    tool.avgDurationMs += t.durationMs;
    if (isError) tool.errors += 1;
  }

  for (const v of Object.values(byServer)) {
    v.avgDurationMs = v.calls ? Math.round(v.avgDurationMs / v.calls) : 0;
  }
  for (const v of Object.values(byTool)) {
    v.avgDurationMs = v.calls ? Math.round(v.avgDurationMs / v.calls) : 0;
  }

  const sorted = [...durations].sort((a, b) => a - b);
  const p95Index = sorted.length ? Math.floor(sorted.length * 0.95) : 0;

  return {
    totalCalls: traces.length,
    successRate: traces.length
      ? Number(
          ((byStatus.success ?? 0) / traces.length).toFixed(3),
        )
      : 0,
    avgDurationMs: durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0,
    p95DurationMs: sorted.length ? sorted[Math.min(p95Index, sorted.length - 1)] : 0,
    totalOutputBytes,
    totalEstimatedOutputTokens,
    byStatus,
    byServer,
    byTool,
  };
}
