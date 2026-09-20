/**
 * services/chat/mcp-servers/requirement-analyzer/src/index.ts
 *
 * stdio 独立进程入口：
 *   npx tsx services/chat/mcp-servers/requirement-analyzer/src/index.ts
 *
 * ⚠️ stdio 传输的铁律：stdout 只能写 JSON-RPC 协议消息，
 * 任何日志都必须走 stderr，否则会污染协议流导致 Client 解析失败。
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRequirementAnalyzerServer } from './server.js';

async function main() {
  const server = createRequirementAnalyzerServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Requirement Analyzer MCP Server running on stdio');
}

main().catch((err) => {
  console.error('Requirement Analyzer MCP Server 启动失败:', err);
  process.exit(1);
});

// 进程退出信号：优雅关闭，避免子进程僵留
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.error(`收到 ${signal}，退出 Requirement Analyzer MCP Server`);
    process.exit(0);
  });
}
