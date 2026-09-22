/**
 * services/chat/src/security/permission-model.ts
 *
 * 多 Agent 权限模型（第十八章 18.12）
 *
 * 在多 Agent 系统（第九/十五章的 Planner-Executor、专家子图协作）里，
 * 每个 Agent 不该拥有相同的权限：规划 Agent 不需要执行权限，
 * 执行 Agent 不需要看到完整用户隐私。
 *
 * 本模块提供：
 *   1. AgentRole / ResourceType / ActionType —— 权限三元组
 *   2. PermissionPolicy —— 策略引擎：角色 → 权限天花板
 *   3. PermissionDeniedError —— 类型化越权错误
 *
 * 设计原则：
 *   - 默认 deny：未显式授权的一律拒绝（未知角色同样拒绝）
 *   - 白名单模式：只有注册过的权限才可能被授予
 *   - 纯函数 + 可配置，零外部依赖
 *
 * 与相邻模块的边界（避免重复建设）：
 *   - `src/mcp/mcp-security.ts`（第十二章）管的是**单个工具**的 read/write/admin 分级
 *     和 HITL 确认，粒度是"工具名"；本文件管的是**Agent 角色**能碰哪类资源，
 *     粒度是"资源×操作"。两者是叠加的两层：先过本文件的角色天花板，
 *     再过 mcp-security 的工具分级。`toolPermissionFor()` 是两者的桥。
 *   - `agent-identity.ts` 的 Capability Token 是**任务级**授权，本文件是**角色级**天花板。
 */

import type { ToolPermissionLevel } from '../mcp/mcp-security.js';

export type AgentRole =
  | 'planner'
  | 'researcher'
  | 'coder'
  | 'executor'
  | 'reviewer'
  | 'admin';

export type ResourceType =
  | 'file'
  | 'database'
  | 'email'
  | 'calendar'
  | 'api'
  | 'code_execution'
  | 'network'
  | 'secret'
  | 'tool';

export type ActionType = 'read' | 'write' | 'delete' | 'execute' | 'send';

export interface Permission {
  resource: ResourceType;
  action: ActionType;
}

export class PermissionDeniedError extends Error {
  constructor(
    public readonly role: string,
    public readonly permission: Permission,
  ) {
    super(
      `权限拒绝：角色 ${role} 不具备 ${permission.resource}:${permission.action} 权限`,
    );
    this.name = 'PermissionDeniedError';
  }
}

/** 角色 → 允许的权限集合 */
export type PolicyMap = Partial<Record<AgentRole, Permission[]>>;

/**
 * 默认权限策略。
 * 每个角色只拥有完成其职责所需的最小权限集。
 *
 * 注意 `admin` 虽然权限最全，但它仍然要在 HITL 确认后才真正执行高危动作 ——
 * "有权限"不等于"无需确认"，这是权限层与决策层的分工。
 */
const DEFAULT_POLICY: PolicyMap = {
  planner: [{ resource: 'tool', action: 'read' }],
  researcher: [
    { resource: 'network', action: 'read' },
    { resource: 'file', action: 'read' },
    { resource: 'database', action: 'read' },
  ],
  coder: [
    { resource: 'code_execution', action: 'execute' },
    { resource: 'file', action: 'read' },
    { resource: 'file', action: 'write' },
  ],
  executor: [
    { resource: 'tool', action: 'execute' },
    { resource: 'file', action: 'read' },
    { resource: 'api', action: 'read' },
  ],
  reviewer: [
    { resource: 'file', action: 'read' },
    { resource: 'database', action: 'read' },
  ],
  admin: [
    { resource: 'file', action: 'read' },
    { resource: 'file', action: 'write' },
    { resource: 'file', action: 'delete' },
    { resource: 'database', action: 'read' },
    { resource: 'database', action: 'write' },
    { resource: 'database', action: 'delete' },
    { resource: 'email', action: 'read' },
    { resource: 'email', action: 'send' },
    { resource: 'api', action: 'read' },
    { resource: 'api', action: 'execute' },
    { resource: 'code_execution', action: 'execute' },
    { resource: 'network', action: 'read' },
    { resource: 'tool', action: 'read' },
    { resource: 'tool', action: 'execute' },
    { resource: 'secret', action: 'read' },
  ],
};

/** 权限键：`resource:action` */
function permKey(p: Permission): string {
  return `${p.resource}:${p.action}`;
}

/**
 * 权限策略引擎。
 *
 * 用法：
 *   const policy = new PermissionPolicy();
 *   policy.check('researcher', { resource: 'network', action: 'read' }); // true
 *   policy.check('researcher', { resource: 'email', action: 'send' });   // false
 *   policy.assert('planner', { resource: 'code_execution', action: 'execute' }); // throws
 */
export class PermissionPolicy {
  private readonly grants: Map<string, Set<string>>;

  constructor(policy: PolicyMap = DEFAULT_POLICY) {
    this.grants = new Map();
    for (const [role, perms] of Object.entries(policy)) {
      if (!perms) continue;
      this.grants.set(role, new Set(perms.map(permKey)));
    }
  }

  /**
   * 静默检查：有权限返回 true，无权限返回 false。
   * 未知角色 → false（默认 deny）。
   */
  check(role: string, perm: Permission): boolean {
    const rolePerms = this.grants.get(role);
    if (!rolePerms) return false;
    return rolePerms.has(permKey(perm));
  }

  /** 断言式检查：无权限抛 PermissionDeniedError */
  assert(role: string, perm: Permission): void {
    if (!this.check(role, perm)) {
      throw new PermissionDeniedError(role, perm);
    }
  }

  /** 批量检查：一次拿回通过/拒绝清单（比逐个 assert 更适合"能做什么"的 UI 渲染） */
  checkAll(
    role: string,
    perms: Permission[],
  ): { granted: Permission[]; denied: Permission[] } {
    const granted: Permission[] = [];
    const denied: Permission[] = [];
    for (const p of perms) {
      if (this.check(role, p)) granted.push(p);
      else denied.push(p);
    }
    return { granted, denied };
  }

  /** 列出某角色的所有权限（未知角色返回空数组） */
  listPermissions(role: string): Permission[] {
    const rolePerms = this.grants.get(role);
    if (!rolePerms) return [];
    return [...rolePerms].map((key) => {
      const [resource, action] = key.split(':') as [ResourceType, ActionType];
      return { resource, action };
    });
  }

  /** 列出所有已注册的角色 */
  listRoles(): string[] {
    return [...this.grants.keys()];
  }

  /** 该角色是否在策略表里有定义（未知角色连默认权限都没有） */
  isKnownRole(role: string): boolean {
    return this.grants.has(role);
  }

  /**
   * 注册/追加角色权限。
   * 用于给非标准 Agent（例如 LangGraph 的 `supervisor` 节点）开一个窄权限位，
   * 而不是把它们塞进 admin。已存在同名角色时做**并集**。
   */
  extend(role: string, perms: Permission[]): void {
    const existing = this.grants.get(role) ?? new Set<string>();
    for (const p of perms) existing.add(permKey(p));
    this.grants.set(role, existing);
  }
}

// ─────────────────────── 与相邻模块的桥 ───────────────────────

/**
 * 把第十二章 mcp-security 的工具分级映射成本文件的 Permission 三元组，
 * 让「角色天花板」和「工具分级」用同一套词汇表达，避免两处各判一次、口径不一。
 */
export function toolPermissionFor(level: ToolPermissionLevel): Permission {
  if (level === 'admin') return { resource: 'tool', action: 'delete' };
  if (level === 'write') return { resource: 'tool', action: 'execute' };
  return { resource: 'tool', action: 'read' };
}

/**
 * 角色 + 身份级联检查：先查 Agent 在注册表里的角色，再查该角色的权限。
 *
 * 结构依赖用最小接口表达（`{ lookup }`），这样本文件不必 import agent-identity，
 * 两者保持单向、无环。
 */
export function assertAgentPermission(
  registry: { lookup(agentId: string): { role: string } | undefined },
  policy: PermissionPolicy,
  agentId: string,
  perm: Permission,
): void {
  const identity = registry.lookup(agentId);
  if (!identity) {
    throw new PermissionDeniedError(`unregistered:${agentId}`, perm);
  }
  policy.assert(identity.role, perm);
}
