/**
 * services/chat/src/security/tool-runtime.ts
 *
 * 工具调用的超时与配额护栏（第十八章 18.6.1 / 18.11）
 *
 * Agent 调工具是不可信的：可能卡死（外部 API 不响应）、可能被诱导无限调用
 * （Denial of Wallet：烧 token、打爆下游、刷光配额）。两道护栏：
 *   1. 配额：每次会话/每轮对话的工具调用次数上限（防无限调用）
 *   2. 超时：单次工具调用的硬上限（防卡死拖垮进程）
 *
 * 抛**类型化错误**，让上层能区分「超配额」与「超时」做不同降级：
 *   超配额 → 直接告知 Agent 本轮额度用尽，别再重试
 *   超时   → 可回落到 fallback 工具或让用户重试
 */

export class ToolQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolQuotaError';
  }
}

export class ToolTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolTimeoutError';
  }
}

/**
 * 工具调用次数计数器（进程内，简单够用；生产可换 Redis 以便多实例共享）。
 *
 * 计数维度由调用方用 `key` 决定：按会话、按用户、按 Agent 都行，
 * 比写死 conversationId 灵活（本项目 MCP 调用链上就有 conversationId，
 * 而 Skill 工具链只有 userId）。
 */
export class QuotaTracker {
  private readonly used = new Map<string, number>();

  constructor(readonly limit: number = 30) {}

  /** 消费 n 次配额；超限返回 false（调用方据此抛 ToolQuotaError），不会超发 */
  tryConsume(key: string, n = 1): boolean {
    const cur = this.used.get(key) ?? 0;
    if (cur + n > this.limit) return false;
    this.used.set(key, cur + n);
    return true;
  }

  consumed(key: string): number {
    return this.used.get(key) ?? 0;
  }

  remaining(key: string): number {
    return Math.max(0, this.limit - this.consumed(key));
  }

  /** 新会话开始时清零，避免长跑进程里计数只增不减 */
  reset(key: string): void {
    this.used.delete(key);
  }
}

export interface ToolGuardContext {
  /** 配额计数维度：会话 ID / 用户 ID / Agent ID */
  quotaKey: string;
  quota: QuotaTracker;
}

/**
 * 带配额 + 超时的工具调用包装。
 *
 * @param fn 接收一个 AbortSignal。注意 `Promise.race` 只是**不再等待**超时的
 *           Promise，并不会取消它——底层 HTTP 请求还会继续跑。真正能取消要靠
 *           这个 signal（fetch / axios 都支持），所以把它传给被包装函数。
 *
 * 用法：
 *   await withToolGuards('search_knowledge_base', { quotaKey, quota },
 *     (signal) => fetch(url, { signal }), 10_000);
 */
export async function withToolGuards<T>(
  toolName: string,
  ctx: ToolGuardContext,
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 30_000,
): Promise<T> {
  // 1. 配额
  if (!ctx.quota.tryConsume(ctx.quotaKey)) {
    throw new ToolQuotaError(
      `工具调用超配额：${toolName}（key=${ctx.quotaKey}，上限 ${ctx.quota.limit}）`,
    );
  }

  // 2. 超时
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ToolTimeoutError(`${toolName} 超时（${timeoutMs}ms）`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
