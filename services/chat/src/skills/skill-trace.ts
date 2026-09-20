/**
 * src/skills/skill-trace.ts
 *
 * 第十三章 13.10.4 — Skills 可观测性
 *
 * 参考项目这一块是零：load_skill 读完文件就返回，谁加载了什么、加载耗时多少、
 * 正文有多长，全靠 console.log。生产环境至少要能回答三个问题：
 *   1. 哪些 Skill 真的被用起来了（没被加载的资产等于没写）
 *   2. 哪个 Skill 的正文在吃上下文（L2 全量返回，长 Skill 是 token 黑洞）
 *   3. 有没有 Agent 在反复加载不存在的 Skill（说明索引写得不清楚）
 *
 * token 估算复用第十二章的 estimateTokens，保证与 MCP trace 口径一致。
 */
import { estimateTokens } from '../mcp/mcp-trace.js';

export type SkillLoadStatus = 'hit' | 'missing' | 'error' | 'truncated';

export interface SkillLoadTrace {
  requestId: string;
  conversationId?: string;
  userId?: string;
  skillName: string;
  skillVersion?: string;
  /** 是否命中；false 说明 Agent 猜了一个不存在的名字 */
  hit: boolean;
  /** 加载耗时（含读盘与 frontmatter 解析） */
  loadDurationMs: number;
  /** 命中时返回的正文字符数 */
  bodyLength: number;
  estimatedTokens: number;
  status: SkillLoadStatus;
  startedAt: number;
  endedAt: number;
  errorMessage?: string;
}

export interface SkillTraceContext {
  requestId?: string;
  conversationId?: string;
  userId?: string;
}

export interface SkillTraceSummary {
  totalLoads: number;
  hitRate: number;
  avgDurationMs: number;
  totalEstimatedTokens: number;
  bySkill: Record<
    string,
    { loads: number; hits: number; avgDurationMs: number; avgTokens: number }
  >;
  byStatus: Record<string, number>;
}

export class SkillTraceCollector {
  private traces: SkillLoadTrace[] = [];

  constructor(private readonly limit = 500) {}

  add(trace: SkillLoadTrace): void {
    this.traces.push(trace);
    if (this.traces.length > this.limit) {
      this.traces.splice(0, this.traces.length - this.limit);
    }
  }

  list(): SkillLoadTrace[] {
    return [...this.traces];
  }

  clear(): void {
    this.traces = [];
  }

  summary(): SkillTraceSummary {
    return summarizeSkillTraces(this.traces);
  }
}

export function summarizeSkillTraces(
  traces: SkillLoadTrace[],
): SkillTraceSummary {
  const bySkill: SkillTraceSummary['bySkill'] = {};
  const byStatus: Record<string, number> = {};
  let totalTokens = 0;
  let totalDuration = 0;
  let hits = 0;

  for (const t of traces) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    totalTokens += t.estimatedTokens;
    totalDuration += t.loadDurationMs;
    if (t.hit) hits += 1;

    const row = (bySkill[t.skillName] ??= {
      loads: 0,
      hits: 0,
      avgDurationMs: 0,
      avgTokens: 0,
    });
    row.loads += 1;
    if (t.hit) row.hits += 1;
    row.avgDurationMs += t.loadDurationMs;
    row.avgTokens += t.estimatedTokens;
  }

  for (const v of Object.values(bySkill)) {
    v.avgDurationMs = v.loads ? Math.round(v.avgDurationMs / v.loads) : 0;
    v.avgTokens = v.loads ? Math.round(v.avgTokens / v.loads) : 0;
  }

  return {
    totalLoads: traces.length,
    hitRate: traces.length ? Number((hits / traces.length).toFixed(3)) : 0,
    avgDurationMs: traces.length
      ? Math.round(totalDuration / traces.length)
      : 0,
    totalEstimatedTokens: totalTokens,
    bySkill,
    byStatus,
  };
}

/**
 * 记录一次 load_skill
 *
 * 只记 ID、形状与统计量 —— 不记正文原文（需求文本可能包含敏感信息，
 * 这是 13.10.4 明确要求守住的边界）。
 */
export function buildSkillLoadTrace(input: {
  ctx?: SkillTraceContext;
  skillName: string;
  skillVersion?: string;
  hit: boolean;
  durationMs: number;
  bodyLength: number;
  status: SkillLoadStatus;
  errorMessage?: string;
  /**
   * Skill 正文（可选）。SKILL.md 是本项目的资产、不是用户数据，
   * 传进来可以算准 token；不传就按"全是中文"的上界粗估。
   */
  body?: string;
}): SkillLoadTrace {
  const endedAt = Date.now();
  return {
    requestId: input.ctx?.requestId ?? 'unknown',
    conversationId: input.ctx?.conversationId,
    userId: input.ctx?.userId,
    skillName: input.skillName,
    skillVersion: input.skillVersion,
    hit: input.hit,
    loadDurationMs: input.durationMs,
    bodyLength: input.bodyLength,
    estimatedTokens: input.body
      ? estimateTokens(input.body)
      : Math.ceil(input.bodyLength * 0.6),
    status: input.status,
    startedAt: endedAt - input.durationMs,
    endedAt,
    errorMessage: input.errorMessage,
  };
}
