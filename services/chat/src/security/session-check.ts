/**
 * services/chat/src/security/session-check.ts
 *
 * 认证与会话吊销校验（第十八章 18.9）
 *
 * 本章调研发现的第一个短板：**验签通过 ≠ 会话还活着**。
 * 用户在 user-system 登出（或改密码触发 `refreshToken.revokedAt` 批量吊销）后，
 * chat 服务只要还能验签通过，旧 access token 就继续有效直到自然过期。
 * 令牌有效期越短这个窗口越小，但只要签发和吊销不在一处，窗口就不会为零。
 *
 * 现实约束：chat 与 user-system 是**两个独立数据库**（chat=autix_chat，
 * user-system=autix_rbac），chat 不能直接查 `RefreshToken`。
 * 所以这里把「会话状态从哪来」做成**可插拔接口** `SessionStore`：
 *   - 默认 `noopSessionStore`：不校验、放行，保持现有行为不变（不硬依赖跨库）
 *   - 生产注入 DB / HTTP 实现：连 user_system 库或调 user-system 接口校验
 * 判定逻辑（机制）是完整可测的，「数据从哪来」是部署时的注入决策，互不耦合。
 *
 * 本项目的吊销机制与参照实现不同，这里做了适配：
 *   - 参照实现：JWT 里带 `sessionId`，查 `UserSession.isActive/expiresAt`
 *   - 本项目：JWT 里带 `tokenVersion`（见 user-system 的 JwtStrategy），
 *     以「用户级版本号」做懒失效 —— 改密码/改权限时 `tokenVersion` 递增，
 *     所有旧 token 一次性失效
 * 因此 `SessionSubject` 同时容纳两种标识，实现方各取所需。
 */

import { UnauthorizedException } from '@nestjs/common';

/**
 * 会话裁决：
 *   - alive：会话有效
 *   - revoked：会话已吊销/过期 → 拒绝
 *   - skip：本环境不做校验（如 noop，或 token 里没有可校验的标识）→ 放行
 */
export type SessionVerdict = 'alive' | 'revoked' | 'skip';

/** 从 JWT payload 里能拿到的、可用于吊销判定的标识 */
export interface SessionSubject {
  userId: string;
  /** 参照实现的会话 ID（本项目 user-system 不签发，保留兼容位） */
  sessionId?: string;
  /** 本项目的凭证版本号（user-system 签发，递增即吊销全部旧 token） */
  tokenVersion?: number;
}

export interface SessionStore {
  check(subject: SessionSubject): Promise<SessionVerdict>;
}

/** 默认实现：不校验（chat 不硬依赖跨库；生产显式注入真实实现） */
export const noopSessionStore: SessionStore = {
  async check() {
    return 'skip';
  },
};

/**
 * 真实会话记录 → 裁决的纯映射（字段口径：isActive + expiresAt）。
 * DB/HTTP 实现拿到会话记录后调它，保证判定口径一致、可单测。
 *
 * 查不到记录按 revoked 处理 —— 这是 Fail Closed：
 * 「不确定它活着」和「确定它死了」在认证场景里应当得到同一个结论。
 */
export function verdictFromSession(
  session: { isActive: boolean; expiresAt: Date } | null,
  now: Date = new Date(),
): SessionVerdict {
  if (!session) return 'revoked';
  if (!session.isActive || session.expiresAt.getTime() <= now.getTime()) return 'revoked';
  return 'alive';
}

/**
 * tokenVersion → 裁决的纯映射（本项目实际走的机制）。
 *
 * payload 里没有 tokenVersion（比如更老版本签发的 token）时返回 `skip`：
 * 那是签发侧的缺口，不该由校验侧随机挑一个"拒绝"或"放行"来兜底。
 */
export function verdictFromTokenVersion(
  payloadTokenVersion: number | undefined,
  currentTokenVersion: number | undefined,
): SessionVerdict {
  if (payloadTokenVersion === undefined) return 'skip';
  if (currentTokenVersion === undefined || currentTokenVersion === null) return 'revoked';
  return currentTokenVersion === payloadTokenVersion ? 'alive' : 'revoked';
}

/**
 * 用「查当前 tokenVersion」的函数构造一个 SessionStore。
 *
 * 用法（生产环境）：注入一个连 user_system 库 / 调 user-system 接口的 lookup，
 * 就能让「改密码 → 所有旧 token 立即失效」在同一进程内闭环，而不必等 token 自然过期。
 */
export function createTokenVersionStore(
  lookup: (userId: string) => Promise<number | null>,
): SessionStore {
  return {
    async check(subject) {
      if (subject.tokenVersion === undefined) return 'skip';
      const current = await lookup(subject.userId);
      // 查不到用户（已注销/被删）→ 拒绝
      if (current === null) return 'revoked';
      return verdictFromTokenVersion(subject.tokenVersion, current);
    },
  };
}

/**
 * 断言会话仍然有效；被吊销时抛 401。
 *
 * 无 subject 或 subject 里没有任何可校验标识时放行 —— 向后兼容存量 token，
 * 收紧与否是部署期决策（换一个 store 即可，不用改调用点）。
 */
export async function assertSessionAlive(
  store: SessionStore,
  subject?: SessionSubject | null,
): Promise<void> {
  if (!subject) return;
  if (subject.sessionId === undefined && subject.tokenVersion === undefined) return;

  const verdict = await store.check(subject);
  if (verdict === 'revoked') {
    throw new UnauthorizedException('会话已失效，请重新登录');
  }
}

// ─────────────────────── query token 收紧 ───────────────────────

/**
 * 本章调研发现的第二个短板：**query token 对所有路由开放**。
 * URL 里的 token 会进 access 日志、浏览器历史、Referer 头，属于凭据泄露面。
 *
 * 但 SSE 又确实需要它 —— 浏览器原生 EventSource 不能自定义请求头。
 * 所以正确做法不是一刀切禁用，而是**只对流式路由开这个口子**。
 *
 * 本项目命中流式语义的路径：
 *   - /api/sse/tasks                    （含 /sse）
 *   - /api/graph/stream                 （以 /stream 结尾）
 *   - /api/graph/analysis-stream        （以 -stream 结尾）
 *   - /api/langchain/chain-stream       （以 -stream 结尾）
 *   - /api/conversations/:id/chat       （以 /chat 结尾）
 */
const STREAM_PATH_RE = /(?:^|[/-])stream$/;

export function isStreamRoute(rawPath: string | undefined): boolean {
  if (!rawPath) return false;
  // 去掉 query string，只看路径
  const path = rawPath.split('?')[0];
  return path.includes('/sse') || STREAM_PATH_RE.test(path) || path.endsWith('/chat');
}
