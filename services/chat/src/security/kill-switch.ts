/**
 * services/chat/src/security/kill-switch.ts
 *
 * 紧急停止、操作快照与风险自适应审批（第十八章 18.14）
 *
 * 安全体系的最后一环不是防御，而是：**检测 → 响应 → 恢复**。
 * 当 Agent 已经执行了错误操作（或正在执行）时，需要能：
 *   1. 立即停止（Kill Switch）
 *   2. 知道刚才做了什么、能不能撤（ActionLog 操作快照）
 *   3. 按风险分级决定谁签字（Risk-based Approval，缓解审批疲劳）
 *
 * 本模块零外部依赖、纯内存，便于在单测里直接断言状态迁移。
 */

import { randomUUID } from 'node:crypto';
import {
  classifyToolPermission,
  DEFAULT_ALLOWED_TOOLS,
  type ToolPermissionLevel,
} from '../mcp/mcp-security.js';

// ─────────────────────── Kill Switch ───────────────────────

export type KillSwitchState = 'active' | 'killed';

/** 停止的作用域：三个字段都省略 = 全局停止 */
export interface KillScope {
  agentId?: string;
  conversationId?: string;
  userId?: string;
}

export interface KillRecord {
  reason: string;
  killedAt: string;
  scope: KillScope;
}

export class KillSwitchEngagedError extends Error {
  constructor(
    public readonly reason: string,
    public readonly scope?: KillScope,
  ) {
    super(`Agent 已被紧急停止：${reason}`);
    this.name = 'KillSwitchEngagedError';
  }
}

/**
 * 紧急停止开关。
 *
 * 比参照实现多了一层**作用域**：
 *   - 参照实现只有全局开关，一按就把整个服务的 Agent 全停了
 *   - 真实运维里更常见的是「停掉这一个失控的会话 / 这一个 Agent」，
 *     其他会话不该被连带。所以 `kill(reason, scope)` 支持按
 *     agentId / conversationId / userId 精确停止，`assertActive(ctx)`
 *     只在全局停止或作用域命中时才抛错。
 *
 * 任何安全模块在执行前都应该先过 `assertActive()`。
 */
export class KillSwitch {
  private state: KillSwitchState = 'active';
  private globalKill: KillRecord | null = null;
  private readonly scopedKills: KillRecord[] = [];

  /** 是否处于停止状态（可带上下文做作用域判定） */
  isActive(ctx?: KillScope): boolean {
    if (this.state === 'killed') return false;
    if (!ctx) return true;
    return !this.scopedKills.some((k) => KillSwitch.matches(k.scope, ctx));
  }

  /** 作用域匹配：scope 里显式声明的字段必须全部相等（AND） */
  private static matches(scope: KillScope, ctx: KillScope): boolean {
    if (scope.agentId && scope.agentId !== ctx.agentId) return false;
    if (scope.conversationId && scope.conversationId !== ctx.conversationId) return false;
    if (scope.userId && scope.userId !== ctx.userId) return false;
    // 空 scope 视为全局，构造时已单独存 globalKill，这里不会命中
    return Object.keys(scope).length > 0;
  }

  /**
   * 触发紧急停止。
   * @param scope 省略 = 全局停止；指定 = 只停匹配该作用域的 Agent
   */
  kill(reason: string, scope: KillScope = {}): void {
    const record: KillRecord = {
      reason,
      killedAt: new Date().toISOString(),
      scope,
    };
    if (Object.keys(scope).length === 0) {
      this.state = 'killed';
      this.globalKill = record;
    } else {
      this.scopedKills.push(record);
    }
  }

  /**
   * 恢复（需要人工确认后才调用）。
   * @param scope 省略 = 恢复全局；指定 = 只撤销匹配的作用域停止
   */
  restore(scope?: KillScope): void {
    if (!scope || Object.keys(scope).length === 0) {
      this.state = 'active';
      this.globalKill = null;
      this.scopedKills.length = 0;
      return;
    }
    for (let i = this.scopedKills.length - 1; i >= 0; i--) {
      if (KillSwitch.matches(this.scopedKills[i].scope, scope)) {
        this.scopedKills.splice(i, 1);
      }
    }
  }

  getStatus(): {
    state: KillSwitchState;
    globalKill: KillRecord | null;
    scopedKills: KillRecord[];
  } {
    return {
      state: this.state,
      globalKill: this.globalKill,
      scopedKills: [...this.scopedKills],
    };
  }

  /** 断言式检查：已停止则抛 KillSwitchEngagedError */
  assertActive(ctx?: KillScope): void {
    if (this.state === 'killed') {
      throw new KillSwitchEngagedError(this.globalKill?.reason ?? 'unknown');
    }
    if (!ctx) return;
    const hit = this.scopedKills.find((k) => KillSwitch.matches(k.scope, ctx));
    if (hit) throw new KillSwitchEngagedError(hit.reason, hit.scope);
  }
}

// ─────────────────────── Action Snapshot ───────────────────────

export interface ActionSnapshot {
  id: string;
  timestamp: string;
  agentId: string;
  action: string;
  target: string;
  params: Record<string, unknown>;
  /** 是否可回滚 —— 决定了事后能不能撤 */
  reversible: boolean;
  /** 补偿动作（如 'DELETE /tmp/x' 的补偿是 'restore from backup'） */
  compensationAction?: string;
}

/**
 * 操作快照记录器。
 *
 * 记录 Agent 的每次操作，支持事后回滚与复盘。
 * 注意它只记"做了什么"，不记推理原文 —— 原文若含隐私，走
 * agent-identity 的 hashReasoning 存 hash。
 */
export class ActionLog {
  private readonly snapshots: ActionSnapshot[] = [];

  record(snapshot: Omit<ActionSnapshot, 'id' | 'timestamp'>): ActionSnapshot {
    const full: ActionSnapshot = {
      ...snapshot,
      id: `snap-${randomUUID()}`,
      timestamp: new Date().toISOString(),
    };
    this.snapshots.push(full);
    return full;
  }

  /** 可回滚的操作列表（按时间倒序，最近的最先要撤） */
  getReversible(): ActionSnapshot[] {
    return this.snapshots.filter((s) => s.reversible).reverse();
  }

  /** 指定 Agent 的操作历史 */
  getByAgent(agentId: string): ActionSnapshot[] {
    return this.snapshots.filter((s) => s.agentId === agentId);
  }

  /** 按目标过滤（出事后要找出"谁动过这张表"） */
  getByTarget(target: string): ActionSnapshot[] {
    return this.snapshots.filter((s) => s.target === target);
  }

  get size(): number {
    return this.snapshots.length;
  }

  /** 清空（仅测试用） */
  clear(): void {
    this.snapshots.length = 0;
  }
}

// ─────────────────────── Risk-based Approval ───────────────────────

export type ApprovalStrategy = 'auto_approve' | 'single_approval' | 'dual_approval' | 'deny';

export interface RiskBasedApprovalRule {
  toolPattern: string | RegExp;
  strategy: ApprovalStrategy;
}

const DEFAULT_APPROVAL_RULES: RiskBasedApprovalRule[] = [
  { toolPattern: /^(analyze|estimate|search|web_search|read_|get_)/, strategy: 'auto_approve' },
  { toolPattern: /^(save|create|update|write_|send_|publish_)/, strategy: 'single_approval' },
  { toolPattern: /^(delete|drop|remove|purge_|reset_|grant_)/, strategy: 'dual_approval' },
  { toolPattern: /^(pay|transfer|wire)/, strategy: 'deny' },
];

/**
 * 第十二章的工具分级 → 审批策略的映射。
 *
 * 与 `mcp-security.classifyToolPermission` 共用同一套等级判定，
 * 避免"工具分级"和"审批策略"两处各判一次、口径漂移。
 */
const STRATEGY_BY_TOOL_LEVEL: Record<ToolPermissionLevel, ApprovalStrategy> = {
  read: 'auto_approve',
  write: 'single_approval',
  admin: 'dual_approval',
};

/**
 * 风险自适应审批策略。
 *
 * 解决「审批疲劳（Approval Fatigue）」：不是所有操作都弹审批，而是按风险分级。
 * 审批的价值在质量不在数量——弹多了人就会无脑点"全部通过"，审批反而失效。
 */
export class RiskBasedApproval {
  private readonly rules: RiskBasedApprovalRule[];

  constructor(rules?: RiskBasedApprovalRule[]) {
    this.rules = rules ?? DEFAULT_APPROVAL_RULES;
  }

  /**
   * 根据工具名称确定审批策略。
   *
   * 判定顺序：自定义规则 → 第十二章工具分级 → 未登记工具默认 single_approval。
   *
   * ⚠️ 最后一步不能直接信 `classifyToolPermission` 的兜底值：那个函数对
   * "认不出来"的工具返回 'read'（第十二章的"未知即谨慎"是按 write 处理的，
   * 但名字里没有写/管前缀时仍判 read）。若照搬，一个从未登记过的陌生工具
   * 会被自动放行 —— 那是 Fail Open。所以这里先看工具有没有登记过，
   * 没登记一律要求人工审批。
   */
  getStrategy(toolName: string): ApprovalStrategy {
    for (const rule of this.rules) {
      if (typeof rule.toolPattern === 'string') {
        if (toolName === rule.toolPattern) return rule.strategy;
      } else if (rule.toolPattern.test(toolName)) {
        return rule.strategy;
      }
    }
    if (!DEFAULT_ALLOWED_TOOLS.includes(toolName)) return 'single_approval';
    return STRATEGY_BY_TOOL_LEVEL[classifyToolPermission(toolName)];
  }

  /** 是否需要人工审批 */
  requiresHuman(toolName: string): boolean {
    const strategy = this.getStrategy(toolName);
    return strategy === 'single_approval' || strategy === 'dual_approval';
  }

  /** 是否被完全禁止（灾难性操作，Agent 不许碰） */
  isDenied(toolName: string): boolean {
    return this.getStrategy(toolName) === 'deny';
  }

  /**
   * 审批所需人数。用于 HITL 流程决定要收几个签名。
   * deny 返回 Infinity —— 多少人签字都不该让它过。
   */
  requiredApprovals(toolName: string): number {
    switch (this.getStrategy(toolName)) {
      case 'auto_approve':
        return 0;
      case 'single_approval':
        return 1;
      case 'dual_approval':
        return 2;
      case 'deny':
        return Infinity;
    }
  }
}
