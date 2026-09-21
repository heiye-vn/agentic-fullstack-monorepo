/**
 * llm-tracer.ts
 *
 * 一个 LangChain BaseCallbackHandler，旁路观测每一次真实 LLM / 工具调用：
 * - 记录 token 用量与耗时（流式调用拿不到 provider usage 时按字符数降级估算）
 * - 带上当前请求的 traceId（来自 ALS），与 HTTP access 日志用同一个 traceId 串联
 * - 喂给 Prometheus 指标（llm_calls_total / llm_tokens_total / llm_call_duration_seconds / llm_node_duration_seconds）
 * - 可选落库：配置了 usageSink（生产里是 TokenUsageService）后，每次调用写一条 token_usages
 *
 * 为什么用 callback 而不是逐节点包 withTokenUsage：
 * LangGraph 会把 `metadata.langgraph_node` 注入到节点内部的 runnable config，
 * 因此挂在模型实例上的回调能自动拿到「这次调用来自哪个节点」，一次接入覆盖全图所有节点
 * （含子图、并行专家、Critic-Refine 循环），不需要改十几处调用点。
 *
 * 不依赖任何外部 SaaS；LangSmith 仅在 LANGSMITH_TRACING=true 时另行启用。
 */
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { Serialized } from '@langchain/core/load/serializable';
import type { LLMResult } from '@langchain/core/outputs';
import { createLogger } from './logger.js';
import { recordLlmCall } from './metrics.js';
import { getConversationId, getGraphName, getTraceId } from './trace-context.js';
import { estimateTextTokens, getModelPricing } from '../llm/cost/token-estimator.js';
import type { TokenUsageRecord } from '../llm/cost/token-usage.service.js';

const log = createLogger('llm');

/** token_usages 的写入接口。生产里由 TokenUsageService（Prisma）实现。 */
export interface LlmUsageSink {
  recordUsage(record: TokenUsageRecord): Promise<void> | void;
}

let usageSink: LlmUsageSink | null = null;
const pendingWrites = new Set<Promise<void>>();

/** 配置落库出口；传 null 则只打日志与指标，不落库。 */
export function setUsageSink(sink: LlmUsageSink | null): void {
  usageSink = sink;
}

export function getUsageSink(): LlmUsageSink | null {
  return usageSink;
}

/** 等待所有在途的落库写入完成（测试与 demo 脚本收尾时用；生产不需要）。 */
export async function flushUsageWrites(): Promise<void> {
  while (pendingWrites.size > 0) {
    // allSettled 会在调用时同步把 Set 的元素逐个收集成数组，
    // 因此直接传 Set 是安全的（.finally 的 delete 不会影响本次已收集的元素）
    await Promise.allSettled(pendingWrites);
  }
}

interface RunState {
  startedAt: number;
  /** LangGraph 节点名（metadata.langgraph_node），拿不到时回落 'llm' */
  node: string;
  agent: string;
  modelName: string;
  provider: string;
  promptChars: number;
  /** 输入 token 估算值：在 start 时对完整 prompt 算一次（中英文口径不同，不能拿字符数硬除） */
  promptTokensEst: number;
  /** 输出 token 估算值：流式时按每个 new token 增量累加，仅在 provider 未回 usage 时兜底 */
  outputTokensEst: number;
  graphName: string;
}

/**
 * 从 callback 的 LLMResult 里抠真实 token 用量。
 * 兼容两处来源（与 cost/with-token-usage.ts 的字段口径一致）：
 *   1) llmOutput.tokenUsage / llmOutput.usage（provider 经 callbacks 的常见落点）
 *   2) generations[].message.usage_metadata（LangChain v2 标准化字段）
 */
export function extractUsageFromLLMResult(output: LLMResult): {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
} {
  const llmOutput = output.llmOutput as Record<string, any> | undefined;
  const tu = llmOutput?.tokenUsage ?? llmOutput?.usage;
  if (tu) {
    const inputTokens = tu.promptTokens ?? tu.prompt_tokens ?? tu.input_tokens ?? 0;
    const outputTokens = tu.completionTokens ?? tu.completion_tokens ?? tu.output_tokens ?? 0;
    const cachedInputTokens =
      tu.promptTokensDetails?.cachedTokens ??
      tu.prompt_tokens_details?.cached_tokens ??
      tu.cache_read_input_tokens ??
      0;
    if (inputTokens || outputTokens) return { inputTokens, outputTokens, cachedInputTokens };
  }

  for (const gen of output.generations ?? []) {
    for (const g of gen ?? []) {
      const um = (g as any)?.message?.usage_metadata;
      if (um) {
        return {
          inputTokens: um.input_tokens ?? 0,
          outputTokens: um.output_tokens ?? 0,
          cachedInputTokens: um.input_token_details?.cache_read ?? 0,
        };
      }
    }
  }

  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function pickSerializedName(serialized: Serialized | undefined, fallback: string): string {
  const id = (serialized as any)?.id;
  if (Array.isArray(id) && id.length > 0) return String(id[id.length - 1]);
  return fallback;
}

export class LlmTracer extends BaseCallbackHandler {
  name = 'llm-tracer';

  /** runId → 本次调用的运行态（开始时间、节点名、累计字符数） */
  private runs = new Map<string, RunState>();

  handleLLMStart(
    llm: Serialized,
    prompts: string[],
    runId: string,
    _parentRunId?: string,
    extraParams?: Record<string, unknown>,
    _tags?: string[],
    metadata?: Record<string, unknown>,
    _runName?: string,
  ): void {
    // metadata 既可能作为独立入参传入，也可能挂在 extraParams.metadata 上，两处都看
    const meta = (metadata ??
      (extraParams?.metadata as Record<string, unknown> | undefined) ??
      {}) as Record<string, unknown>;
    const node = asString(meta.langgraph_node) ?? 'llm';
    const modelName =
      asString(meta.ls_model_name) ?? pickSerializedName(llm, 'unknown');
    const promptText = prompts.join('');

    this.runs.set(runId, {
      startedAt: Date.now(),
      node,
      agent: asString(meta.agent_name) ?? node,
      modelName,
      provider: asString(meta.ls_provider) ?? 'openai',
      promptChars: promptText.length,
      promptTokensEst: estimateTextTokens(promptText),
      outputTokensEst: 0,
      // 优先级：ALS 里显式标注的图名 > 有 langgraph_node 说明在图节点内 > 直接调用
      graphName:
        getGraphName() ?? (asString(meta.langgraph_node) ? 'langgraph' : 'direct-call'),
    });

    log.debug(
      { runId, node, model: modelName, promptChars: promptText.length },
      'llm_start',
    );
  }

  /** 流式：增量累计输出 token 估算值，供 usage 缺失时兜底 */
  handleLLMNewToken(token: string, _idx: unknown, runId: string): void {
    const state = this.runs.get(runId);
    if (state && token) state.outputTokensEst += estimateTextTokens(token);
  }

  handleLLMEnd(output: LLMResult, runId: string): void {
    const state = this.runs.get(runId);
    this.runs.delete(runId);

    const latencyMs = Date.now() - (state?.startedAt ?? Date.now());
    const node = state?.node ?? 'llm';
    const modelName = state?.modelName ?? 'unknown';

    const usage = extractUsageFromLLMResult(output);
    const hasRealUsage = usage.inputTokens > 0 || usage.outputTokens > 0;

    // provider 没回 usage（常见于部分网关的流式响应）→ 用 start 时算好的 prompt 估算
    // 与流式累计的输出估算兜底，并用 isEstimated 标记；报表侧必须能把估算值与真实值分开看。
    const inputTokens = hasRealUsage ? usage.inputTokens : (state?.promptTokensEst ?? 0);
    const outputTokens = hasRealUsage ? usage.outputTokens : (state?.outputTokensEst ?? 0);
    const cachedInputTokens = hasRealUsage ? usage.cachedInputTokens : 0;
    const isEstimated = !hasRealUsage;

    const pricing = getModelPricing(modelName);
    const normalInputTokens = Math.max(inputTokens - cachedInputTokens, 0);
    const estimatedCostUsd =
      (normalInputTokens / 1_000_000) * pricing.input +
      (cachedInputTokens / 1_000_000) * (pricing.cachedInput ?? pricing.input) +
      (outputTokens / 1_000_000) * pricing.output;

    log.info(
      { runId, node, model: modelName, latencyMs, inputTokens, outputTokens, isEstimated },
      'llm_end',
    );

    recordLlmCall({ latencyMs, inputTokens, outputTokens, ok: true, node });

    this.persist({
      conversationId: getConversationId() ?? null,
      graphName: state?.graphName ?? 'direct-call',
      nodeName: node,
      agentName: state?.agent ?? node,
      modelName,
      provider: state?.provider ?? 'openai',
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cachedInputTokens,
      estimatedCostUsd,
      isEstimated,
      latencyMs,
    });
  }

  handleLLMError(err: Error, runId: string): void {
    const state = this.runs.get(runId);
    this.runs.delete(runId);

    const latencyMs = Date.now() - (state?.startedAt ?? Date.now());
    log.error(
      { runId, node: state?.node ?? 'llm', latencyMs, err: String(err).slice(0, 200) },
      'llm_error',
    );
    // 失败的调用也要计数，否则错误率分母不对
    recordLlmCall({
      latencyMs,
      inputTokens: 0,
      outputTokens: 0,
      ok: false,
      node: state?.node ?? 'llm',
    });
  }

  handleToolStart(tool: Serialized, input: string, runId: string): void {
    log.debug(
      { runId, tool: pickSerializedName(tool, 'unknown'), inputChars: input?.length ?? 0 },
      'tool_start',
    );
  }

  handleToolEnd(output: unknown, runId: string): void {
    const text = typeof output === 'string' ? output : JSON.stringify(output ?? '');
    log.debug({ runId, outputChars: text.length }, 'tool_end');
  }

  /** 落库是旁路：失败不回抛，也不阻塞模型调用链（记录在 pendingWrites 里便于测试等待）。 */
  private persist(record: TokenUsageRecord): void {
    const sink = usageSink;
    if (!sink) return;

    const task = Promise.resolve()
      .then(() => sink.recordUsage(record))
      .catch((err) => {
        log.warn({ err: String(err).slice(0, 200) }, 'usage_sink_write_failed');
      })
      .finally(() => {
        pendingWrites.delete(task);
      });

    pendingWrites.add(task);
  }

  /** 测试用：清空进行中的 run 状态 */
  reset(): void {
    this.runs.clear();
  }
}

let singleton: LlmTracer | null = null;

/**
 * 全局单例：所有模型实例共享同一个 handler，
 * 这样 runId 表只有一份，指标累加也不会因为模型实例多而重复建表。
 */
export function getLlmTracer(): LlmTracer {
  if (!singleton) singleton = new LlmTracer();
  return singleton;
}

/** 当前 traceId（导出便于调试脚本打印，避免直接依赖 trace-context）。 */
export function currentTraceId(): string {
  return getTraceId();
}
