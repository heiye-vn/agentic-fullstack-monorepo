/**
 * services/chat/mcp-servers/rag-server/src/index.ts
 *
 * RAG-as-MCP-Server 的独立进程入口。
 *
 * 与另两个内置 Server 不同，它**不能**只靠 env 启动：
 * 检索实现（向量库 + Embedding）和 userId 必须由宿主机注入。
 * 因此这个入口主要演示"独立部署形态"：真实生产里应由一个
 * 持有 Prisma / EmbeddingService 的宿主进程调用 createRagServer() 后
 * 挂到 Streamable HTTP 上对外提供服务。
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRagServer } from './server.js';

async function main() {
  const server = createRagServer({
    userId: process.env.RAG_SERVER_USER_ID ?? 'system',
    searchFn: async () => {
      throw new Error(
        'rag-server 未注入检索实现：请在宿主进程内调用 createRagServer({ searchFn }) 后挂载传输层',
      );
    },
  });

  await server.connect(new StdioServerTransport());
  console.error('RAG MCP Server running on stdio（检索实现未注入，调用将失败）');
}

main().catch((err) => {
  console.error('RAG MCP Server 启动失败:', err);
  process.exit(1);
});
