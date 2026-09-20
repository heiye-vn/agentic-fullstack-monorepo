/**
 * services/chat/mcp-servers/rag-server/src/server.ts
 *
 * 第十二章 12.14 — RAG-as-MCP-Server
 *
 * 第十一章的检索能力原本只能被本项目的 Agent 使用；
 * 包成 MCP Server 之后，任何 MCP Client（IDE、桌面助手、别的 Agent 服务）
 * 都能直接连过来检索同一套知识库。
 *
 * 权限红线（12.15）：userId 在构造时就固定，检索发生在 Server 内部并带用户维度过滤。
 * 绝不能"先检索全库，再让模型不要回答无权限内容"。
 *
 * 依赖全部走注入，不直接 import Prisma / EmbeddingService ——
 * 这样它既能被本项目复用，也能单独部署成远程 Server。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ragAsk, type RagAskInput } from '../../../rag/pipeline/rag-pipeline.js';

export const RAG_SERVER_NAME = 'rag-server';
export const RAG_SERVER_VERSION = '1.0.0';

export interface RagChunk {
  content: string;
  score?: number;
  metadata?: {
    documentId?: string;
    chunkId?: string;
    source?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface RagServerDeps {
  /** 检索时必须带上的用户维度，用于文档归属过滤 */
  userId: string;
  /** 真实向量检索实现，可用 createVectorSearchFn(...) 构造 */
  searchFn: (query: string, topK: number) => Promise<RagChunk[]>;
  /** 生成式问答实现；不传则只注册检索工具 */
  askFn?: (input: RagAskInput) => Promise<{ answer: string; citations: unknown[] }>;
  /** askFn 未传时用于走默认 ragAsk 的模型 */
  model?: any;
}

function jsonText(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

export function createRagServer(deps: RagServerDeps): McpServer {
  const server = new McpServer({
    name: RAG_SERVER_NAME,
    version: RAG_SERVER_VERSION,
  });

  server.tool(
    'search_knowledge_base',
    '检索企业内部知识库，返回与问题相关的文档片段及来源。' +
      '适用于查询内部规范、产品文档、历史决策、技术方案。' +
      '输入：自然语言问句 + 可选返回条数。输出：片段正文、来源与相关度分数。' +
      '注意：结果已经按调用方身份做过权限过滤，不要用于检索公开互联网资料（那是 web-search 的事）。',
    {
      query: z.string().describe('搜索问题，应当是自然语言完整问句'),
      topK: z.number().optional().describe('返回结果数量，默认 5'),
    },
    async ({ query, topK = 5 }) => {
      const chunks = await deps.searchFn(query, topK);
      return jsonText({
        query,
        userId: deps.userId,
        results: chunks.map((c) => ({
          content: c.content,
          source: c.metadata?.source,
          documentId: c.metadata?.documentId,
          chunkId: c.metadata?.chunkId,
          score: c.score,
        })),
      });
    },
  );

  // 生成式工具：直接给出带引用的答案。
  // 教程建议优先暴露上面的检索工具让上层 Agent 自己综合，
  // 这里两个都给，由调用方按场景选。
  if (deps.askFn || deps.model) {
    server.tool(
      'answer_with_knowledge_base',
      '基于企业内部知识库直接生成答案并返回引用来源。适用于只需要最终结论、不需要自己综合的场景。' +
        '输入：问题 + 可选检索条数。输出：answer 与 citations。',
      {
        question: z.string().describe('用户问题'),
        topK: z.number().optional().describe('检索结果数量，默认 5'),
      },
      async ({ question, topK = 5 }) => {
        const ask = deps.askFn
          ? (input: RagAskInput) => deps.askFn!(input)
          : (input: RagAskInput) => ragAsk(input);

        const result = await ask({
          question,
          userId: deps.userId,
          topK,
          model: deps.model,
        });

        return jsonText({ answer: result.answer, citations: result.citations });
      },
    );
  }

  return server;
}
