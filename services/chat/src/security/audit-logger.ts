/**
 * services/chat/src/security/audit-logger.ts
 *
 * 安全审计日志（第十八章 18.8 / 18.16.2）
 *
 * 与第十六章的 `observability/logger.ts` 不是一回事：
 *   - logger.ts   是通用结构化日志（pino），面向开发调试与运维排障
 *   - audit-logger 是**安全审计日志**，面向安全事件追踪与合规审计
 *
 * 设计要求：
 *   1. 事件必须结构化（typed AuditEvent，不是 any）
 *   2. 敏感字段自动脱敏：只记 ID 和形状（长度、类型、hash、计数），不记内容
 *   3. 事件不可篡改：对外返回副本，外部改不动内部记录
 *   4. 可查询：按时间、类型、严重程度、操作者、结果过滤
 *
 * 本模块是进程内实现。生产可替换为 JSONL 追加写文件 / 写数据库审计表 /
 * 发到 SIEM —— 通过构造函数的 `onEvent` 回调即可对接，不用改调用点。
 */

export type AuditSeverity = 'info' | 'warn' | 'critical';

export type AuditEventType =
  | 'tool_invoked'
  | 'tool_blocked'
  | 'permission_denied'
  | 'permission_granted'
  | 'injection_detected'
  | 'session_revoked'
  | 'human_approved'
  | 'human_rejected'
  | 'sandbox_execution'
  | 'data_access'
  | 'data_flow_blocked'
  | 'secret_accessed'
  | 'path_escape_blocked'
  | 'kill_switch_engaged'
  | 'quota_exceeded';

export type AuditOutcome = 'success' | 'denied' | 'error';

export interface AuditEvent {
  timestamp: string;
  eventType: AuditEventType;
  severity: AuditSeverity;
  /** 操作发起者（Agent ID 或用户 ID，不记用户名/邮箱） */
  actor: string;
  /** 操作目标（工具名、资源 ID；敏感路径需脱敏） */
  target: string;
  outcome: AuditOutcome;
  /** 结构化详情：只放形状信息，不放原文 */
  details: Record<string, string | number | boolean>;
  /** 关联 traceId（呼应第十六章可观测体系） */
  traceId?: string;
}

export interface AuditQuery {
  eventType?: AuditEventType;
  severity?: AuditSeverity;
  actor?: string;
  outcome?: AuditOutcome;
  since?: Date;
  until?: Date;
  limit?: number;
}

/** details 里单个字符串值的最长长度（超出截断，避免日志被巨型内容塞满） */
const MAX_DETAIL_STRING = 256;

function truncateDetail(value: string): string {
  return value.length <= MAX_DETAIL_STRING
    ? value
    : `${value.slice(0, MAX_DETAIL_STRING)}…(+${value.length - MAX_DETAIL_STRING})`;
}

/** 事件回调：转发到文件 / 数据库 / SIEM */
export type AuditSink = (event: AuditEvent) => void;

/**
 * 安全审计日志记录器。
 *
 * 用法：
 *   const audit = new AuditLogger((e) => appendToJsonl(e));
 *   audit.logToolInvocation('search_knowledge_base', 'agent-1', 'success');
 *   audit.query({ severity: 'critical' });
 */
export class AuditLogger {
  private readonly events: AuditEvent[] = [];
  private readonly sink?: AuditSink;

  constructor(sink?: AuditSink) {
    this.sink = sink;
  }

  log(event: Omit<AuditEvent, 'timestamp'> & { timestamp?: string }): AuditEvent {
    const full: AuditEvent = {
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString(),
      // details 统一截断：审计日志不是内容仓库，塞原文既占空间又二次泄露
      details: this.sanitizeDetails(event.details),
    };
    this.events.push(full);

    // 下游 sink 挂了不能反过来把业务拖死 —— 审计的优先级低于可用性
    if (this.sink) {
      try {
        this.sink(full);
      } catch {
        /* 忽略：sink 失败不影响主流程 */
      }
    }
    return full;
  }

  private sanitizeDetails(
    details: Record<string, string | number | boolean>,
  ): Record<string, string | number | boolean> {
    const out: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(details)) {
      out[k] = typeof v === 'string' ? truncateDetail(v) : v;
    }
    return out;
  }

  // ─────────── 常用事件的快捷方法 ───────────

  logToolInvocation(
    toolName: string,
    actor: string,
    outcome: AuditOutcome,
    details: Record<string, string | number | boolean> = {},
    traceId?: string,
  ): AuditEvent {
    return this.log({
      eventType: outcome === 'denied' ? 'tool_blocked' : 'tool_invoked',
      severity: outcome === 'denied' ? 'warn' : 'info',
      actor,
      target: toolName,
      outcome,
      details,
      traceId,
    });
  }

  /** 注入检出：只记命中的模式 id 和输入长度，不记原文 */
  logInjectionDetected(
    matchedPatterns: string[],
    inputLength: number,
    actor: string,
    traceId?: string,
  ): AuditEvent {
    return this.log({
      eventType: 'injection_detected',
      severity: 'critical',
      actor,
      target: 'user_input',
      outcome: 'denied',
      details: {
        matchedPatterns: matchedPatterns.join(','),
        inputLength,
      },
      traceId,
    });
  }

  logHumanDecision(
    toolName: string,
    approver: string,
    approved: boolean,
    traceId?: string,
  ): AuditEvent {
    return this.log({
      eventType: approved ? 'human_approved' : 'human_rejected',
      severity: 'info',
      actor: approver,
      target: toolName,
      outcome: approved ? 'success' : 'denied',
      details: { decision: approved ? 'approve' : 'reject' },
      traceId,
    });
  }

  logSandboxExecution(
    command: string,
    exitCode: number,
    durationMs: number,
    actor: string,
    traceId?: string,
  ): AuditEvent {
    return this.log({
      eventType: 'sandbox_execution',
      severity: exitCode === 0 ? 'info' : 'warn',
      actor,
      target: command,
      outcome: exitCode === 0 ? 'success' : 'error',
      details: { exitCode, durationMs },
      traceId,
    });
  }

  /**
   * 密钥被读取：只记**形状和用途**，绝不记值。
   * 记了值等于把密钥复制到了另一个地方，且日志的访问控制通常比密钥库松得多。
   */
  logSecretAccess(
    secretId: string,
    actor: string,
    purpose: string,
    outcome: AuditOutcome = 'success',
    traceId?: string,
  ): AuditEvent {
    return this.log({
      eventType: 'secret_accessed',
      severity: 'warn',
      actor,
      target: secretId,
      outcome,
      details: { purpose },
      traceId,
    });
  }

  /** Kill Switch 被触发 —— 这是最高优先级的运维事件 */
  logKillSwitchEngaged(reason: string, actor: string, traceId?: string): AuditEvent {
    return this.log({
      eventType: 'kill_switch_engaged',
      severity: 'critical',
      actor,
      target: 'agent_runtime',
      outcome: 'denied',
      details: { reason },
      traceId,
    });
  }

  /** 数据流被拦截：记敏感度和目标，不记内容 */
  logDataFlowBlocked(
    sensitivity: string,
    target: string,
    actor: string,
    traceId?: string,
  ): AuditEvent {
    return this.log({
      eventType: 'data_flow_blocked',
      severity: 'warn',
      actor,
      target,
      outcome: 'denied',
      details: { sensitivity },
      traceId,
    });
  }

  // ─────────── 查询 ───────────

  /**
   * 查询审计事件（默认按时间倒序）。
   *
   * 返回的是**浅拷贝副本**：参照实现直接返回内部对象引用，调用方
   * 改一下返回值就把审计记录改了 —— 审计日志的第一要求是"不可篡改"。
   */
  query(q: AuditQuery = {}): AuditEvent[] {
    let results = [...this.events];

    if (q.eventType) results = results.filter((e) => e.eventType === q.eventType);
    if (q.severity) results = results.filter((e) => e.severity === q.severity);
    if (q.actor) results = results.filter((e) => e.actor === q.actor);
    if (q.outcome) results = results.filter((e) => e.outcome === q.outcome);
    if (q.since) {
      const since = q.since.toISOString();
      results = results.filter((e) => e.timestamp >= since);
    }
    if (q.until) {
      const until = q.until.toISOString();
      results = results.filter((e) => e.timestamp <= until);
    }

    results.sort((a, b) => (a.timestamp > b.timestamp ? -1 : 1));
    if (q.limit) results = results.slice(0, q.limit);

    return results.map((e) => ({ ...e, details: { ...e.details } }));
  }

  /** 按事件类型计数 */
  countByType(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const e of this.events) {
      counts[e.eventType] = (counts[e.eventType] ?? 0) + 1;
    }
    return counts;
  }

  /** 按严重程度计数（给安全看板用：今天有多少 critical） */
  countBySeverity(): Record<AuditSeverity, number> {
    const counts: Record<AuditSeverity, number> = { info: 0, warn: 0, critical: 0 };
    for (const e of this.events) counts[e.severity]++;
    return counts;
  }

  get size(): number {
    return this.events.length;
  }

  /** 清空（仅测试用；生产审计日志不应可清空） */
  clear(): void {
    this.events.length = 0;
  }
}
