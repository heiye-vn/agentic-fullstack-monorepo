/**
 * services/chat/mcp-servers/web-search/src/search-provider.ts
 *
 * 第十二章 12.7 — 搜索能力的可插拔实现
 *
 * 三层降级：Tavily 实时搜索 → Tavily 失败降级 → 内置 Mock。
 * 之所以单独抽一层，是为了让 Server 在没有外网 / 没有 API Key 的环境下
 * 也能稳定跑通演示链路（第十一章 CRAG 的 Web 兜底同理）。
 */

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

export type SearchFn = (query: string, domain?: string) => Promise<SearchResult[]>;

export interface TavilyOptions {
  apiKey?: string;
  maxResults?: number;
  /** 注入式 fetch，便于测试替换 */
  fetchImpl?: typeof fetch;
}

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

export function createTavilySearch(options: TavilyOptions = {}): SearchFn {
  const { apiKey, maxResults = 5, fetchImpl = fetch } = options;

  return async function tavilySearch(query, domain) {
    const body: Record<string, unknown> = {
      query,
      max_results: maxResults,
      search_depth: 'basic',
    };
    if (domain) {
      body.include_domains = [domain];
    }

    const res = await fetchImpl(TAVILY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Tavily API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as {
      results?: Array<{ title?: string; content?: string; url?: string }>;
    };

    return (data.results ?? []).map((r) => ({
      title: r.title ?? '',
      snippet: (r.content ?? '').substring(0, 200),
      url: r.url ?? '',
    }));
  };
}

const MOCK_GROUPS: Array<{ match: RegExp; results: SearchResult[] }> = [
  {
    match: /批量|import|导入/,
    results: [
      {
        title: 'Jira 批量导入功能 - CSV/Excel 格式支持',
        snippet:
          'Jira 支持通过 CSV 文件批量导入 Issue，包含字段映射、数据验证、冲突处理等完整流程。单次导入限制 1000 条，超过需分批处理。',
        url: 'https://support.atlassian.com/jira/docs/import-data',
      },
      {
        title: 'Linear - 批量数据迁移最佳实践',
        snippet:
          'Linear 提供 API 和 CSV 两种导入方式。API 方式支持增量同步，CSV 方式适合一次性迁移。建议先导入少量数据验证映射正确性。',
        url: 'https://linear.app/docs/import',
      },
      {
        title: '大规模数据导入架构设计 - 异步队列模式',
        snippet:
          '生产环境批量导入推荐使用异步队列 + Worker 模式：前端上传 → 解析验证 → 入队列 → Worker 分批写入 → WebSocket 通知完成。',
        url: 'https://engineering.example.com/bulk-import-architecture',
      },
    ],
  },
  {
    match: /权限|permission|rbac/,
    results: [
      {
        title: 'RBAC vs ABAC vs ReBAC - 权限模型对比',
        snippet:
          'RBAC 适合角色清晰的场景；ABAC 适合细粒度动态策略；ReBAC 适合社交/协作场景。中小型 SaaS 推荐从 RBAC 起步。',
        url: 'https://auth0.com/blog/rbac-vs-abac',
      },
      {
        title: 'Notion 权限体系设计分析',
        snippet:
          'Notion 采用层级继承 + 例外覆盖的混合模型：Workspace → Team → Page 三级继承，每级可独立设置 Guest 和 Member 角色。',
        url: 'https://www.notion.so/help/sharing-and-permissions',
      },
    ],
  },
  {
    match: /实时|websocket|推送/,
    results: [
      {
        title: 'WebSocket vs SSE vs Long Polling 技术选型',
        snippet:
          '双向通信选 WebSocket；服务端单向推送选 SSE（更简单、自动重连）；兼容老浏览器选 Long Polling。SSE 在大多数通知场景够用。',
        url: 'https://web.dev/articles/eventsource-basics',
      },
      {
        title: '百万连接 WebSocket 架构 - 分层网关设计',
        snippet:
          '超过 10 万连接时需引入网关层：接入网关（维持连接）→ 业务网关（路由消息）→ 后端服务。每层可独立水平扩展。',
        url: 'https://engineering.example.com/million-websocket',
      },
    ],
  },
];

/** 无 API Key 或 Tavily 报错时的兜底结果 */
export function createMockSearch(): SearchFn {
  return async function mockSearch(query) {
    const lower = (query ?? '').toLowerCase();
    for (const group of MOCK_GROUPS) {
      if (group.match.test(lower)) return group.results;
    }
    return [
      {
        title: `${query} - 综合参考`,
        snippet: `关于「${query}」的综合资料。建议参考官方文档和社区最佳实践进行深入调研。`,
        url: `https://example.com/search?q=${encodeURIComponent(query ?? '')}`,
      },
    ];
  };
}

/**
 * 组合成最终搜索实现：有 key 走 Tavily，失败静默降级到 Mock 并打 stderr 日志
 * （stdio 下 stdout 是协议通道，日志只能写 stderr）
 */
export function resolveSearchProvider(options: TavilyOptions = {}): {
  search: SearchFn;
  mode: 'live' | 'mock';
} {
  const apiKey = options.apiKey ?? process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return { search: createMockSearch(), mode: 'mock' };
  }

  const live = createTavilySearch({ ...options, apiKey });
  const fallback = createMockSearch();

  return {
    mode: 'live',
    search: async (query, domain) => {
      try {
        return await live(query, domain);
      } catch (err) {
        console.error(
          `[web-search] Tavily 调用失败，降级为 mock：${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return fallback(query, domain);
      }
    },
  };
}
