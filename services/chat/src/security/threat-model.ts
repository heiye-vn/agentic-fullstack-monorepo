/**
 * services/chat/src/security/threat-model.ts
 *
 * Agent 威胁建模框架（第十八章 18.2 / 18.4 / 18.5 / 18.6）
 *
 * 传统安全的第一步是威胁建模：资产 → 攻击者 → 攻击路径 → 缓解措施。
 * Agent 系统同样要做，但攻击面更大 —— 本章文档把它归纳为「四类边界混淆」：
 *   1. 指令与数据混淆（外部内容被当成指令执行）
 *   2. 能力与意图混淆（Agent 有权限不等于用户想要它用）
 *   3. 身份与权限混淆（Agent 以用户身份行事，但用户不知道它做了什么）
 *   4. 记忆与事实混淆（被污染的上下文被当成事实）
 *
 * 本模块提供四组原语，全部是纯函数/纯对象，零外部依赖：
 *   1. TrustBoundary  —— 信任边界：跨越边界的数据必须先验证
 *   2. SecurityInvariant —— 安全不变量：比权限更高，任何角色都不能违反
 *   3. failClosed —— 失败默认拒绝（不是放行）
 *   4. ThreatScenario —— 结构化威胁场景库，给安全评审当共同语言
 */

// ─────────────────────── Trust Boundary ───────────────────────

/**
 * 信任级别，从低到高：external < tool_output < agent < user < developer < system
 *
 * 顺序即含义：**指数越低越不可信**。跨边界判定靠比较下标，
 * 所以往这里加新级别时必须插到正确的位置，不能追加在末尾。
 */
export type TrustLevel = 'system' | 'developer' | 'user' | 'agent' | 'tool_output' | 'external';

const TRUST_ORDER: TrustLevel[] = ['external', 'tool_output', 'agent', 'user', 'developer', 'system'];

export interface TrustBoundary {
  id: string;
  from: TrustLevel;
  to: TrustLevel;
  description: string;
}

/**
 * 判断数据是否跨越了信任边界（从低信任流向高信任）。
 * 跨越边界的数据未经验证不得影响控制流。
 */
export function crossesTrustBoundary(sourceLevel: TrustLevel, targetLevel: TrustLevel): boolean {
  return trustScore(sourceLevel) < trustScore(targetLevel);
}

/** 信任级别的数值（越高越可信） */
export function trustScore(level: TrustLevel): number {
  const idx = TRUST_ORDER.indexOf(level);
  // 未知级别按最不可信处理（Fail Closed 精神：认不出来就往严格的一侧走）
  return idx === -1 ? 0 : idx;
}

/**
 * 该级别的内容是否有资格改变 Agent 行为（改 system prompt、改计划、改工具选择）。
 * 只有 system / developer 可以 —— **外部内容和工具返回值永远不行**，
 * 这正是 Indirect Prompt Injection 的核心防线。
 */
export function canAlterAgentBehavior(level: TrustLevel): boolean {
  return level === 'system' || level === 'developer';
}

/** 该级别的内容是否可以提出新任务 */
export function canIssueTask(level: TrustLevel): boolean {
  return level === 'system' || level === 'developer' || level === 'user';
}

// ─────────────────────── Security Invariant ───────────────────────

export interface InvariantContext {
  action: string;
  actor: string;
  resource?: string;
  target?: string;
  dataContent?: string;
  /** 工具名（工具调用类不变量用） */
  toolName?: string;
  /** 本次会话被授权的工具白名单（MCP 场景用，缺失表示未授权任何工具） */
  allowedTools?: string[];
  [key: string]: unknown;
}

export interface SecurityInvariant {
  id: string;
  description: string;
  check: (context: InvariantContext) => boolean;
}

export class InvariantViolation extends Error {
  constructor(
    public readonly invariantId: string,
    public readonly context: InvariantContext,
  ) {
    super(`安全不变量违反：${invariantId}（action=${context.action}, actor=${context.actor}）`);
    this.name = 'InvariantViolation';
  }
}

/**
 * 预定义的安全不变量。
 *
 * 与权限的区别（18.5.3）：权限是「角色能做什么」，可以被更高权限覆盖；
 * 不变量是「系统里永远不能发生什么」，**没有任何角色可以豁免** ——
 * 就算 actor 是 admin、就算用户显式要求，也不行。
 */
export const AGENT_INVARIANTS: SecurityInvariant[] = [
  {
    id: 'no-agent-admin-creation',
    description: 'Agent 不允许创建管理员账户',
    check: (ctx) => !(ctx.action === 'create_admin' && ctx.actor.startsWith('agent')),
  },
  {
    id: 'no-pii-to-external',
    description: 'PII 不允许发送到外部网络',
    check: (ctx) => !(ctx.action === 'send_external' && ctx.dataContent?.includes('@')),
  },
  {
    id: 'no-production-delete-by-agent',
    description: '生产数据库不能被 Agent 删除',
    check: (ctx) =>
      !(
        ctx.action === 'delete' &&
        ctx.resource === 'production_database' &&
        ctx.actor.startsWith('agent')
      ),
  },
  {
    id: 'no-secret-in-response',
    description: 'API Key / Secret 不允许出现在 Agent 的对外响应中',
    check: (ctx) => {
      if (ctx.action !== 'respond' || !ctx.dataContent) return true;
      return !/(?:sk|pk|api[_-]?key)[_-][\w]{16,}/i.test(ctx.dataContent);
    },
  },
  {
    // 本项目特有：第十二章的 mcp-security 已经有了工具白名单与等级判定，
    // 但那是「权限层」的判定，调用方可以选择忽略返回结果继续执行。
    // 这里把它提升为不变量：白名单外的工具调用在任何角色下都不成立。
    id: 'no-tool-outside-allowlist',
    description: '不在白名单内的工具不允许被执行（默认 deny 提升为系统级不变量）',
    check: (ctx) => {
      if (ctx.action !== 'tool_call' || !ctx.toolName) return true;
      // 白名单缺失视为「未授权任何工具」，一律拒绝（Fail Closed）
      if (!ctx.allowedTools || ctx.allowedTools.length === 0) return false;
      return ctx.allowedTools.includes(ctx.toolName);
    },
  },
];

export class InvariantChecker {
  private readonly invariants: SecurityInvariant[];

  constructor(invariants: SecurityInvariant[] = AGENT_INVARIANTS) {
    if (!invariants || invariants.length === 0) {
      throw new Error('InvariantChecker 至少需要一条不变量，空集合等于放弃检查');
    }
    this.invariants = invariants;
  }

  /** 检查所有不变量，返回违反项列表 */
  check(context: InvariantContext): { passed: boolean; violations: string[] } {
    const violations: string[] = [];
    for (const inv of this.invariants) {
      let ok = false;
      try {
        ok = inv.check(context);
      } catch {
        // 不变量自身抛错时按「违反」处理 —— 安全检查不能因为检查器坏了就放行
        ok = false;
      }
      if (!ok) violations.push(inv.id);
    }
    return { passed: violations.length === 0, violations };
  }

  /** 断言式检查：违反任何不变量则抛出 */
  assert(context: InvariantContext): void {
    const result = this.check(context);
    if (!result.passed) {
      throw new InvariantViolation(result.violations[0], context);
    }
  }

  /** 列出所有注册的不变量 */
  list(): { id: string; description: string }[] {
    return this.invariants.map((i) => ({ id: i.id, description: i.description }));
  }
}

// ─────────────────────── Fail Closed ───────────────────────

/**
 * Fail Closed 包装器：检查函数抛异常时默认**拒绝**。
 *
 * ⚠️ `fallback: 'allow'` 是逃生舱，只应用于「拒绝会造成更严重后果」的场景
 * （例如审计日志写入失败不应该阻断主流程）。默认坚决是 'deny'。
 */
export async function failClosed<T>(
  checkFn: () => Promise<T> | T,
  fallback: 'deny' | 'allow' = 'deny',
): Promise<{ ok: boolean; result?: T; error?: Error }> {
  try {
    const result = await checkFn();
    return { ok: true, result };
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    return fallback === 'deny' ? { ok: false, error } : { ok: true, error };
  }
}

/** 同步版 Fail Closed：只有 deny 一种结果，避免调用方图省事选 allow */
export function failClosedSync<T>(checkFn: () => T): { ok: boolean; result?: T; error?: Error } {
  try {
    const result = checkFn();
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

// ─────────────────────── Threat Scenario ───────────────────────

export type ThreatCategory =
  | 'injection'
  | 'privilege_escalation'
  | 'data_leak'
  | 'denial_of_service'
  | 'denial_of_wallet'
  | 'context_poisoning'
  | 'supply_chain';

export interface ThreatScenario {
  id: string;
  category: ThreatCategory;
  asset: string;
  attacker: string;
  attackPath: string;
  mitigation: string;
}

/** 默认威胁场景库：给安全评审提供共同语言，也用于新成员 onboarding */
export const AGENT_THREAT_SCENARIOS: ThreatScenario[] = [
  {
    id: 'direct-injection',
    category: 'injection',
    asset: '系统指令完整性',
    attacker: '恶意用户',
    attackPath: '在用户输入中嵌入覆盖指令',
    mitigation: 'input-guard 检出 + 指令来源分级',
  },
  {
    id: 'indirect-injection',
    category: 'injection',
    asset: '系统指令完整性',
    attacker: '第三方内容（网页/邮件/PDF）',
    attackPath: '在外部内容中隐藏恶意指令，Agent 读取后执行',
    mitigation: 'Trust Boundary 标记 + 不可信内容不能改变 Agent 行为',
  },
  {
    id: 'agent-privilege-escalation',
    category: 'privilege_escalation',
    asset: '数据库、文件系统',
    attacker: '被注入的 Research Agent',
    attackPath: 'Research Agent 被注入 → 传递恶意指令给 Executor Agent → 执行越权操作',
    mitigation: 'Agent 间权限隔离 + 信息过滤 + 最小权限',
  },
  {
    id: 'data-exfiltration',
    category: 'data_leak',
    asset: '用户 PII / API Key',
    attacker: '恶意网页内容',
    attackPath: '诱导 Agent 读取敏感文件 → 通过合法工具调用发到外部',
    mitigation: 'DataFlowGuard source→sink 检查',
  },
  {
    id: 'denial-of-wallet',
    category: 'denial_of_wallet',
    asset: '运营预算',
    attacker: '恶意用户或被注入的 Agent',
    attackPath: '疯狂调用 LLM API / 搜索 API，一天烧掉大量费用',
    mitigation: 'QuotaTracker 配额限制 + 成本监控告警',
  },
  {
    id: 'context-poisoning',
    category: 'context_poisoning',
    asset: 'Agent 长期记忆 / RAG 知识库',
    attacker: '恶意内容写入者',
    attackPath: '向 Agent 的记忆/知识库注入虚假信息 → 后续检索时污染 context → 影响决策',
    mitigation: '记忆写入审核 + 来源标记 + 定期清洗',
  },
  {
    id: 'supply-chain-attack',
    category: 'supply_chain',
    asset: 'Agent 工具链完整性',
    attacker: '恶意 MCP Server / Plugin',
    attackPath: '替换合法的 MCP Server 为恶意版本 → Agent 调用时泄露数据',
    mitigation: '工具白名单 + 来源校验 + 签名验证',
  },
];
