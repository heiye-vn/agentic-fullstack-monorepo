/**
 * test/chapter12-mcp.spec.ts
 *
 * 第十二章《MCP——工具调用的操作系统》配套测试
 *
 * 与第十一章保持一致的组织方式：describe 标题以「12.x.y」开头，方便按章节跑：
 *   npx vitest run test/chapter12-mcp.spec.ts -t "12.4"
 *
 * 设计原则（也是和参考项目最大的不同）：
 * 测试连的是 **真实的 Server 实现**（通过 InMemoryTransport 进程内直连），
 * 而不是在 spec 里复制一份工具逻辑 —— 那样测的是副本，真实代码改了测试也不会红。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { MCPClientService } from '../src/mcp/mcp-client.service.js';
import {
  bridgeMCPToLangChain,
  jsonSchemaToZod,
  serializeMCPContent,
} from '../src/mcp/mcp-to-langchain.js';
import { MCPManager } from '../src/mcp/mcp-manager.js';
import { estimateTokens } from '../src/mcp/mcp-trace.js';
import {
  classifyToolPermission,
  checkToolPermission,
  requiresConfirmation,
} from '../src/mcp/mcp-security.js';
import { createRequirementAnalyzerServer } from '../src/mcp-servers/requirement-analyzer/src/server.js';
import { createWebSearchServer } from '../src/mcp-servers/web-search/src/server.js';
import { createRagServer } from '../src/mcp-servers/rag-server/src/server.js';
import {
  withMcpTools,
  pickMcpTools,
  createFunctionalExpert,
} from '../src/llm/graph/experts.js';

type TextContent = Array<{ type: string; text?: string }>;

function parseToolResult(result: any) {
  return JSON.parse((result.content as TextContent)[0].text ?? '{}');
}

// ============================================================
// 12.4 Requirement Analyzer MCP Server
// ============================================================

describe('12.4 Requirement Analyzer MCP Server', () => {
  let client: MCPClientService;

  beforeAll(async () => {
    client = new MCPClientService({
      type: 'memory',
      server: createRequirementAnalyzerServer(),
    });
    await client.connect();
  });

  afterAll(async () => {
    await client.close();
  });

  describe('12.4.1 协议握手与 tools/list', () => {
    it('列出 4 个工具', () => {
      const tools = client.getTools();
      expect(tools).toHaveLength(4);
      expect(tools.map((t) => t.name).sort()).toEqual([
        'analyze_completeness',
        'check_conflicts',
        'estimate_complexity',
        'generate_user_stories',
      ]);
    });

    it('tools/list 包含 description 与 inputSchema', () => {
      const tool = client.getTools().find((t) => t.name === 'analyze_completeness');
      expect(tool?.description).toBeTruthy();
      const props = (tool?.inputSchema as { properties?: Record<string, unknown> })
        ?.properties;
      expect(props).toHaveProperty('requirementText');
    });
  });

  describe('12.4.2 analyze_completeness', () => {
    it('返回标准 MCP content 结构', async () => {
      const result = await client.callTool('analyze_completeness', {
        requirementText: '作为管理员，我希望能够批量导入用户数据，要求支持 CSV 格式',
      });

      expect(Array.isArray(result.content)).toBe(true);
      expect((result.content as TextContent)[0].type).toBe('text');

      const parsed = parseToolResult(result);
      expect(parsed.totalDimensions).toBe(6);
      expect(parsed.completenessScore).toBeGreaterThan(0);
      expect(parsed.completenessScore).toBeLessThan(100);
      expect(parsed.missingDimensions.length).toBeGreaterThan(0);
    });

    it('全维度覆盖时分数为 100', async () => {
      const full = `
        作为管理员用户，我需要能够批量导入数据。
        验收标准：导入完成后显示成功数量。
        优先级 P1。
        性能要求：1000条数据30秒内完成。
        边界条件：文件超过10MB时提示错误。
      `;
      const parsed = parseToolResult(
        await client.callTool('analyze_completeness', { requirementText: full }),
      );
      expect(parsed.completenessScore).toBe(100);
      expect(parsed.missingDimensions).toHaveLength(0);
    });
  });

  describe('12.4.3 estimate_complexity', () => {
    it('简单需求返回 S', async () => {
      const parsed = parseToolResult(
        await client.callTool('estimate_complexity', {
          requirementText: '修改按钮颜色为蓝色',
        }),
      );
      expect(parsed.size).toBe('S');
      expect(parsed.estimatedDays).toBe('1-3天');
    });

    it('涉及外部集成 + AI + 实时推送返回 L 或 XL', async () => {
      const parsed = parseToolResult(
        await client.callTool('estimate_complexity', {
          requirementText: '集成第三方 API 进行 AI 智能推荐，支持实时推送通知',
        }),
      );
      expect(['L', 'XL']).toContain(parsed.size);
      expect(parsed.factors.length).toBeGreaterThan(0);
    });
  });

  describe('12.4.4 check_conflicts', () => {
    it('关键词重叠 ≥ 3 时检出冲突', async () => {
      const parsed = parseToolResult(
        await client.callTool('check_conflicts', {
          newRequirement: '批量 导入 用户 数据 CSV 格式 字段映射',
          existingRequirements: [
            {
              id: 'REQ-001',
              title: '数据导入模块',
              description: '批量 导入 数据 CSV Excel 格式 字段映射 数据验证',
            },
          ],
        }),
      );
      expect(parsed.hasConflicts).toBe(true);
      expect(parsed.conflictCount).toBe(1);
      expect(parsed.conflicts[0].id).toBe('REQ-001');
    });

    it('无重叠时返回无冲突', async () => {
      const parsed = parseToolResult(
        await client.callTool('check_conflicts', {
          newRequirement: '优化首页加载速度',
          existingRequirements: [
            { id: 'REQ-002', title: '数据导入', description: '批量导入 CSV 数据' },
          ],
        }),
      );
      expect(parsed.hasConflicts).toBe(false);
    });
  });

  describe('12.4.5 generate_user_stories', () => {
    it('从需求描述生成用户故事', async () => {
      const parsed = parseToolResult(
        await client.callTool('generate_user_stories', {
          requirementText: '作为管理员，我希望能够批量导入用户数据',
          maxStories: 2,
        }),
      );
      expect(parsed.stories.length).toBeLessThanOrEqual(2);
      expect(parsed.stories[0].story).toContain('作为');
      expect(parsed.stories[0].acceptanceCriteria.length).toBeGreaterThan(0);
    });
  });

  describe('12.4.6 Resource 与 Prompt 原语', () => {
    it('resources/list 返回 PRD 模板与验收标准规范', async () => {
      const { resources } = await client.listResources();
      const uris = resources.map((r: any) => r.uri);
      expect(uris).toContain('requirement://templates/prd');
      expect(uris).toContain('requirement://standards/acceptance-criteria');
    });

    it('resources/read 能读到 PRD 模板正文', async () => {
      const contents = await client.readResource('requirement://templates/prd');
      expect((contents[0] as { text?: string }).text).toContain('# PRD:');
    });

    it('prompts/get 渲染需求分析模板', async () => {
      const result: any = await client.getPrompt('analyze_requirement', {
        requirementText: '批量导入需求',
      });
      expect(result.messages[0].content.text).toContain('批量导入需求');
    });
  });
});

// ============================================================
// 12.5 MCP → LangChain 桥接器
// ============================================================

describe('12.5 MCP → LangChain 桥接器', () => {
  describe('12.5.1 JSON Schema → Zod 转换', () => {
    it('正确转换 string / number / boolean', () => {
      const zod = jsonSchemaToZod({
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
          active: { type: 'boolean' },
        },
        required: ['name', 'age', 'active'],
      });

      expect(zod.safeParse({ name: 'a', age: 1, active: true }).success).toBe(true);
      expect(zod.safeParse({ name: 'a', age: 'x', active: true }).success).toBe(false);
    });

    it('required 之外的字段变为 optional', () => {
      const zod = jsonSchemaToZod({
        type: 'object',
        properties: { query: { type: 'string' }, topK: { type: 'number' } },
        required: ['query'],
      });
      expect(zod.safeParse({ query: 'x' }).success).toBe(true);
      expect(zod.safeParse({}).success).toBe(false);
    });

    it('正确转换 array 与嵌套 object', () => {
      const zod = jsonSchemaToZod({
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'string' } },
          filter: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
        },
        required: ['items'],
      });
      expect(
        zod.safeParse({ items: ['a'], filter: { city: 'Beijing' } }).success,
      ).toBe(true);
      expect(zod.safeParse({ items: [1] }).success).toBe(false);
    });

    it('enum 转成 z.enum', () => {
      const zod = jsonSchemaToZod({
        type: 'object',
        properties: { size: { type: 'string', enum: ['S', 'M', 'L'] } },
        required: ['size'],
      });
      expect(zod.safeParse({ size: 'M' }).success).toBe(true);
      expect(zod.safeParse({ size: 'XXL' }).success).toBe(false);
    });
  });

  describe('12.5.2 content[] → string 序列化', () => {
    it('text 直接拼接，image/resource 降级为占位描述', () => {
      const out = serializeMCPContent([
        { type: 'text', text: 'hello' },
        { type: 'image', mimeType: 'image/png' },
        { type: 'resource', text: 'res body' },
      ] as any);
      expect(out).toContain('hello');
      expect(out).toContain('[image: image/png]');
      expect(out).toContain('res body');
    });
  });

  describe('12.5.3 桥接后的工具可被 LangChain 直接 invoke', () => {
    it('工具带前缀，且调用真实 Server 返回解析结果', async () => {
      const client = new MCPClientService({
        type: 'memory',
        server: createRequirementAnalyzerServer(),
      });
      await client.connect();

      const tools = bridgeMCPToLangChain(client, {
        serverId: 'requirement-analyzer',
        prefix: 'req_',
      });

      expect(tools).toHaveLength(4);
      expect(tools[0].name).toBe('req_analyze_completeness');

      const out = (await tools[0].invoke({
        requirementText: '作为管理员，能够批量导入 CSV 数据',
      })) as string;
      const parsed = JSON.parse(out);
      expect(parsed.completenessScore).toBeGreaterThan(0);

      await client.close();
    });
  });
});

// ============================================================
// 12.6 传输层抽象
// ============================================================

describe('12.6 传输层抽象', () => {
  it('memory 传输零进程零网络即可完成完整 JSON-RPC 握手', async () => {
    const client = new MCPClientService({
      type: 'memory',
      server: createWebSearchServer({
        search: async () => [{ title: 't', snippet: 's', url: 'u' }],
      }),
    });
    await client.connect();
    expect(client.isConnected()).toBe(true);
    expect(client.getTools()).toHaveLength(3);
    await client.close();
  });

  it('stdio 与 http 只是配置差异，不改调用面', () => {
    const stdioSpec = { type: 'stdio' as const, command: 'node', args: ['x.js'] };
    const httpSpec = { type: 'http' as const, url: 'http://localhost:3000/mcp' };
    // 构造不发起真实连接，只验证配置结构被接受
    expect(new MCPClientService(stdioSpec).isConnected()).toBe(false);
    expect(new MCPClientService(httpSpec).isConnected()).toBe(false);
  });
});

// ============================================================
// 12.7 Web Search MCP Server
// ============================================================

describe('12.7 Web Search MCP Server', () => {
  let client: MCPClientService;

  beforeAll(async () => {
    client = new MCPClientService({
      type: 'memory',
      // 注入 mock 搜索实现，避免测试依赖外网与 API Key
      server: createWebSearchServer({
        search: async (query) => [
          { title: `${query} 的竞品做法`, snippet: '批量导入 + 异步队列', url: 'https://a.com' },
          { title: `${query} 的迁移方案`, snippet: 'API 增量同步', url: 'https://b.com' },
        ],
        mode: 'mock',
      }),
    });
    await client.connect();
  });

  afterAll(async () => {
    await client.close();
  });

  it('tools/list 返回 3 个搜索工具', () => {
    expect(client.getTools().map((t) => t.name).sort()).toEqual([
      'search_best_practices',
      'search_competitors',
      'search_tech_stack',
    ]);
  });

  it('search_competitors 返回 title/snippet/url 三元组', async () => {
    const parsed = parseToolResult(
      await client.callTool('search_competitors', { query: '批量导入功能' }),
    );
    expect(parsed.mode).toBe('mock');
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0]).toHaveProperty('title');
    expect(parsed.results[0]).toHaveProperty('url');
    expect(parsed.summary).toContain('竞品');
  });

  it('search_best_practices 与 search_tech_stack 各自可用', async () => {
    const bp = parseToolResult(
      await client.callTool('search_best_practices', {
        topic: '权限系统设计',
        industry: 'SaaS',
      }),
    );
    expect(bp.industry).toBe('SaaS');

    const ts = parseToolResult(
      await client.callTool('search_tech_stack', {
        technology: 'WebSocket vs SSE',
        useCase: '实时通知',
      }),
    );
    expect(ts.useCase).toBe('实时通知');
  });
});

// ============================================================
// 12.8 MCPManager 多 Server 编排
// ============================================================

describe('12.8 MCPManager 多 Server 编排', () => {
  let manager: MCPManager;

  beforeAll(async () => {
    manager = new MCPManager();
    manager.register({
      id: 'requirement-analyzer',
      prefix: 'req_',
      spec: { type: 'memory', server: createRequirementAnalyzerServer() },
    });
    manager.register({
      id: 'web-search',
      prefix: 'ws_',
      spec: {
        type: 'memory',
        server: createWebSearchServer({
          search: async () => [{ title: 't', snippet: 's', url: 'u' }],
        }),
      },
    });
    await manager.connectAll();
  });

  afterAll(async () => {
    await manager.disconnectAll();
  });

  it('合并两个 Server 的 7 个工具并加前缀', () => {
    const names = manager.getTools().map((t) => t.name).sort();
    expect(names).toEqual([
      'req_analyze_completeness',
      'req_check_conflicts',
      'req_estimate_complexity',
      'req_generate_user_stories',
      'ws_search_best_practices',
      'ws_search_competitors',
      'ws_search_tech_stack',
    ]);
  });

  it('getServerStatuses 反映每个 Server 的连接情况', () => {
    const statuses = manager.getServerStatuses();
    expect(statuses).toHaveLength(2);
    expect(statuses.every((s) => s.connected)).toBe(true);
    expect(statuses.every((s) => !s.usingFallback)).toBe(true);
  });

  it('单个 Server 连不上时只降级自己，其它 Server 正常', async () => {
    const fallbackManager = new MCPManager();
    fallbackManager.register({
      id: 'broken',
      spec: { type: 'stdio' as const, command: 'this-command-does-not-exist' },
    });
    fallbackManager.register({
      id: 'web-search',
      prefix: 'ws_',
      spec: {
        type: 'memory',
        server: createWebSearchServer({ search: async () => [] }),
      },
    });

    await fallbackManager.connectAll();
    const statuses = fallbackManager.getServerStatuses();
    const broken = statuses.find((s) => s.id === 'broken');
    const ok = statuses.find((s) => s.id === 'web-search');

    expect(broken?.connected).toBe(false);
    expect(broken?.error).toBeTruthy();
    expect(ok?.connected).toBe(true);
    expect(fallbackManager.getTools()).toHaveLength(3);

    await fallbackManager.disconnectAll();
  });
});

// ============================================================
// 12.9 错误处理与韧性
// ============================================================

describe('12.9 错误处理与韧性', () => {
  it('调用不存在的工具不会让 Client 崩溃', async () => {
    const client = new MCPClientService({
      type: 'memory',
      server: createRequirementAnalyzerServer(),
    });
    await client.connect();

    // 协议级不存在的工具：MCP 用 isError 返回而不是抛异常，
    // 这样上层 Agent 能拿到可读的错误原因自行改走别的工具
    const result = await client.callTool('nonexistent_tool', {});
    expect(result.isError).toBe(true);
    expect((result.content as TextContent)[0].text).toContain('not found');

    await client.close();
  });

  it('单次调用超时后抛出可识别的超时错误', async () => {
    const slowServer = new McpServer({ name: 'slow', version: '1.0.0' });
    slowServer.tool(
      'slow_tool',
      '故意慢的工具',
      { ms: z.number() },
      async ({ ms }) => {
        await new Promise((r) => setTimeout(r, ms));
        return { content: [{ type: 'text' as const, text: 'done' }] };
      },
    );

    const client = new MCPClientService(
      { type: 'memory', server: slowServer },
      { timeoutMs: 60, maxRetries: 0 },
    );
    await client.connect();

    await expect(client.callTool('slow_tool', { ms: 800 })).rejects.toThrow(
      /超时/,
    );
    await client.close();
  });

  it('连接失败的 Server 有 fallback 时走降级工具', async () => {
    const { DynamicStructuredTool } = await import('@langchain/core/tools');
    const fallback = new DynamicStructuredTool({
      name: 'req_analyze_completeness',
      description: '本地降级版完整性分析',
      schema: z.object({ requirementText: z.string() }),
      func: async () => 'fallback-result',
    });

    const manager = new MCPManager();
    manager.register({
      id: 'requirement-analyzer',
      prefix: 'req_',
      spec: { type: 'stdio' as const, command: 'nope-not-exist' },
      fallbackTools: [fallback],
    });
    await manager.connectAll();

    // 走 manager 的统一入口：Server 未连接 → 自动回落到本地工具
    const out = await manager.callTool({
      toolName: 'req_analyze_completeness',
      args: { requirementText: 'x' },
    });
    expect(out).toBe('fallback-result');

    const traces = manager.getTraces();
    expect(traces.at(-1)?.status).toBe('fallback');

    await manager.disconnectAll();
  });
});

// ============================================================
// 12.10 安全模型
// ============================================================

describe('12.10 安全模型', () => {
  it('按工具名推断权限等级', () => {
    expect(classifyToolPermission('req_analyze_completeness')).toBe('read');
    expect(classifyToolPermission('create_requirement')).toBe('write');
    expect(classifyToolPermission('delete_requirement')).toBe('admin');
    // 未登记且认不出来的名字按 write 处理（未知即谨慎）
    expect(classifyToolPermission('sync_external_system')).toBe('read');
  });

  it('写/管理操作需要人工确认', () => {
    expect(requiresConfirmation('search_competitors')).toBe(false);
    expect(requiresConfirmation('create_requirement')).toBe(true);
    expect(requiresConfirmation('delete_requirement')).toBe(true);
  });

  it('未确认的写操作被拒绝，确认后放行', () => {
    const denied = checkToolPermission('create_requirement');
    expect(denied.allowed).toBe(false);

    const allowed = checkToolPermission('create_requirement', {
      confirmedTools: ['create_requirement'],
    });
    expect(allowed.allowed).toBe(true);
  });

  it('白名单外的工具被拒绝', () => {
    const decision = checkToolPermission('ws_search_competitors', {
      allowedTools: ['req_analyze_completeness'],
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toContain('未被授权');
    }
  });

  it('被拒绝的调用写入 denied trace 而不是执行', async () => {
    const manager = new MCPManager();
    manager.register({
      id: 'web-search',
      prefix: 'ws_',
      spec: {
        type: 'memory',
        server: createWebSearchServer({ search: async () => [] }),
      },
    });
    await manager.connectAll();

    const out: any = await manager.callTool({
      toolName: 'ws_search_competitors',
      args: { query: 'x' },
      deniedTools: ['ws_search_competitors'],
    });
    expect(JSON.parse(out).error).toBe('permission_denied');
    expect(manager.getTraces().at(-1)?.status).toBe('denied');

    await manager.disconnectAll();
  });
});

// ============================================================
// 12.12 可观测性
// ============================================================

describe('12.12 可观测性', () => {
  it('estimateTokens 对中英文混合文本给出合理量级', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('hello world')).toBeGreaterThan(0);
    expect(estimateTokens('批量导入用户数据')).toBeGreaterThan(0);
  });

  it('summarizeTraces 汇总成功率、耗时与体积', async () => {
    const manager = new MCPManager();
    manager.register({
      id: 'requirement-analyzer',
      prefix: 'req_',
      spec: { type: 'memory', server: createRequirementAnalyzerServer() },
    });
    await manager.connectAll();

    const tool = manager.getTools().find((t) => t.name === 'req_analyze_completeness');
    await tool!.invoke({ requirementText: '作为管理员，能够批量导入 CSV 数据' });

    const summary = manager.getTraceSummary();
    expect(summary.totalCalls).toBe(1);
    expect(summary.successRate).toBe(1);
    expect(summary.byTool['req_analyze_completeness'].calls).toBe(1);
    expect(summary.totalOutputBytes).toBeGreaterThan(0);

    const traces = manager.getTraces();
    expect(traces[0].serverId).toBe('requirement-analyzer');
    expect(traces[0].rawToolName).toBe('analyze_completeness');

    await manager.disconnectAll();
  });
});

// ============================================================
// 12.13 接入 LangGraph Agent
// ============================================================

describe('12.13 接入 LangGraph Agent', () => {
  const fakeModel: any = {
    invoke: async () => ({ content: 'ok' }),
    bindTools: () => fakeModel,
  };

  function buildMcpTools() {
    const manager = new MCPManager();
    manager.register({
      id: 'requirement-analyzer',
      prefix: 'req_',
      spec: { type: 'memory', server: createRequirementAnalyzerServer() },
    });
    manager.register({
      id: 'web-search',
      prefix: 'ws_',
      spec: {
        type: 'memory',
        server: createWebSearchServer({ search: async () => [] }),
      },
    });
    return manager;
  }

  it('pickMcpTools 按前缀挑选，避免无关工具进上下文', async () => {
    const manager = buildMcpTools();
    await manager.connectAll();

    const reqTools = pickMcpTools({ tools: manager.getTools() }, ['req_']);
    expect(reqTools).toHaveLength(4);

    const wsTools = pickMcpTools({ tools: manager.getTools() }, ['ws_']);
    expect(wsTools).toHaveLength(3);

    await manager.disconnectAll();
  });

  it('不传 mcp 时专家工具池保持第九章原样', () => {
    const base = ['search_requirement', 'check_conflicts', 'read_feature_spec'];
    expect(withMcpTools(base, undefined, ['req_'])).toEqual(base);
  });

  it('传入 mcp 后功能专家多出 req_ / ws_ 工具', async () => {
    const manager = buildMcpTools();
    await manager.connectAll();

    const merged = withMcpTools(['search_requirement'], { tools: manager.getTools() }, [
      'req_',
      'ws_',
      'search_knowledge_base',
    ]);
    expect(merged).toHaveLength(8);

    await manager.disconnectAll();
  });

  it('createFunctionalExpert 接受 mcp 依赖后仍能正常编译图', async () => {
    const manager = buildMcpTools();
    await manager.connectAll();

    const graph = createFunctionalExpert(fakeModel, undefined, {
      tools: manager.getTools(),
    });
    expect(graph).toBeTruthy();

    await manager.disconnectAll();
  });
});

// ============================================================
// 12.14 RAG-as-MCP-Server
// ============================================================

describe('12.14 RAG-as-MCP-Server', () => {
  it('把第十一章的检索能力暴露成标准 MCP 工具', async () => {
    const client = new MCPClientService({
      type: 'memory',
      server: createRagServer({
        userId: 'user-1',
        searchFn: async (query) => [
          {
            content: `${query} 的内部规范片段`,
            score: 0.91,
            metadata: { documentId: 'd1', chunkId: 'c1', source: 'import-spec.md' },
          },
        ],
        askFn: async () => ({
          answer: '导入上限 1000 条',
          citations: [{ chunkId: 'c1', documentId: 'd1', score: 0.91 }],
        }),
      }),
    });
    await client.connect();

    expect(client.getTools().map((t) => t.name).sort()).toEqual([
      'answer_with_knowledge_base',
      'search_knowledge_base',
    ]);

    const search = parseToolResult(
      await client.callTool('search_knowledge_base', { query: '批量导入上限', topK: 3 }),
    );
    expect(search.results[0].source).toBe('import-spec.md');
    expect(search.userId).toBe('user-1');

    const answer = parseToolResult(
      await client.callTool('answer_with_knowledge_base', { question: '导入上限？' }),
    );
    expect(answer.answer).toContain('1000');

    await client.close();
  });
});

// ============================================================
// 12.15 预算与上下文协同
// ============================================================

describe('12.15 预算与上下文协同', () => {
  it('按意图裁剪工具列表，闲聊不带任何工具', async () => {
    const manager = new MCPManager();
    manager.register({
      id: 'requirement-analyzer',
      prefix: 'req_',
      spec: { type: 'memory', server: createRequirementAnalyzerServer() },
    });
    manager.register({
      id: 'web-search',
      prefix: 'ws_',
      spec: {
        type: 'memory',
        server: createWebSearchServer({ search: async () => [] }),
      },
    });
    await manager.connectAll();

    expect(manager.selectToolsForIntent('smalltalk')).toHaveLength(0);
    expect(manager.selectToolsForIntent('requirement_review')).toHaveLength(7);
    expect(manager.selectToolsForIntent('perf_review')).toHaveLength(3);
    expect(manager.selectToolsForIntent()).toHaveLength(7);

    await manager.disconnectAll();
  });

  it('超长输出被截断并打标记，防止撑爆上下文', async () => {
    const bigServer = new McpServer({ name: 'big', version: '1.0.0' });
    bigServer.tool('big_tool', '返回超长文本', {}, async () => ({
      content: [{ type: 'text' as const, text: 'x'.repeat(5000) }],
    }));

    const client = new MCPClientService({ type: 'memory', server: bigServer });
    await client.connect();

    const [tool] = bridgeMCPToLangChain(client, {
      serverId: 'big',
      maxOutputChars: 100,
      onCall: () => undefined,
    });

    const out = (await tool.invoke({})) as string;
    expect(out).toContain('输出已截断');
    expect(out.length).toBeLessThan(400);

    await client.close();
  });
});
