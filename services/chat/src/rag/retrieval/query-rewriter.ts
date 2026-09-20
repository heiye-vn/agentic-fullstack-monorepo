/**
 * services/chat/rag/retrieval/query-rewriter.ts
 *
 * 第十一章 11.8.1 — Query 改写（Query Expansion / Sub-query Decomposition）
 *
 * 解决的问题：用户提问往往是短的、口语化的、带上下文依赖的：
 *   - "它一个月多少钱？"          → 缺主语，检索必然漂移
 *   - "企业版能建几个项目来着"      → 口语化，和文档书面表达不对齐
 *   - "SSO 和 SAML 都支持吗"       → 实际是两个子问题
 *
 * 三种改写手段（教程 11.8.1）：
 *   1. 同义改写（Query Expansion）      口语 → 书面规范表达
 *   2. 子问题分解（Sub-query）          复合问题 → 多个独立可检索的子问题
 *   3. 历史上下文回填                   把上文信息补进当前问题，消除指代
 *
 * 工程约束（重要）：
 *   - 改写失败绝不能阻塞主流程，必须静默退化为"原句单跑"
 *   - 改写条数要有上限保护，防止模型乱来把检索放大成 N 倍成本
 *   - 优先用 withStructuredOutput 强约束 schema，退路是解析 JSON 文本
 */

import { z } from 'zod';

/** 结构化输出 schema：1–5 条非空改写 */
export const REWRITE_SCHEMA = z.object({
  queries: z.array(z.string().min(1)).min(1).max(5),
});

export const REWRITE_SYSTEM_PROMPT = `你是一个查询改写助手。把用户的原始问题改写为 1-3 个更利于检索的版本：
- 保持原意
- 用规范的书面表达
- 复杂问题可以拆成多个子问题
返回 JSON: { "queries": ["改写1", "改写2", ...] }`;

/**
 * 最小模型抽象
 *
 * 之所以不直接依赖 BaseChatModel，是为了让单测可以用普通对象 mock。
 * withStructuredOutput 可选：不支持的调用方会走 JSON 文本解析退路。
 */
export type RewriteMessages = Array<{ role: string; content: string }>;

export interface RewriteModel {
  withStructuredOutput?: (
    schema: unknown,
  ) => { invoke: (messages: RewriteMessages) => Promise<unknown> };
  invoke: (messages: RewriteMessages) => Promise<any>;
}

export interface RewriteOptions {
  /** 历史对话，用于消除指代（"它多少钱" → "企业版多少钱"） */
  conversationHistory?: string;
  /** 上限保护：即使模型返回更多，也只保留前 N 条，默认 3 */
  maxQueries?: number;
}

/** 从模型响应中安全取出文本（兼容 string / { content } / AIMessage） */
function extractText(response: unknown): string {
  if (typeof response === 'string') return response;
  const content = (response as any)?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (typeof c === 'string' ? c : String(c?.text ?? '')))
      .join('');
  }
  return '';
}

/**
 * 改写用户原始问题为 1-N 条更利于检索的查询
 *
 * @param model 具备 invoke 的模型（可选支持 withStructuredOutput）
 * @param originalQuery 用户原始问题
 * @param options 历史对话与条数上限
 * @returns 改写后的查询数组；任何失败都退化为 [originalQuery]，保证调用方永远有得检索
 */
export async function rewriteQuery(
  model: RewriteModel,
  originalQuery: string,
  options: RewriteOptions = {},
): Promise<string[]> {
  if (!originalQuery || originalQuery.trim() === '') return [];

  const { conversationHistory, maxQueries = 3 } = options;

  const userMessage = conversationHistory
    ? `历史对话：\n${conversationHistory}\n\n当前问题：${originalQuery}`
    : originalQuery;

  let queries: string[] = [];

  try {
    if (typeof model.withStructuredOutput === 'function') {
      // 主路径：schema 强约束，模型不可能返回非法结构
      const structured = model.withStructuredOutput(REWRITE_SCHEMA);
      const result = (await structured.invoke([
        { role: 'system', content: REWRITE_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ])) as { queries?: string[] };
      queries = result?.queries ?? [];
    } else {
      // 退路：普通 invoke 后从文本里抠 JSON
      const raw = await model.invoke([
        { role: 'system', content: REWRITE_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ]);
      const parsed = REWRITE_SCHEMA.safeParse(JSON.parse(extractText(raw)));
      if (parsed.success) queries = parsed.data.queries;
    }
  } catch {
    // 改写是"增强"而不是"必需"：失败不阻断，退化为原句
    queries = [];
  }

  if (queries.length === 0) return [originalQuery];

  // 去重 + 去空 + 截断
  const deduped = [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
  return deduped.slice(0, maxQueries);
}

/**
 * 11.8.2 多路召回：把改写出的多条 query 并行检索后合并去重
 *
 * 合并策略用"出现次数加权 + 保留最高分"：
 * 同一个 chunk 被越多条 query 命中，说明它越可能是真正相关的。
 *
 * @param queries 改写后的多条查询
 * @param searchFn 单条查询的检索函数
 * @param topK 最终返回条数
 */
export async function multiQuerySearch(
  queries: string[],
  searchFn: (query: string, topK: number) => Promise<any[]>,
  topK = 5,
): Promise<any[]> {
  if (queries.length === 0) return [];

  const lists = await Promise.all(queries.map((q) => searchFn(q, topK)));

  const merged = new Map<string, any>();
  for (const list of lists) {
    for (const item of list ?? []) {
      const existing = merged.get(item.chunkId);
      if (!existing) {
        merged.set(item.chunkId, { ...item, hitCount: 1 });
      } else {
        // 保留更高的分数，命中次数累加
        existing.hitCount += 1;
        existing.score = Math.max(existing.score ?? 0, item.score ?? 0);
      }
    }
  }

  // 命中次数优先，其次按分数
  return [...merged.values()]
    .sort((a, b) => b.hitCount - a.hitCount || (b.score ?? 0) - (a.score ?? 0))
    .slice(0, topK);
}
