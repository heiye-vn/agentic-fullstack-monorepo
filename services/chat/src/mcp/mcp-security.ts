/**
 * src/mcp/mcp-trace.ts 的姊妹文件 —— 第十二章 12.10 安全模型
 *
 * MCP Server 只是"暴露能力"，不等于任何用户都能调用。权限分两层：
 * 1. Host 层：当前用户是否被允许使用某个 Server / Tool（本文件负责）
 * 2. 业务数据层：工具内部必须按 userId / workspaceId 过滤（在 Server 侧实现）
 *
 * 另外区分两类"确认"：
 * - 写操作（write）：需要 Human-in-the-Loop 确认
 * - 管理操作（admin）：确认 + 二次校验
 */

export type ToolPermissionLevel = 'read' | 'write' | 'admin';

/** 默认权限表：本项目自带的 7 个 MCP 工具全都是只读分析类 */
export const DEFAULT_TOOL_PERMISSIONS: Record<string, ToolPermissionLevel> = {
  req_analyze_completeness: 'read',
  req_estimate_complexity: 'read',
  req_check_conflicts: 'read',
  req_generate_user_stories: 'read',
  ws_search_competitors: 'read',
  ws_search_best_practices: 'read',
  ws_search_tech_stack: 'read',
  search_knowledge_base: 'read',
  // 预留：未来接入项目管理类 Server 时的写/管理操作
  create_requirement: 'write',
  update_requirement: 'write',
  delete_requirement: 'admin',
};

const WRITE_PREFIXES = ['create_', 'update_', 'write_', 'send_', 'publish_'];
const ADMIN_PREFIXES = ['delete_', 'drop_', 'purge_', 'reset_', 'grant_'];

/**
 * 未登记在权限表里的工具按名字推断等级（第三方 Server 接入时的兜底策略）
 *
 * 原则是"未知即谨慎"：认不出来就按 write 处理，要求确认。
 */
export function classifyToolPermission(toolName: string): ToolPermissionLevel {
  const known = DEFAULT_TOOL_PERMISSIONS[toolName];
  if (known) return known;

  const lower = toolName.toLowerCase();
  if (ADMIN_PREFIXES.some((p) => lower.includes(p))) return 'admin';
  if (WRITE_PREFIXES.some((p) => lower.includes(p))) return 'write';
  return 'read';
}

/** 是否需要人工确认（HITL） */
export function requiresConfirmation(
  toolName: string,
  level: ToolPermissionLevel = classifyToolPermission(toolName),
): boolean {
  return level === 'write' || level === 'admin';
}

/**
 * 默认白名单 = 权限表里登记过的工具（第十八章 18.11「默认 deny」）。
 *
 * 改动前，调用方不传 `allowedTools` 时是**不限制**（等于全部放行）——
 * 第三方 Server 接进来暴露什么都敢调。现在不传白名单时回落到这张表：
 * 登记过的才放行，未登记的一律拒绝。
 */
export const DEFAULT_ALLOWED_TOOLS: string[] = Object.keys(DEFAULT_TOOL_PERMISSIONS);

export interface PermissionContext {
  /**
   * 白名单：不传（或空数组）时回落到 {@link DEFAULT_ALLOWED_TOOLS}。
   * 想完全放开必须显式传 `allowUnregisteredTools: true`。
   */
  allowedTools?: string[];
  /** 黑名单：优先于白名单 */
  deniedTools?: string[];
  /** 已确认过高危操作的工具名集合（HITL 通过后才放进来） */
  confirmedTools?: string[];
  /**
   * 放行未登记在权限表里的工具，默认 false。
   * 仅用于「接入了可信的自建 Server、且工具确实没登记」的过渡场景，
   * 正常情况下应保持关闭。
   */
  allowUnregisteredTools?: boolean;
}

export type PermissionDecision =
  | { allowed: true; level: ToolPermissionLevel }
  | { allowed: false; reason: string; level: ToolPermissionLevel };

/** Host 层权限判定：返回决策而不是抛错，方便调用方决定降级还是中断 */
export function checkToolPermission(
  toolName: string,
  ctx: PermissionContext = {},
): PermissionDecision {
  const level = classifyToolPermission(toolName);

  if (ctx.deniedTools?.includes(toolName)) {
    return { allowed: false, reason: '工具在黑名单内', level };
  }

  // 第十八章 18.11：白名单缺省时回落到默认清单，而不是"全部放行"
  const hasExplicitAllowlist = !!ctx.allowedTools && ctx.allowedTools.length > 0;
  const allowlist = hasExplicitAllowlist ? ctx.allowedTools! : DEFAULT_ALLOWED_TOOLS;

  if (!ctx.allowUnregisteredTools && !allowlist.includes(toolName)) {
    return {
      allowed: false,
      reason: hasExplicitAllowlist
        ? '当前用户未被授权使用该工具'
        : '工具未登记在默认白名单内（默认 deny）',
      level,
    };
  }

  if (requiresConfirmation(toolName, level) && !ctx.confirmedTools?.includes(toolName)) {
    return {
      allowed: false,
      reason: `${level === 'admin' ? '高危' : '写'}操作需人工确认后执行`,
      level,
    };
  }

  return { allowed: true, level };
}
