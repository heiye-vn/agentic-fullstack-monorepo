import { TokenUsageService } from './token-usage.service.js';
import { estimateTextTokens, getModelPricing } from './token-estimator.js';

/**
 * 节点级 Token Usage 包装器入参选项
 */
export interface WithTokenUsageOptions {
  graphName: string;
  nodeName: string;
  agentName: string;
  modelName: string;
  modelConfigId?: string | null;
  provider?: string;
  conversationId?: string | null;
  messageId?: string | null;
  threadId?: string | null;
  overrideReason?: string | null;
}

/**
 * 从模型调用返回中尝试抽取 Provider Usage 元数据
 * 兼容两种规范：
 * 1. LangChain v2 的 usage_metadata（input_tokens, output_tokens, cache_read 等）
 * 2. OpenAI 或常规 Provider 的 response_metadata.usage / tokenUsage
 */
function extractUsageFromResponse(result: any): {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
} | null {
  if (!result) return null;

  // 1. LangChain v2 标准 usage_metadata
  const usageMeta = result.usage_metadata;
  if (usageMeta && typeof usageMeta.input_tokens === 'number') {
    const cached =
      usageMeta.input_token_details?.cache_read ??
      usageMeta.cache_read_input_tokens ??
      0;
    return {
      inputTokens: usageMeta.input_tokens,
      outputTokens: usageMeta.output_tokens ?? 0,
      cachedInputTokens: cached,
    };
  }

  // 2. OpenAI / Provider 原生 response_metadata.usage
  const respUsage = result.response_metadata?.usage || result.response_metadata?.tokenUsage;
  if (respUsage) {
    const inputTokens = respUsage.prompt_tokens ?? respUsage.input_tokens;
    const outputTokens = respUsage.completion_tokens ?? respUsage.output_tokens ?? 0;
    const cached =
      respUsage.prompt_tokens_details?.cached_tokens ??
      respUsage.cached_tokens ??
      respUsage.cache_read_input_tokens ??
      0;

    if (typeof inputTokens === 'number') {
      return {
        inputTokens,
        outputTokens,
        cachedInputTokens: cached,
      };
    }
  }

  return null;
}

/**
 * 从不同类型的返回结果中抽取文本内容进行兜底估算
 */
function extractContentFromResponse(result: any): string {
  if (!result) return '';
  if (typeof result.content === 'string') return result.content;
  if (typeof result.text === 'string') return result.text;
  if (Array.isArray(result.content)) {
    return result.content
      .map((item: any) => (typeof item === 'string' ? item : item?.text || ''))
      .join('');
  }
  return '';
}

/**
 * 高阶模型调用包装器：自动统计延迟、抽取真实 Usage 或兜底估算，并触发持久化
 *
 * 关键设计原则：
 * - 纯侧路设计：数据库写入失败或采集异常仅 warn 记录，绝不阻断业务执行与结果返回
 * - 支持侧路关闭：当 usageService 注入 null 时直接透传执行，零额外开销
 *
 * @param options 节点归因与模型元数据
 * @param usageService 持久化服务实例（可为 null）
 * @param fn 包装的目标异步模型调用函数
 */
export async function withTokenUsage<T>(
  options: WithTokenUsageOptions,
  usageService: TokenUsageService | null,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  const result = await fn();
  const latencyMs = Date.now() - start;

  // 若未注入 usageService，直接原样返回结果
  if (!usageService) {
    return result;
  }

  try {
    const usage = extractUsageFromResponse(result);
    const pricing = getModelPricing(options.modelName);

    let inputTokens: number;
    let outputTokens: number;
    let cachedInputTokens: number;
    let isEstimated: boolean;

    if (usage) {
      inputTokens = usage.inputTokens;
      outputTokens = usage.outputTokens;
      cachedInputTokens = usage.cachedInputTokens || 0;
      isEstimated = false;
    } else {
      // 当 Provider 未返回 usage 时的兜底估算。
      // 该 5 倍率来自 10.2 节的多角色真实样本统计（实际输入与输出比约为 5.8:1），
      // 此处取保守圆整倍率 5。估算仅作为防丢失的兜底方案，生产应优先依赖真实 usage。
      const content = extractContentFromResponse(result);
      outputTokens = estimateTextTokens(content);
      inputTokens = outputTokens * 5;
      cachedInputTokens = 0;
      isEstimated = true;
    }

    const normalInputTokens = Math.max(0, inputTokens - cachedInputTokens);
    const estimatedCostUsd =
      (normalInputTokens / 1_000_000) * pricing.input +
      (cachedInputTokens / 1_000_000) * (pricing.cachedInput ?? pricing.input) +
      (outputTokens / 1_000_000) * pricing.output;

    await usageService.recordUsage({
      ...options,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cachedInputTokens,
      estimatedCostUsd,
      isEstimated,
      latencyMs,
    });
  } catch (err) {
    console.warn('[withTokenUsage] Failed to record usage, skipping:', err);
  }

  return result;
}
