/**
 * services/chat/mcp-servers/web-search/src/server.ts
 *
 * 第十二章 12.7 — Web Search MCP Server
 *
 * 与第十一章 CRAG 的 Web 兜底是同一件事的两种形态：
 * 之前是写死在 Agent 里的工具，现在是独立进程里的标准 MCP 能力，
 * 任何 MCP Client（不只是本项目）都能连。
 *
 * 三个工具都只返回 title / snippet / url 三元组，不返回整页正文 ——
 * 12.15 明确要求控制 outputSize，否则工具结果会把上下文撑爆。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  resolveSearchProvider,
  type SearchFn,
  type SearchResult,
} from './search-provider.js';

export const WEB_SEARCH_NAME = 'web-search';
export const WEB_SEARCH_VERSION = '1.0.0';

export interface CreateWebSearchServerOptions {
  /** 注入真实搜索实现（测试用）；不给则按 env 决定 live / mock */
  search?: SearchFn;
  /** 显式声明模式，用于日志与返回值标注 */
  mode?: 'live' | 'mock';
}

function jsonText(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function trimResults(results: SearchResult[]) {
  return results.map((r) => ({ title: r.title, snippet: r.snippet, url: r.url }));
}

export function createWebSearchServer(
  options: CreateWebSearchServerOptions = {},
): McpServer {
  const resolved = options.search
    ? { search: options.search, mode: options.mode ?? ('live' as const) }
    : resolveSearchProvider();
  const { search, mode } = resolved;

  const server = new McpServer({
    name: WEB_SEARCH_NAME,
    version: WEB_SEARCH_VERSION,
  });

  server.tool(
    'search_competitors',
    '搜索竞品的相关功能实现，了解市场上类似产品怎么做。' +
      '适用于需求分析阶段调研竞品方案；不适用于查自家内部资料（那是知识库工具的事）。' +
      '输入：搜索关键词，可选限定域名。输出：竞品条目的 title/snippet/url 与一句话摘要。',
    {
      query: z
        .string()
        .describe('搜索关键词，如"Jira 批量导入功能"、"Notion AI 写作助手"'),
      domain: z.string().optional().describe('限定搜索域名，如"atlassian.com"'),
    },
    async ({ query, domain }) => {
      const searchQuery = `${query} product feature implementation`;
      const results = await search(searchQuery, domain);
      return jsonText({
        query,
        mode,
        results: trimResults(results),
        summary:
          results.length > 0
            ? `找到 ${results.length} 个竞品参考，涵盖：${results
                .map((r) => r.title)
                .join('、')}`
            : '未找到相关竞品信息',
      });
    },
  );

  server.tool(
    'search_best_practices',
    '搜索特定领域的行业最佳实践和设计模式。适用于需求设计阶段参考业界标准做法。' +
      '输入：主题，可选行业领域。输出：参考条目与命中数量。',
    {
      topic: z
        .string()
        .describe('主题，如"批量数据导入"、"权限系统设计"、"实时通知架构"'),
      industry: z.string().optional().describe('行业领域，如"SaaS"、"电商"、"金融"'),
    },
    async ({ topic, industry }) => {
      const searchQuery = industry
        ? `${topic} best practices ${industry} industry`
        : `${topic} best practices software engineering`;
      const results = await search(searchQuery);
      return jsonText({
        topic,
        industry: industry || '通用',
        mode,
        results: trimResults(results),
        summary:
          results.length > 0
            ? `找到 ${results.length} 篇最佳实践参考`
            : '未找到相关最佳实践',
      });
    },
  );

  server.tool(
    'search_tech_stack',
    '搜索技术选型对比和生产实践经验。适用于估算复杂度时参考同类方案的工期与风险。' +
      '输入：技术关键词，可选使用场景。输出：选型参考条目。',
    {
      technology: z
        .string()
        .describe('技术关键词，如"WebSocket vs SSE"、"PostgreSQL 全文检索"'),
      useCase: z.string().optional().describe('使用场景，如"万级并发推送"、"百万级数据导入"'),
    },
    async ({ technology, useCase }) => {
      const searchQuery = useCase
        ? `${technology} ${useCase} architecture comparison`
        : `${technology} production experience comparison`;
      const results = await search(searchQuery);
      return jsonText({
        technology,
        useCase: useCase || '通用',
        mode,
        results: trimResults(results),
        summary:
          results.length > 0
            ? `找到 ${results.length} 篇技术选型参考`
            : '未找到相关技术参考',
      });
    },
  );

  return server;
}
