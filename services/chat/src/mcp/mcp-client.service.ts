/**
 * src/mcp/mcp-client.service.ts
 *
 * 第十二章 12.5 / 12.6 / 12.9 — 单个 MCP Server 的连接与调用封装
 *
 * 相比参考项目只有 stdio 一种连法，这里做了传输层抽象：
 * - stdio：本地子进程，零端口，适合本机工具与桌面应用
 * - http：Streamable HTTP，可远程部署、独立扩缩容
 * - memory：进程内 InMemoryTransport，零进程零网络 —— 集成测试直连真实 Server 就靠它
 *
 * 生命周期：connect → (initialize 能力协商) → listTools → callTool → close
 * 韧性：单次调用超时 + 断线自动重连 + 工具列表变更通知
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  Tool,
  CallToolResult,
  ResourceContents,
} from '@modelcontextprotocol/sdk/types.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

export type MCPTransportSpec =
  | {
      type: 'stdio';
      /** 可执行文件，如 process.execPath 或 'npx' */
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
    }
  | { type: 'http'; url: string; headers?: Record<string, string> }
  | { type: 'memory'; server: McpServer };

export interface MCPClientOptions {
  clientName?: string;
  clientVersion?: string;
  /** 单次 callTool 超时（ms），默认 30s */
  timeoutMs?: number;
  /** 失败后最多重试次数（每次重试前会尝试重连），默认 1 */
  maxRetries?: number;
  /** 工具列表变更时的回调（12.6 listChanged） */
  onToolsChanged?: (tools: Tool[]) => void;
}

export interface CallToolOptions {
  timeoutMs?: number;
  maxRetries?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  if (!ms || ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} 超时（${ms}ms）`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export class MCPClientService {
  private client: Client;
  private transport: Transport | null = null;
  private connected = false;
  private tools: Tool[] = [];
  private connecting: Promise<void> | null = null;

  constructor(
    private readonly spec: MCPTransportSpec,
    private readonly options: MCPClientOptions = {},
  ) {
    this.client = new Client(
      {
        name: options.clientName ?? 'autix-chat-client',
        version: options.clientVersion ?? '1.0.0',
      },
      { capabilities: {} },
    );
  }

  /** 建立传输 → initialize 能力协商 → 拉取工具列表 */
  async connect(): Promise<void> {
    if (this.connected) return;
    // 并发 connect 共用同一个 Promise，避免同一个 Server 被连两次
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      this.transport = await this.createTransport();
      await this.client.connect(this.transport);
      this.connected = true;

      this.client.setNotificationHandler(
        ToolListChangedNotificationSchema,
        async () => {
          await this.refreshTools();
          this.options.onToolsChanged?.(this.tools);
        },
      );

      this.client.onclose = () => {
        // 子进程崩溃 / HTTP 断连时把状态打回去，下次 callTool 会先重连
        this.connected = false;
        this.transport = null;
      };

      await this.refreshTools();
    })();

    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async createTransport(): Promise<Transport> {
    if (this.spec.type === 'stdio') {
      return new StdioClientTransport({
        command: this.spec.command,
        args: this.spec.args ?? [],
        env: {
          ...(process.env as Record<string, string>),
          ...this.spec.env,
        },
        cwd: this.spec.cwd,
        // Server 的 stderr 不该污染 Client 日志，但要能看到崩溃原因
        stderr: 'pipe',
      });
    }

    if (this.spec.type === 'memory') {
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await this.spec.server.connect(serverTransport);
      return clientTransport;
    }

    const { StreamableHTTPClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/streamableHttp.js'
    );
    return new StreamableHTTPClientTransport(new URL(this.spec.url), {
      requestInit: this.spec.headers
        ? { headers: this.spec.headers }
        : undefined,
    });
  }

  /** 重新拉取工具列表（Server 声明 listChanged 后由通知触发） */
  async refreshTools(): Promise<Tool[]> {
    const { tools } = await this.client.listTools();
    this.tools = tools;
    return this.tools;
  }

  getTools(): Tool[] {
    return this.tools;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * 调用工具，带超时 + 断线重连重试（12.9）
   *
   * 注意：重连后工具列表会重新拉取，所以调用方拿到的工具实例不需要变，
   * 只要按名字调用即可 —— 这也是 MCP 相比硬编码 Tool 的一个好处。
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    opts: CallToolOptions = {},
  ): Promise<CallToolResult> {
    const timeoutMs = opts.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = opts.maxRetries ?? this.options.maxRetries ?? 1;

    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (!this.connected) {
          await this.connect();
        }
        // SDK 的 callTool 返回类型包含结构化内容分支，这里统一按 content[] 处理
        return (await withTimeout(
          this.client.callTool({ name, arguments: args }) as Promise<CallToolResult>,
          timeoutMs,
          `callTool(${name})`,
        )) as CallToolResult;
      } catch (err) {
        lastError = err;
        const isTimeout = err instanceof Error && err.message.includes('超时');
        if (isTimeout || !this.connected) {
          // 连接已断或超时：尝试一次重连再重试
          await this.safeReconnect();
          continue;
        }
        // 业务级错误（Server 返回 isError）不重试
        throw err;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError ?? `callTool(${name}) 失败`));
  }

  private async safeReconnect(): Promise<void> {
    try {
      await this.close();
      await this.connect();
    } catch {
      // 重连失败保留原样，由上层 fallback 兜底
      this.connected = false;
    }
  }

  /** Resource 原语：列出可读资源 */
  async listResources() {
    if (!this.connected) await this.connect();
    return this.client.listResources();
  }

  /** Resource 原语：读取指定资源内容 */
  async readResource(uri: string): Promise<ResourceContents[]> {
    if (!this.connected) await this.connect();
    const result = await this.client.readResource({ uri });
    return result.contents as ResourceContents[];
  }

  /** Prompt 原语：列出可用提示词模板 */
  async listPrompts() {
    if (!this.connected) await this.connect();
    return this.client.listPrompts();
  }

  /** Prompt 原语：按名字 + 参数渲染提示词 */
  async getPrompt(name: string, args: Record<string, string> = {}) {
    if (!this.connected) await this.connect();
    return this.client.getPrompt({ name, arguments: args });
  }

  async close(): Promise<void> {
    this.connected = false;
    if (this.transport) {
      try {
        await this.client.close();
      } catch {
        // 关闭失败无需冒泡，进程退出时资源会一起回收
      }
      this.transport = null;
    }
    this.tools = [];
  }
}
