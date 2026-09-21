/**
 * trace-context.ts
 *
 * 用 AsyncLocalStorage（ALS）维护「请求级 traceId」。
 * 一次请求的整个异步调用链（中间件 → controller → service → LangGraph 节点 → LLM 回调）
 * 都能通过 getTraceId() 读到同一个 traceId，无需逐层透传参数。
 *
 * 额外承载 conversationId：SSE 建流时写入，让 LLM 回调落库时能把成本归到具体会话
 * （token_usages 表没有 traceId 列，会话 ID 是日志与成本表之间的那座桥）。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/** trace 上下文：一次请求的 traceId、起始时间与业务归属（会话 / 图名）。 */
export interface TraceStore {
  traceId: string;
  /** 请求起点，用于计算整请求耗时 */
  startedAt: number;
  /** 当前请求处理的会话 ID（SSE 路径写入，其余路径为 undefined） */
  conversationId?: string;
  /** 当前请求正在跑的图名（如 requirement-analysis），用于成本归因 */
  graphName?: string;
}

const storage = new AsyncLocalStorage<TraceStore>();

/** 在给定 traceId 的上下文里执行 fn。中间件用它包住整个请求处理。 */
export function runWithTrace<T>(traceId: string, fn: () => T): T {
  return storage.run({ traceId, startedAt: Date.now() }, fn);
}

/** 任意位置读取当前 traceId；不在 trace 上下文里（如启动期、定时任务）则返回 'no-trace'。 */
export function getTraceId(): string {
  return storage.getStore()?.traceId ?? 'no-trace';
}

/** 读取当前请求已耗时（ms）；上下文外返回 0。 */
export function getElapsedMs(): number {
  const store = storage.getStore();
  return store ? Date.now() - store.startedAt : 0;
}

/**
 * 取出当前 store 的引用（不要直接改写它，请用上面的 setter）。
 *
 * 用途：TraceMiddleware 在请求入口拿到引用后在 `res.on('finish')` 里直接读取。
 * 实测在 Node 真实 HTTP 流程中，finish 回调是能看到 ALS 上下文（AsyncLocalStorage）
 * 的，但这个行为依赖 Node 的异步资源传播细节——把 store 引用先捕获下来，
 * 就不必让「access 日志能不能带上 traceId」依赖这个隐晦前提。
 */
export function peekTraceStore(): TraceStore | undefined {
  return storage.getStore();
}

/** 生成一个新的 traceId（供中间件在请求入口调用）。 */
export function newTraceId(): string {
  return randomUUID();
}

/** 把当前请求关联到会话 ID。上下文外调用是安全的空操作。 */
export function setConversationId(conversationId: string): void {
  const store = storage.getStore();
  if (store) store.conversationId = conversationId;
}

/** 读取当前请求关联的会话 ID。 */
export function getConversationId(): string | undefined {
  return storage.getStore()?.conversationId;
}

/**
 * 标注当前正在执行的图名（如 requirement-analysis），用于把成本归因到具体图。
 * 只写请求级 store；在脚本等无请求上下文的场景里是安全空操作——
 * 那种场景下建议先 runWithTrace() 再调用，避免进程级状态泄漏到后续请求。
 */
export function setGraphName(graphName: string): void {
  const store = storage.getStore();
  if (store) store.graphName = graphName;
}

/** 读取当前图名；未标注时返回 undefined，由调用方决定默认值。 */
export function getGraphName(): string | undefined {
  return storage.getStore()?.graphName;
}
