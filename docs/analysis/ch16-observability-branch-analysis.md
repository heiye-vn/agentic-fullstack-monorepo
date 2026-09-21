# autix-demo feat/ch16-observability 分支实现分析

> 对照教程：docs/tutorials/18. 第十六章：可观测性—你不能优化你看不见的东西.md
> 分析时间：2026-09-21

---

## 一句话结论

这一章**新增了 5 个观测基础设施文件 + 4 处入口接线**，把「看不见」的代码库变成了「有三件套骨架」的工程。但**真正默认生效的只有 3 件事**（traceId 贯穿日志、HTTP access 日志 + 耗时直方图、/metrics 与 /ready 端点）；**Token 计量和 LLM 调用 Tracer 是 opt-in，生产链路一条都没接**，只出现在 demo 脚本和测试里。

---

## 一、实际落地清单（代码已核实）

### 1. 新增 `services/chat/src/observability/`（5 个文件，全部新写）

| 文件 | 作用 | 关键实现 |
|---|---|---|
| `trace-context.ts` | 请求级 traceId 上下文 | `AsyncLocalStorage<{traceId, startedAt}>`，导出 `runWithTrace / getTraceId / getElapsedMs / newTraceId`；上下文外返回 `'no-trace'` 兜底 |
| `logger.ts` | 结构化日志 | pino 单例 + `traceMixin()` 每条日志注入 traceId + `redact`（apiKey/password/authorization）+ `createLogger(module)` 子 logger；默认 JSON，`LOG_PRETTY=1` 走 pino-pretty |
| `trace.middleware.ts` | 请求入口中间件 | 复用上游 `x-trace-id`（无则新建）→ `runWithTrace` 包裹全程 → 回写响应头 → `res.on('finish')` 打 `http_request` access 日志并 observe `httpDuration` |
| `metrics.ts` | Prometheus 注册中心 | `prom-client` Registry + `collectDefaultMetrics`；5 个自定义指标：`http_request_duration_seconds`(Histogram)、`llm_calls_total`(Counter)、`llm_tokens_total`(Counter)、`llm_call_duration_seconds`(Histogram)、`sse_active_connections`(Gauge)；`recordLlmCall()` 供 Tracer 调用 |
| `llm-tracer.ts` | LLM 旁路观测 | 继承 `BaseCallbackHandler`，实现 `handleLLMStart/End/Error/ToolStart/ToolEnd`；`extractUsageFromLLMResult()` 兼容 `llmOutput.tokenUsage` 与 `generations[].message.usage_metadata` 两种 token 口径；结束时喂 `recordLlmCall` |

### 2. 接线改动（9 处）

| 位置 | 改动 |
|---|---|
| `app.module.ts` | 实现 `NestModule`，`consumer.apply(TraceMiddleware).forRoutes('*')` |
| `app.controller.ts` | 新增 `GET /metrics`（text/plain）、`GET /ready`（未就绪返 503）；保留 `GET /health` 作 liveness |
| `app.service.ts` | 新增 `getReadiness()`：`prisma.$queryRaw\`SELECT 1\`` 真探 DB，`ready` 由 checks 全 ok 推出 |
| `common/response.interceptor.ts` | 从各自 `randomUUID()` 改为复用 `getTraceId()` |
| `common/all-exceptions.filter.ts` | 同上 + 补一条 `unhandled_exception` 结构化 error 日志（原先静默吞异常） |
| `llm/graph/requirement-analysis-graph.ts` | 新增 `GraphObservability` 接口、`wrapNodeUsage()` 纯函数；`createAnalysisGraph(model, options)` 新增可选 `usageService` / `conversationId` |
| `llm/graph/experts.ts` | 4 个专家 + `createAnalysisSupervisorSubGraph` 透传 `obs`，调用 `wrapNodeUsage` |
| `package.json` | 新增 `pino@^10.3.1`、`pino-pretty@^13.1.3`、`prom-client@^15.1.3` |
| `langgraph.json` | Studio 配置（dev-time 可视化，`./src/llm/graph/studio.ts:graph`） |

### 3. 配套资产

- `test/chapter16-observability.spec.ts`：Layer 1（零 LLM、9 个确定性用例：ALS 嵌套/并发隔离、traceMixin、指标注册与累加、usage 双口径提取、opt-in 契约）+ Layer 2（需 `OPENAI_API_KEY` 且 `RUN_LLM_OBS_TESTS=1`，真实图端到端断言 ≥1 条记录）
- `scripts/run-observability-demo.ts`：一次真实分析里同时演示 traceId 贯穿 / LlmTracer / token 计量 / metrics 片段，用内存版 usageService 承接记录

---

## 二、关键发现：文档说 vs 代码做（7 条差距）

### ⚠️ 1. 「opt-in」意味着生产链路 Metric 全 0（最重要）

`getTraceId` 等基础能力随中间件默认生效，但 **Token 计量和 LLM Trace 必须显式传参**：

```
src/llm/graph/pipeline.ts:342                 createAnalysisGraph(model)          ← 无 usageService
src/llm/deepagent/deep-orchestrator.service.ts:59  createAnalysisGraph(model)     ← 无 usageService
src/llm/graph/studio.ts:15                    createAnalysisGraph(model)          ← 无 usageService
```

`new LlmTracer()` 全仓库只出现两处：`scripts/run-observability-demo.ts:25` 和 `test/...:170`。

**后果**：按当前代码启动服务，`/metrics` 里 `llm_calls_total` / `llm_tokens_total` / `llm_call_duration_seconds` 恒为 0，`token_usages` 表不会新增一行。文档 16.10.3 声明了边界，但读起来容易误判为「端到端已打通」。

### ⚠️ 2. 即使传了 usageService，主链 4 个节点仍漏采

`createAnalysisGraph` 里只有 `queryHandler` 和两个子图带 obs：

```ts
.addNode('triage',      (state) => triageNode(state, { model }))        // ← 无 obs
.addNode('extractStep', (state) => extractNode(state, { model }))       // ← 无 obs
.addNode('clarifyStep', (state) => clarifyNode(state, { model }))       // ← 无 obs
.addNode('riskStep',    (state) => riskNode(state, { model }))          // ← 无 obs
.addNode('queryHandler',(state) => queryHandlerNode(state, { model, obs }))  // ✅
// createAnalysisSupervisorSubGraph(model, obs) / createSummarySubGraph(model, obs)  ✅
```

而 `analyze` 意图的主链路恰恰是 triage → extract → clarify → (analysis/risk) → summary。也就是说**每次真实分析必走的 triage/extract/clarify/risk 四个调用全不计 token**。这不是「最小侵入」，是覆盖缺口。

### ⚠️ 3. 两套计量口径并存，互不通信

| | LlmTracer | withTokenUsage |
|---|---|---|
| 数据来源 | LangChain callback 旁路 | 解析 `invoke` 返回值 metadata |
| 落点 | Prometheus 指标 | `token_usages` 表 |
|  failures 可见性 | `handleLLMError` 计数 ok=false | 无（包内 try/catch 只 console.warn） |

同一模型同时挂两者 → 同一次调用被两条路各算一遍，且**指标与账单数据无法对齐校验**。若只挂 usageService，`llm_tokens_total` 依旧不涨。

### 4. `sse_active_connections` 声明了但没接线

文档 16.7.1 自己承认：应在 `sse.service.ts` 的 `addConnection/removeConnection` 处 `inc()/dec()`，本章未动 SSE 服务。全仓库 grep 确认除声明外零引用。

### 5. token_usages 缺 traceId 字段，排障链要绕一次

文档 16.8 给出的链路是「用 traceId 定位 conversationId → 再用 conversationId 查 token_usages」。但 demo 里 `conversationId` 写死 `'obs-demo'`，生产路径又不传 conversationId（第 1 条），所以**这条链路目前在数据上是断的**。若移植，建议直接给表加 `traceId` 列。

### 6. PII 纪律自相矛盾

`logger.ts` 的 `redact` 只挡 `apiKey / password / headers.authorization`，而：

- `requirement-analysis-graph.ts:236` `console.error('[extractNode] JSON 解析失败:', error, '\n原始内容:', extractRaw)` → **LLM 原文进日志**
- `requirement-analysis-graph.ts:289` clarifyNode 同样问题

这与 16.10.1「PII 进日志」反模式直接冲突。另外全 src 仍有 **124 处 `console.*`**，pino 只在 5 个文件里使用；生产路径的 `conversation.controller.ts`(10)、`sse.service.ts`(7)、`pipeline.ts`(8) 一行都没换。

### 7. 缺失：外部基建与环境变量文档

- 无 prometheus / grafana / otel-collector 的 compose 定义 → 本地只能验证「进程内累加」
- `.env.example` 里**没有任何** `LOG_LEVEL` / `LOG_PRETTY` / `RUN_LLM_OBS_TESTS` / `LLM_OBS_TEST_MODEL` 说明
- `/metrics`、`/ready` 挂在 `AppController` 上且中间件包 `forRoutes('*')`，**无鉴权**

---

## 三、需要警惕的实现细节（移植时容易被复制）

1. **SSE 会把 http 直方图打爆**：`res.on('finish')` 在 SSE 断连时才触发，此时 elapsedMs 是整条流的分钟级耗时，而 `http_request_duration_seconds` 的 buckets 上限是 30s → **所有 SSE 请求全部落进 `+Inf` 桶**，P99 直接失真。SSE 应单独打点或排除。
2. **route label 的高基数风险**：`const route = (req as any).route?.path ?? req.path`。若某些路由下 `req.route` 未就绪而回落到原始路径，含 `:id` 的路径会给每个会话新建一条时间序列，与文档自己「禁止高基数 label」的警告冲突。**需实测确认，这是必须验证的点。**
3. **readiness 只探 DB**：LLM 网关故障不会被 readiness 感知（文档 16.11 Q5 有意为之）。K8s 下表现为 DB 抖动→503 全摘流，LLM 挂了→继续接流量。移植时按自己的 SLO 决定要不要加 `- timeout`。
4. **`withTokenUsage` 的估算兜底**：拿不到 usage 时 `inputTokens = outputTokens * 5`（5 来自第十章样本 5.8x 保守取整）。这个常量会把估算数据混进真实成本表，靠 `isEstimated` 区分——报表必须过滤。
5. **pino transport 与日志轮转**：默认无 transport（直接 stdout），容器化下正确（轮转交给 Docker/K8s），但如果有人在生产设 `LOG_PRETTY=1`，会以工作线程方式跑 pino-pretty，性能回退。
6. **ALS 边界**：`no-trace` 兜底意味着启动期 / 定时任务（`@nestjs/schedule`）的所有日志都是 `no-trace`。若有 cron 调 LLM，那些调用**既没 traceId 也没计量**。

---

## 四、对目标项目 agentic-fullstack-monorepo 的移植要点

### 现状

- 目标 **尚无任何 observability 设施**（全仓只 docs 提到 pino/prom-client，无 AsyncLocalStorage）
- 目标 **已有第 10 章 cost 模块**：`services/chat/src/llm/cost/` 下 `token-usage.service.ts`、`with-token-usage.ts`、`token-estimator.ts`、`budget-policy.ts`、`agent-model-set.ts`
- `AppController` 只有 `health` / `hello`，需加 `/metrics`、`/ready`
- `token-estimator.ts` 已存在 → 第十章 Token 经济学对齐已完成

### 接口差异（不能照抄）

| 项 | autix-demo | 目标项目 |
|---|---|---|
| `TokenUsageRecord` 字段 | 基本类型，非可空 | 多为 `string \| null` 可空、含 `id?` |
| Prisma 引入 | `@prisma/client` | `generated/prisma/client.js` 且是 `import type` |
| 导入后缀 | 无 `.js` | **必须带 `.js`**（ESM + NodeNext） |
| `withTokenUsage` 签名 | `(options, usageService, fn)` | **一致**，可直接沿用 |
| 参数顺序 | `usageService` 在第 2 位 | 同 |

### 建议的移植顺序（不等价于文档的章节顺序）

1. `trace-context.ts` + `logger.ts` + `trace.middleware.ts` + `app.module` 注册 → traceId 贯穿（零风险、收益最高）
2. `metrics.ts` + `/metrics` + `/ready` → 但要**先把 SSE 排除出 httpDuration**，并实测 route label
3. `llm-tracer.ts` + `GraphObservability` + `wrapNodeUsage` → **务必给 triage/extract/clarify/risk 四个节点补 obs**（修掉上文第 2 条缺陷）
4. **决策点**：是否在 `ChatStreamService` 生产路径真正注入 `usageService` 和 `LlmTracer`。建议这次不要复制 autix 的「默认关闭」——那样上线后指标全是空的，等于白做。若担心写库压力，可先只挂 Tracer（写指标、不写库）。
5. demo 脚本 + 测试：Layer 1 用例可直接搬（零 LLM），Layer 2 需把模型名换成目标项目在用的档位（`demo-model-strong/medium/weak`，注意 deepseek-v4-flash 比 qwen3.7-flash 贵 7.4 倍这一已知事实）

---

## 五、值得肯定的设计（确实学到了，别抄反了）

- **`AsyncLocalStorage` 选型正确**：不用改任何函数签名就能让 traceId 到达 LangGraph 节点深处，这是本章最值钱的一招
- **`wrapNodeUsage` 抽成纯函数**：可脱离 LLM 单测，Layer 1 测试因此能覆盖计量契约
- **opt-in 用额外可选参数** 而非修改必填签名：向后兼容，旧测试零改动通过
- **liveness / readiness 分离**：`health` 永远 true 不是 bug 而是职责不同，新增 `/ready` 而不是改 health 语义
- **`16.10.3` 明确声明「本地可跑 vs 外部基建」边界**：诚实，避免了「加了 prom-client 就等于有监控」的误解

---

## 六、移植落地结果对照（2026-09-21）

目标分支 `chapter-16-observability`，提交 `68e341f`（26 文件）。上游参照提交为 autix 的 `f4201c0`（19 文件）。
逐文件对照如下，**结论：功能已全部覆盖，"未搬" 的三项各有明确理由。**

| autix `f4201c0` 改动的文件 | 目标项目处理 | 说明 |
|---|---|---|
| `observability/trace-context.ts` | ✅ 搬（并加 `peekTraceStore()`） | 新增 peek 是为让中间件把 store 引用捕获下来，不赌 ALS 能传播到 `res.on('finish')` |
| `observability/logger.ts` | ✅ 搬 | redact 刻意**不写 `token`**，否则 token 计数会被一起抹掉 |
| `observability/metrics.ts` | ✅ 搬 + 增强 | 增加 `llm_node_duration_seconds`、`normalizeRoute()`（防 label 高基数） |
| `observability/llm-tracer.ts` | ✅ 搬 | 多一个可插拔 `usageSink` 出口，用于接第十章已有的 `TokenUsageService` |
| `observability/trace.middleware.ts` | ✅ 搬 + 改 | SSE 走独立直方图，不混进 `httpDuration` |
| `app.controller.ts`（/metrics、/ready） | ✅ 搬 | 另加 `RAW_RESPONSE_PATHS` 放行，见下行 |
| `app.service.ts`（getReadiness） | ✅ 搬 | 真跑 `SELECT 1`，未就绪 503 |
| `app.module.ts`（注册中间件） | ✅ 搬 | `forRoutes('*')` |
| `common/all-exceptions.filter.ts` | ✅ 搬 | 目标路径在 `common/filters/`；改为优先复用 header 里的 traceId |
| `common/response.interceptor.ts` | ✅ 搬 + 修 bug | **上游存在「`/metrics` 被包成 JSON」的静默失效**，目标项目已修 |
| `llm/llm.module.ts` | ✅ 搬 | `useFactory` 提供并导出 `TokenUsageService` |
| `llm/graph/requirement-analysis-graph.ts` | ⚠️ 用替代方案 | 不逐节点包 `wrapNodeUsage`，改为在 `createChatModel` 挂回调（见下）；仅补 `setGraphName()` |
| `llm/graph/experts.ts` | ⚠️ 用替代方案 | 上游把 `obs` 参数一路透传进 4 个专家工厂；回调方案无需改此文件 |
| `llm/cost/with-token-usage.ts` | ➖ 无需改 | 上游修的「先读 `usage_metadata`」目标项目**本来就是对的** |
| `llm/cost/cost.controller.ts`（`GET /api/cost/summary`） | ✅ 已补搬 | 首次移植时遗漏，2026-09-21 补上（含守卫元数据测试） |
| `scripts/run-observability-demo.ts` | ✅ 搬 | |
| `test/chapter16-observability.spec.ts` | ✅ 搬 + 扩 | 34 项（上游为 Layer1+Layer2） |
| `bun.lock` | ➖ 不适用 | 目标项目用 pnpm |
| （上游独有的硬编码调试 fetch 块清理） | ➖ 无需处理 | 那是 autix 自己的 Cursor 调试残留（`127.0.0.1:7439`），目标项目从未有过 |

### 为什么用「模型工厂回调」替代「逐节点 wrapNodeUsage」

上游需要在 4 个顶层节点 + 2 个子图 + 4 个专家工厂里逐处接线，且实测仍漏采主链四步。
目标项目改为在 `createChatModel()` 产出的实例上挂 `callbacks: [getLlmTracer()]`：

- LangChain 每次调用执行 `CallbackManager.configure(config.callbacks, this.callbacks, …)`，
  **构造期回调会与调用期合并且不重复**，所以图节点、并行专家、Critic-Refine 循环、ReAct 工具轮次全覆盖；
- LangGraph 会把 `metadata.langgraph_node` 注入节点内部，节点名自动带出，无需手工传 `nodeName`；
- 代价：无法像 `withTokenUsage` 那样拿到「包裹函数的返回值」做兜底估算，改为在回调里按
  流式增量累计输出 token 估算值。两条路径并存，报表侧一律靠 `isEstimated` 区分。

### 与上游的三处有意分歧

1. **不复制 opt-in 默认关闭**：上游把指标/落库做成默认 off，生产链路会恒为 0。目标项目直接接线，
   env 只作为排障时的关闭手段（`OBS_USAGE_PERSIST=0` 仅关落库，指标照出）。
2. **`sse_active_connections` 真接线**：上游只声明未使用，目标项目按连接集合实际大小 `set()`。
3. **修掉 `/metrics` 被响应拦截器包装的静默失效**：上游未处理该路径（其响应拦截器结构不同）。

