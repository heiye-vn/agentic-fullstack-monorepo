/**
 * services/chat/src/security/agent-identity.ts
 *
 * Agent 身份与能力委托（第十八章 18.13）
 *
 * 核心观点：Agent 不是用户本人，而是用户临时委托的执行器。
 * 它不该继承用户的全部权限，而应被授予**临时的、有范围的、有配额的、可撤销**的能力。
 *
 * 与 permission-model（RBAC）的分工：
 *   - RBAC（角色）回答「这类 Agent 天花板在哪」——静态、宽、长期
 *   - Capability（能力令牌）回答「这次任务被授予了什么」——动态、窄、短期
 *   两者是叠加关系：先过角色天花板，再检查有没有对应的能力令牌。
 *
 * 本模块提供三组原语，全部纯内存 + 纯函数，零外部依赖：
 *   1. AgentRegistry     —— Agent 身份登记（谁在跑、属于谁、什么角色）
 *   2. CapabilityManager —— 能力令牌的发放 / 消费 / 撤销
 *   3. hashReasoning / hashToolArgs —— 审计记 hash 不记原文
 */

import { createHash, randomUUID } from 'crypto';

// ─────────────────────── Agent Identity ───────────────────────

export interface AgentIdentity {
  /** Agent 实例唯一 ID（建议 `<graph>:<node>:<run>`） */
  id: string;
  /**
   * 角色名。推荐取 permission-model.ts 的 `AgentRole`，
   * 但这里刻意保持 string —— LangGraph 图的节点名（triage / extractStep / supervisor
   * 等）并不是 RBAC 角色，强行收敛成联合类型会把它们挡在注册表外。
   * 角色校验交给 PermissionPolicy.isKnownRole() 在真正判权限时做。
   */
  role: string;
  /** 发起该 Agent 的用户 ID —— 出事后要能追责到人 */
  owner: string;
  createdAt: string;
  metadata?: Record<string, string>;
}

/**
 * Agent 注册表：追踪所有活跃 Agent 身份。
 *
 * 内存实现（进程内即可满足"这次运行里有哪些 Agent"的追溯需求）；
 * 若要跨进程/跨重启追溯，应在 register/unregister 处把事件写给审计日志
 * （见后续批次的 audit-logger），而不是把这里改成数据库访问 —— 保持本模块零依赖。
 */
export class AgentRegistry {
  private readonly agents = new Map<string, AgentIdentity>();

  register(identity: AgentIdentity): void {
    this.agents.set(identity.id, identity);
  }

  lookup(agentId: string): AgentIdentity | undefined {
    return this.agents.get(agentId);
  }

  unregister(agentId: string): boolean {
    return this.agents.delete(agentId);
  }

  listByOwner(owner: string): AgentIdentity[] {
    return [...this.agents.values()].filter((a) => a.owner === owner);
  }

  /** 全量快照（进程退出前 flush 到审计日志用） */
  listAll(): AgentIdentity[] {
    return [...this.agents.values()];
  }

  get size(): number {
    return this.agents.size;
  }
}

// ─────────────────────── Capability Scope ───────────────────────

/**
 * 把 Windows 反斜杠路径统一成正斜杠，避免 `C:\tmp\x` 与 `C:/tmp/x` 判定不一致。
 */
function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * 判断 target 是否落在 scope 之内。
 *
 * ⚠️ 这里不能用裸 `target.startsWith(scope)` —— 那是个真实的前缀混淆漏洞：
 *    scope = '/tmp/project-docs'，target = '/tmp/project-docs-evil/leak.txt'
 *    裸 startsWith 判定为「在范围内」，于是 Agent 拿到了一个它没被授予的目录。
 *
 * 正确做法：路径模式要求边界是目录分隔符；命名空间模式（如 `kb:requirement`）
 * 要求边界是 `:` / `/` / `.`。Windows 盘符路径（`C:/...`）同样按路径模式处理。
 */
export function isWithinScope(scope: string, target: string): boolean {
  const s = toPosix(scope).trim();
  const t = toPosix(target).trim();

  // 空 scope = 该能力不限范围（发放方显式选择，不是默认值）
  if (!s) return true;
  if (t === s) return true;

  const isPathScope = /^(?:[A-Za-z]:)?\//.test(s);
  if (isPathScope) {
    const base = s.endsWith('/') ? s : `${s}/`;
    // 目录本身也算在内（scope='/tmp/x/' 且 target='/tmp/x'）
    return t.startsWith(base) || t === s.replace(/\/+$/, '');
  }

  // 命名空间模式：必须停在分隔符上，`kb:req` 不能放行 `kb:requirement-2`
  return t.startsWith(`${s}:`) || t.startsWith(`${s}/`) || t.startsWith(`${s}.`);
}

// ─────────────────────── Capability Token ───────────────────────

export interface CapabilityToken {
  id: string;
  agentId: string;
  /** 能力标识，如 "file.write" / "tool.execute" */
  capability: string;
  /** 作用范围：路径（/tmp/project-docs）或命名空间（kb:requirement） */
  scope: string;
  /** 配额：最多允许消费多少次 */
  maxOperations: number;
  usedOperations: number;
  /** 是否破坏性操作（删除/外发/写库）—— 审计与 HITL 据此升级 */
  destructive: boolean;
  issuedAt: string;
  expiresAt: string;
  revoked: boolean;
}

export class CapabilityExpiredError extends Error {
  constructor(public readonly tokenId: string) {
    super(`Capability 已过期：${tokenId}`);
    this.name = 'CapabilityExpiredError';
  }
}

export class CapabilityRevokedError extends Error {
  constructor(public readonly tokenId: string) {
    super(`Capability 已撤销：${tokenId}`);
    this.name = 'CapabilityRevokedError';
  }
}

export class CapabilityExhaustedError extends Error {
  constructor(public readonly tokenId: string) {
    super(`Capability 已用尽：${tokenId}`);
    this.name = 'CapabilityExhaustedError';
  }
}

export class CapabilityScopeError extends Error {
  constructor(
    public readonly tokenId: string,
    public readonly requestedPath: string,
  ) {
    super(`操作超出 Capability 范围：${requestedPath}（token=${tokenId}）`);
    this.name = 'CapabilityScopeError';
  }
}

export type CapabilityStatus = 'ok' | 'unknown' | 'revoked' | 'expired' | 'exhausted';

export interface CapabilityInspection {
  status: CapabilityStatus;
  token?: CapabilityToken;
  /** 剩余可用次数（unknown 状态为 0） */
  remaining: number;
}

/**
 * 能力管理器：发放、校验、消费、撤销能力令牌。
 *
 * 与 RBAC 的区别：
 *   - RBAC：角色 → 永久权限
 *   - Capability：任务 → 临时、有范围、有配额、可撤销的能力
 *
 * 故障取向是 Fail Closed：任何一条校验不过就抛错，绝不"先放行再补记"。
 */
export class CapabilityManager {
  private readonly tokens = new Map<string, CapabilityToken>();

  /**
   * 为 Agent 发放一个临时能力令牌。
   *
   * 默认 TTL 10 分钟、配额 100 次、非破坏性 —— 都是**收紧方向**的默认值，
   * 调用方想要更宽松必须显式传参。
   */
  issue(params: {
    agentId: string;
    capability: string;
    scope: string;
    maxOperations?: number;
    ttlMs?: number;
    destructive?: boolean;
  }): CapabilityToken {
    const now = Date.now();
    const token: CapabilityToken = {
      id: randomUUID(),
      agentId: params.agentId,
      capability: params.capability,
      scope: params.scope,
      maxOperations: params.maxOperations ?? 100,
      usedOperations: 0,
      destructive: params.destructive ?? false,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + (params.ttlMs ?? 600_000)).toISOString(),
      revoked: false,
    };
    this.tokens.set(token.id, token);
    return token;
  }

  /**
   * 只做校验、不计数。用于「能不能做」的预检（例如 HITL 弹窗前先确认能力有效）。
   */
  inspect(tokenId: string): CapabilityInspection {
    const token = this.tokens.get(tokenId);
    if (!token || token.revoked) {
      return { status: token ? 'revoked' : 'unknown', token, remaining: 0 };
    }
    if (new Date(token.expiresAt).getTime() <= Date.now()) {
      return { status: 'expired', token, remaining: 0 };
    }
    const remaining = token.maxOperations - token.usedOperations;
    if (remaining <= 0) return { status: 'exhausted', token, remaining: 0 };
    return { status: 'ok', token, remaining };
  }

  /**
   * 校验并消费一次能力。
   *
   * 顺序即优先级：未知/已撤销 → 已过期 → 配额用尽 → 超出范围 → 计数。
   * 范围校验放在计数**之前**，越界操作不会白白吃掉配额。
   */
  consume(tokenId: string, operationPath?: string): void {
    const token = this.tokens.get(tokenId);
    if (!token || token.revoked) throw new CapabilityRevokedError(tokenId);
    if (new Date(token.expiresAt).getTime() <= Date.now()) {
      throw new CapabilityExpiredError(tokenId);
    }
    if (token.usedOperations >= token.maxOperations) {
      throw new CapabilityExhaustedError(tokenId);
    }
    if (operationPath !== undefined && !isWithinScope(token.scope, operationPath)) {
      throw new CapabilityScopeError(tokenId, operationPath);
    }
    token.usedOperations++;
  }

  /** 撤销单个令牌（幂等：已撤销或不存在返回 false） */
  revoke(tokenId: string): boolean {
    const token = this.tokens.get(tokenId);
    if (!token || token.revoked) return false;
    token.revoked = true;
    return true;
  }

  /** 查询 Agent 当前仍然可用的能力（未撤销 + 未过期 + 有余额） */
  listActive(agentId: string): CapabilityToken[] {
    const now = Date.now();
    return [...this.tokens.values()].filter(
      (t) =>
        t.agentId === agentId &&
        !t.revoked &&
        new Date(t.expiresAt).getTime() > now &&
        t.usedOperations < t.maxOperations,
    );
  }

  /** 撤销某 Agent 的全部能力（Kill Switch 触发时的紧急动作），返回受影响数量 */
  revokeAll(agentId: string): number {
    let count = 0;
    for (const token of this.tokens.values()) {
      if (token.agentId === agentId && !token.revoked) {
        token.revoked = true;
        count++;
      }
    }
    return count;
  }
}

// ─────────────────────── Reasoning Hash ───────────────────────

/**
 * 对 Agent 的推理过程生成不可逆 hash（sha256 前 16 位）。
 *
 * 用途：审计日志能追溯"Agent 当时是不是这么想的"（用原文重算 hash 比对），
 * 但日志里不落推理原文 —— 原文可能含用户隐私或商业机密。
 * 注意它是**隐私友好的审计索引**，不能替代完整审计事件。
 */
export function hashReasoning(reasoning: string): string {
  return createHash('sha256').update(reasoning).digest('hex').slice(0, 16);
}

/** 递归按键名排序后序列化，保证「同内容不同 key 顺序」得到同一个 hash */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

/**
 * 对工具调用参数生成 hash（同理：可追溯但不泄露）。
 *
 * ⚠️ 常见写法 `JSON.stringify(args, Object.keys(args).sort())` 是错的：
 * 第二个参数是 **replacer（属性白名单）**，不是排序器 —— 它只是过滤 key，
 * 输出顺序仍由对象自身的插入顺序决定。于是 `{a,b}` 与 `{b,a}` 会得到两个
 * 不同 hash，"稳定哈希"名不副实，审计比对会误判。这里改成真正的排序序列化。
 */
export function hashToolArgs(args: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(args)).digest('hex').slice(0, 16);
}
