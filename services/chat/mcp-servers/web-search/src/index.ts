/**
 * services/chat/mcp-servers/web-search/src/index.ts
 *
 * stdio 独立进程入口：
 *   TAVILY_API_KEY=xxx npx tsx services/chat/mcp-servers/web-search/src/index.ts
 *
 * 未配置 TAVILY_API_KEY 时自动进入 mock 模式，进程仍然可用（返回预置语料）。
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createWebSearchServer } from './server.js';
import { resolveSearchProvider } from './search-provider.js';

async function main() {
  const { mode } = resolveSearchProvider();
  const server = createWebSearchServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Web Search MCP Server running on stdio (mode: ${mode})`);
}

main().catch((err) => {
  console.error('Web Search MCP Server 启动失败:', err);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.error(`收到 ${signal}，退出 Web Search MCP Server`);
    process.exit(0);
  });
}
