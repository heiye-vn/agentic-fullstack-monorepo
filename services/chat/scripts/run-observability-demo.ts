/**
 * run-observability-demo.ts — 第十六章配套演示脚本
 *
 * 在一个进程里同时演示「用户态可观测性」与「运维态可观测性」：
 * - 🧵 traceId 贯穿：整段执行包在 runWithTrace 里，之后所有结构化日志带同一 traceId
 * - 👤 用户态：消费 streamAnalysisGraph 的事件流，统计推给前端的 progress/markdown 帧
 * - 🧠 运维态：模型经 createChatModel 创建，自动带上 LlmTracer，
 *              每次真实 LLM 调用打 llm_start/llm_end（含节点名、token、耗时）
 * - 💰 成本归因：Tracer 把每条记录写进注入的 usageSink（生产里是 TokenUsageService → token_usages）
 * - 📈 指标：prom-client 进程内累加，打印 /metrics 的关键片段
 *
 * 为什么只问一句「你好」：它会走 triage 的 answer 短路分支，
 * 只产生 1 次真实模型调用，几秒内跑完；完整 analyze 链路实测要几分钟。
 *
 * 运行：
 *   npx tsx scripts/run-observability-demo.ts
 *   LOG_PRETTY=1 npx tsx scripts/run-observability-demo.ts   # 彩色可读日志
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { createChatModel } from '../src/llm/model.factory.js';
import { streamAnalysisGraph } from '../src/llm/graph/requirement-analysis-graph.js';
import { registry } from '../src/observability/metrics.js';
import {
  runWithTrace,
  newTraceId,
  setConversationId,
  setGraphName,
  getTraceId,
} from '../src/observability/trace-context.js';
import { flushUsageWrites, setUsageSink } from '../src/observability/llm-tracer.js';
import type { TokenUsageRecord } from '../src/llm/cost/token-usage.service.js';

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '../.env') });

const MODEL_NAME = process.env.LLM_OBS_TEST_MODEL || 'qwen3.7-flash-2026-07-15';

// 内存版 sink：演示 Tracer → 计量服务的写入路径。
// 生产里换成接 Prisma 的 TokenUsageService（由 UsageSinkBootstrap 在应用启动时注入）。
const records: TokenUsageRecord[] = [];
setUsageSink({
  recordUsage: async (r: TokenUsageRecord) => {
    records.push(r);
  },
});

const traceId = newTraceId();

console.log('='.repeat(88));
console.log('🔭 可观测性 Demo：traceId 贯穿 + LLM 调用观测 + Token 归因 + 指标');
console.log('='.repeat(88));
console.log(`🧵 本次 traceId：${traceId}`);
console.log(`🤖 模型：${MODEL_NAME}（可用 LLM_OBS_TEST_MODEL 覆盖）`);
console.log('▶ 开始执行（下方 JSON 行即结构化日志，每行都带同一个 traceId）\n');

const frameStats: Record<string, number> = {};

try {
  await runWithTrace(traceId, async () => {
    // 把请求级上下文补全：会话 ID 与图名会随每条 LLM 记录一起落库
    setConversationId('obs-demo');
    setGraphName('requirement-analysis');

    console.log(`   (确认 getTraceId() = ${getTraceId()})\n`);

    const model = createChatModel({
      modelName: MODEL_NAME,
      streaming: true,
      temperature: 0,
    });

    // 用户态视角：这一层是推给前端的帧
    const stream = streamAnalysisGraph(
      { input: '你好，请用一句话介绍你自己' },
      { model, useTriage: true },
    );

    for await (const event of stream) {
      frameStats[event.type] = (frameStats[event.type] ?? 0) + 1;
    }

    await flushUsageWrites();
  });
} catch (err) {
  console.log('\n⚠️  执行中断：', err instanceof Error ? err.message : String(err));
  console.log('   若为额度/鉴权问题，换 LLM_OBS_TEST_MODEL 或检查 .env 里的 OPENAI_* 配置。');
}

// ---- 用户态可观测性：推给前端的帧 ----
console.log('\n' + '─'.repeat(88));
console.log('👤 用户态可观测性（推给前端的 SSE 帧，本次累计）：');
for (const [type, count] of Object.entries(frameStats)) {
  console.log(`   - ${type.padEnd(16)} ${count} 帧`);
}

// ---- Token 归因：这些就是会写进 token_usages 表的记录 ----
console.log('\n' + '─'.repeat(88));
console.log(`💰 Token 归因（${records.length} 条记录，每条都能追到节点与会话）：`);
let totalIn = 0;
let totalOut = 0;
let totalCost = 0;
for (const r of records) {
  totalIn += r.inputTokens ?? 0;
  totalOut += r.outputTokens ?? 0;
  totalCost += r.estimatedCostUsd ?? 0;
  console.log(
    `   - 图=${(r.graphName ?? '-').padEnd(22)} 节点=${(r.nodeName ?? '-').padEnd(16)} ` +
      `in=${r.inputTokens ?? 0} out=${r.outputTokens ?? 0} ${r.isEstimated ? '(估算)' : '(真实)'}`,
  );
}
console.log(
  `   合计：input=${totalIn} output=${totalOut} 估算成本≈$${totalCost.toFixed(6)}`,
);

// ---- 运维态可观测性：/metrics 端点暴露的内容 ----
console.log('\n' + '─'.repeat(88));
console.log('📈 /metrics 关键片段（进程内累加，prom-client）：');
console.log((await registry.getSingleMetricAsString('llm_calls_total')).trim());
console.log((await registry.getSingleMetricAsString('llm_tokens_total')).trim());
console.log((await registry.getSingleMetricAsString('llm_node_duration_seconds')).split('\n')[0]);
console.log('─'.repeat(88));
console.log('提示：/metrics 与 /ready 是应用启动后暴露的 HTTP 端点，本脚本只演示进程内机制。');
console.log('      排障链：Grafana 看到 llm_node_duration 异常 → 按 traceId 捞日志 →');
console.log('              日志里的 conversationId → 查 token_usages 确认成本。');
