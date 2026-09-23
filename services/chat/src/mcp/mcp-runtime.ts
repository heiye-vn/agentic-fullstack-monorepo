/**
 * src/mcp/mcp-runtime.ts
 *
 * 第十二章 12.13 — 把 MCP 能力装配成 Agent 可直接使用的工具列表
 *
 * 默认走 **进程内 InMemoryTransport**：两个内置 Server 都是纯计算逻辑，
 * 没必要为它们 fork 子进程、也没有外部依赖要隔离。
 * 需要真实进程隔离（或把 Server 独立部署出去）时，用环境变量切到 stdio：
 *   MCP_TRANSPORT=stdio
 *   MCP_STDIO_COMMAND=node
 *   MCP_STDIO_ARGS=dist/mcp-servers/requirement-analyzer/src/index.js
 *
 * 任何一个 Server 连不上都不会让整个装配失败 —— connectAll 内部按 Server 降级。
 */
import { MCPManager, type ServerRegistration } from './mcp-manager.js';
import { createRequirementAnalyzerServer } from '../mcp-servers/requirement-analyzer/src/server.js';
import { createWebSearchServer } from '../mcp-servers/web-search/src/server.js';

export const REQ_SERVER_ID = 'requirement-analyzer';
export const WS_SERVER_ID = 'web-search';

/** 两个内置 Server 的工具名前缀，供 experts.ts 按前缀挑选 */
export const REQ_TOOL_PREFIX = 'req_';
export const WS_TOOL_PREFIX = 'ws_';

export interface McpRuntimeOptions {
  /**
   * 显式开关；不给则读 MCP_ENABLED。
   *
   * 第二十章 20.4：**默认改为开启**（原为 false）。理由：默认走 InMemoryTransport，
   * 两个内置 Server 都是进程内纯计算，无网络、无子进程、不花 token；
   * 且 connectAll 失败只会让 createMcpManager 返回 null，主链路自动降级。
   * 想回到第十二章「未接 MCP」的行为：MCP_ENABLED=false。
   */
  enabled?: boolean;
  /** 传输方式：memory（默认）| stdio */
  transport?: 'memory' | 'stdio';
  timeoutMs?: number;
  maxRetries?: number;
  maxOutputChars?: number;
}

function envFlag(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function buildRequirementsRegistration(
  opts: McpRuntimeOptions,
): ServerRegistration {
  const transport = opts.transport ?? (envFlag('MCP_STDIO') ? 'stdio' : 'memory');

  return {
    id: REQ_SERVER_ID,
    prefix: REQ_TOOL_PREFIX,
    timeoutMs: opts.timeoutMs,
    maxRetries: opts.maxRetries,
    maxOutputChars: opts.maxOutputChars,
    spec:
      transport === 'stdio'
        ? {
            type: 'stdio',
            command: process.env.MCP_STDIO_COMMAND ?? process.execPath,
            args:
              process.env.MCP_STDIO_ARGS?.split(' ').filter(Boolean) ??
              [
                'dist/mcp-servers/requirement-analyzer/src/index.js',
              ],
          }
        : { type: 'memory', server: createRequirementAnalyzerServer() },
  };
}

function buildWebSearchRegistration(
  opts: McpRuntimeOptions,
): ServerRegistration {
  const transport = opts.transport ?? (envFlag('MCP_STDIO') ? 'stdio' : 'memory');

  return {
    id: WS_SERVER_ID,
    prefix: WS_TOOL_PREFIX,
    timeoutMs: opts.timeoutMs,
    maxRetries: opts.maxRetries,
    maxOutputChars: opts.maxOutputChars,
    spec:
      transport === 'stdio'
        ? {
            type: 'stdio',
            command: process.env.MCP_STDIO_COMMAND ?? process.execPath,
            args:
              process.env.MCP_STDIO_ARGS?.split(' ').filter(Boolean) ??
              ['dist/mcp-servers/web-search/src/index.js'],
          }
        : { type: 'memory', server: createWebSearchServer() },
  };
}

let sharedInit: Promise<MCPManager | null> | null = null;

/**
 * 进程级共享的 MCPManager
 *
 * 第二十章 20.4 的接线点是这里，不要照搬 autix 的 `mcp-bootstrap.ts`：
 *   1. 本项目这里早已经是**进程级幂等单例**（sharedInit 缓存的是 Promise），
 *      autix 那边是从来没接进生产，才需要新建 bootstrap 文件；
 *   2. autix 用 `prefix: ''` 保持原始工具名，是为了过第十八章的白名单。
 *      本项目反而是**按前缀挑选**：experts.ts 的 withMcpTools 认的是 `req_` / `ws_`，
 *      skill 的 allowed-tools 也照这两个前缀声明。改成空前缀会让整套挑选逻辑静默失效。
 *   3. 本默认 InMemoryTransport，无需 fork 子进程，启动期预热几乎零成本。
 *
 * 未启用 MCP 时返回 null，调用方按 null 走第九章原有行为。
 */
export function getSharedMcpManager(
  opts: McpRuntimeOptions = {},
): Promise<MCPManager | null> {
  if (!sharedInit) {
    sharedInit = createMcpManager(opts);
  }
  return sharedInit;
}

/** 仅供测试使用：清掉共享实例，避免用例之间互相污染 */
export function resetSharedMcpManager(): void {
  sharedInit = null;
}

/**
 * 装配并连接 MCPManager
 *
 * @returns 已连接的 manager；未启用或启用失败时返回 null，调用方按 null 走第九章原有行为
 */
export async function createMcpManager(
  opts: McpRuntimeOptions = {},
): Promise<MCPManager | null> {
  const enabled = opts.enabled ?? envFlag('MCP_ENABLED', true);
  if (!enabled) return null;

  const manager = new MCPManager();
  manager.register(buildRequirementsRegistration(opts));
  manager.register(buildWebSearchRegistration(opts));

  try {
    await manager.connectAll();
    return manager;
  } catch (err) {
    // 装配失败不应该让对话主链路挂掉：MCP 是增强项，不是必需品
    console.error(
      `[mcp] MCPManager 装配失败，本次请求不使用 MCP 工具：${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}
