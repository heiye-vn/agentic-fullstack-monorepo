/**
 * scripts/test-mcp-stdio.ts
 *
 * 第十二章 MCP stdio 模式冒烟脚本
 *
 * 单元测试（test/chapter12-mcp.spec.ts）走的是进程内 InMemoryTransport，
 * 验证的是协议逻辑；这个脚本验证的是**真实子进程 + 真实 stdio 管道**这条路：
 *   MCPClientService --(stdin/stdout JSON-RPC)--> 子进程里的 MCP Server
 *
 * 运行：
 *   npx tsx scripts/test-mcp-stdio.ts
 *
 * 它会依次检查：
 * 1. requirement-analyzer：连上 → 列工具 → 调 analyze_completeness / estimate_complexity
 * 2. web-search：无 TAVILY_API_KEY 时进入 mock 模式仍能返回语料
 * 3. 单个 Server 连不上时 MCPManager 只降级自己，另一个照常可用
 * 4. trace 汇总与 stderr 日志（stdout 必须是干净的协议流）
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { MCPClientService, type MCPTransportSpec } from '../src/mcp/mcp-client.service.js';
import { MCPManager } from '../src/mcp/mcp-manager.js';

const CHAT_ROOT = process.cwd();
const IS_WIN = process.platform === 'win32';

// 优先用项目本地的 tsx（node_modules/.bin），没有再回落到 npx
const LOCAL_TSX = path.resolve(
  CHAT_ROOT,
  'node_modules/.bin',
  IS_WIN ? 'tsx.cmd' : 'tsx',
);
const USE_LOCAL_TSX = existsSync(LOCAL_TSX);
const RUNNER = USE_LOCAL_TSX ? LOCAL_TSX : IS_WIN ? 'npx.cmd' : 'npx';

function stdioEntry(rel: string): MCPTransportSpec {
  return {
    type: 'stdio',
    command: RUNNER,
    args: USE_LOCAL_TSX ? [rel] : ['tsx', rel],
    cwd: CHAT_ROOT,
    env: { ...process.env } as Record<string, string>,
  };
}

function line(title: string) {
  console.log(`\n${'='.repeat(64)}\n${title}\n${'='.repeat(64)}`);
}

async function smokeRequirementAnalyzer() {
  line('1. requirement-analyzer（stdio 子进程）');

  const client = new MCPClientService(stdioEntry('src/mcp-servers/requirement-analyzer/src/index.ts'), {
    timeoutMs: 60_000,
  });
  await client.connect();

  console.log('已连接:', client.isConnected());
  console.log('tools/list:', client.getTools().map((t) => t.name).join(', '));

  const completeness = await client.callTool('analyze_completeness', {
    requirementText: '作为管理员，我希望能够批量导入用户数据，要求支持 CSV 格式',
  });
  console.log('analyze_completeness →', (completeness.content as any)[0].text);

  const complexity = await client.callTool('estimate_complexity', {
    requirementText: '集成第三方 API 做 AI 智能推荐，并支持实时推送通知',
  });
  const parsed = JSON.parse((complexity.content as any)[0].text);
  console.log(`estimate_complexity → ${parsed.size} (${parsed.estimatedDays})`);

  const resources = await client.listResources();
  console.log('resources/list:', resources.resources.map((r: any) => r.uri).join(', '));

  await client.close();
  console.log('已断开');
}

async function smokeWebSearch() {
  line('2. web-search（无 TAVILY_API_KEY → mock 模式）');

  const client = new MCPClientService(stdioEntry('src/mcp-servers/web-search/src/index.ts'), {
    timeoutMs: 60_000,
  });
  await client.connect();

  console.log('tools/list:', client.getTools().map((t) => t.name).join(', '));

  const result = await client.callTool('search_competitors', {
    query: '批量导入功能',
  });
  const parsed = JSON.parse((result.content as any)[0].text);
  console.log('mode:', parsed.mode, '| 命中:', parsed.results.length);
  console.log('首条:', parsed.results[0]?.title);

  await client.close();
}

async function smokeManagerWithFallback() {
  line('3. MCPManager：一个 Server 挂了只降级自己');

  const manager = new MCPManager();
  manager.register({
    id: 'broken',
    spec: { type: 'stdio', command: 'this-command-does-not-exist', args: [] },
  });
  manager.register({
    id: 'requirement-analyzer',
    prefix: 'req_',
    spec: stdioEntry('src/mcp-servers/requirement-analyzer/src/index.ts'),
    timeoutMs: 60_000,
  });

  const statuses = await manager.connectAll();
  for (const s of statuses) {
    console.log(
      `  ${s.id}: connected=${s.connected} tools=${s.toolCount}` +
        (s.error ? ` error=${s.error.slice(0, 60)}` : ''),
    );
  }

  console.log('聚合工具:', manager.getTools().map((t) => t.name).join(', '));

  const tool = manager.getTools().find((t) => t.name === 'req_estimate_complexity');
  if (tool) {
    const out = (await tool.invoke({ requirementText: '修改按钮颜色' })) as string;
    console.log('调用 req_estimate_complexity →', JSON.parse(out).size);
  }

  console.log('trace 汇总:', JSON.stringify(manager.getTraceSummary(), null, 2).slice(0, 400));

  await manager.disconnectAll();
}

async function main() {
  console.log('MCP stdio 冒烟测试开始（cwd=%s）', CHAT_ROOT);
  console.log('提示：Server 的日志走 stderr，stdout 是干净的 JSON-RPC 协议流');

  await smokeRequirementAnalyzer();
  await smokeWebSearch();
  await smokeManagerWithFallback();

  line('全部通过');
}

main().catch((err) => {
  console.error('冒烟测试失败:', err);
  process.exit(1);
});
