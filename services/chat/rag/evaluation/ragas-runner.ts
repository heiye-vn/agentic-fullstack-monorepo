/**
 * services/chat/rag/evaluation/ragas-runner.ts
 *
 * 生成层自动化评估接入（RAGAS REST 微服务客户端）
 * 对应教程 11.7.3 节：在 CI 中触发 RAGAS 自动化评估
 *
 * 核心设计：
 * - 纯异步 HTTP 调用，不耦合到主对话/查询主流程
 * - 健壮重试机制（默认 3 次）与超时熔断（默认 60s）
 * - 故障降级保证：服务不可用或崩溃时记录 warn 日志并返回 null，绝不阻断流程
 */

export interface RagasSample {
  question: string;
  answer: string;
  contexts: string[];
  ground_truth?: string;
}

export interface RagasRequest {
  samples: RagasSample[];
  metrics: string[];
}

export interface RagasRunnerOptions {
  /**
   * RAGAS 评估微服务端点
   * @default process.env.RAGAS_ENDPOINT || 'http://localhost:8000/evaluate'
   */
  endpoint?: string;
  /**
   * 单次请求超时时间（毫秒）
   * @default 60000 (60s)
   */
  timeoutMs?: number;
  /**
   * 最大尝试重试次数
   * @default 3
   */
  retries?: number;
  /**
   * 自定义 fetch 实现（便于单测与跨平台注入）
   * @default globalThis.fetch
   */
  fetchImpl?: typeof fetch;
  /**
   * 告警日志记录函数
   * @default console.warn
   */
  warn?: (message: string) => void;
}

/**
 * 调用外部 RAGAS REST 评估服务
 *
 * @param request 评测样本集合与指标列表
 * @param options 超时、重试与网络注入配置
 * @returns 评测指标结果映射；若服务不可用或重试耗尽则降级返回 null
 */
export async function runRagas(
  request: RagasRequest,
  options: RagasRunnerOptions = {},
): Promise<Record<string, number> | null> {
  const endpoint =
    options.endpoint ||
    process.env.RAGAS_ENDPOINT ||
    'http://localhost:8000/evaluate';
  const timeoutMs = options.timeoutMs ?? 60000;
  const retries = options.retries ?? 3;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const warn = options.warn || console.warn;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorMsg = `[RAGAS Runner] HTTP error status: ${response.status} (attempt ${attempt}/${retries})`;
        warn(errorMsg);
        continue;
      }

      const result = (await response.json()) as Record<string, number>;
      return result;
    } catch (err: unknown) {
      clearTimeout(timer);
      const isAbort =
        err instanceof Error &&
        (err.name === 'AbortError' || err.message.includes('aborted'));
      const errorMsg = isAbort
        ? `[RAGAS Runner] Request timed out after ${timeoutMs}ms (attempt ${attempt}/${retries})`
        : `[RAGAS Runner] Request failed (attempt ${attempt}/${retries}): ${err instanceof Error ? err.message : String(err)}`;

      warn(errorMsg);
    }
  }

  // 重试耗尽，优雅降级返回 null
  return null;
}
