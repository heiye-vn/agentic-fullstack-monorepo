/**
 * src/mcp/mcp-manager.ts
 *
 * 第十二章 12.8 — MCPManager：多 Server 统一编排
 *
 * 一个 Agent 同时连多个 Server 时，真正麻烦的不是"连上"，而是四件治理的事：
 * 1. 命名冲突：两个 Server 都叫 search → 前缀隔离
 * 2. 部分不可用：某个 Server 挂了不能拖垮整条链路 → 连接失败降级 + 调用期兜底
 * 3. 权限：Server 暴露了能力 ≠ 当前用户能调 → Host 层权限判定
 * 4. 可观测：多次调用要能串成一条链 → trace collector
 */
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { MCPClientService, type MCPTransportSpec } from './mcp-client.service.js';
import { bridgeMCPToLangChain, type BridgeCallInfo } from './mcp-to-langchain.js';
import {
  MCPTraceCollector,
  summarizeTraces,
  type MCPCallTrace,
  type TraceContext,
  type MCPTraceSummary,
} from './mcp-trace.js';
import {
  checkToolPermission,
  type PermissionContext,
} from './mcp-security.js';
import { QuotaTracker, ToolQuotaError } from '../security/tool-runtime.js';

export interface ServerRegistration {
  /** 逻辑 id，用于 trace 归因和按 id 取 client */
  id: string;
  spec: MCPTransportSpec;
  /** 工具名前缀，默认 `${id}_` */
  prefix?: string;
  /** 连接失败或调用失败时的本地降级工具 */
  fallbackTools?: DynamicStructuredTool[];
  /** 单次调用超时（ms） */
  timeoutMs?: number;
  maxRetries?: number;
  /** 输出截断阈值（字符） */
  maxOutputChars?: number;
}

export interface ServerStatus {
  id: string;
  connected: boolean;
  toolCount: number;
  toolNames: string[];
  usingFallback: boolean;
  error?: string;
}

export interface CallToolInput extends PermissionContext, TraceContext {
  toolName: string;
  args?: Record<string, unknown>;
}

export interface MCPManagerOptions {
  /**
   * 第十八章 18.6.1：工具调用配额护栏。
   *
   * 被注入的 Agent 可能陷入"反复调工具"的循环（Denial of Wallet：烧 token、
   * 打爆下游）。**不传 = 不启用**，保持既有行为不变；生产按会话维度注入一个
   * 共享的 QuotaTracker，超限时 callTool 直接返回 quota_exceeded 而不是真调。
   */
  quota?: QuotaTracker;
  /** 配额计数维度，默认 'conversation'（按会话），可改成 'user' */
  quotaScope?: 'conversation' | 'user';
}

export class MCPManager {
  private clients = new Map<string, MCPClientService>();
  private registrations: ServerRegistration[] = [];
  private tools: DynamicStructuredTool[] = [];
  private toolOwner = new Map<string, string>();
  private toolRawName = new Map<string, string>();
  private fallbackByName = new Map<string, DynamicStructuredTool>();
  private statuses = new Map<string, ServerStatus>();
  private readonly traces = new MCPTraceCollector();
  private readonly options: MCPManagerOptions;

  constructor(options: MCPManagerOptions = {}) {
    this.options = options;
  }

  /** 配额计数 key：按会话或按用户，两者都没有时退化为全局 */
  private quotaKeyFor(input: CallToolInput): string {
    return this.options.quotaScope === 'user'
      ? (input.userId ?? 'global')
      : (input.conversationId ?? input.userId ?? 'global');
  }

  register(registration: ServerRegistration): void {
    this.registrations.push(registration);
  }

  /** 并发连接所有 Server；单个失败只降级自己，不影响其它 Server */
  async connectAll(): Promise<ServerStatus[]> {
    const results = await Promise.allSettled(
      this.registrations.map((reg) => this.connectOne(reg)),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const reg = this.registrations[i];

      if (result.status === 'rejected') {
        const reason =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
        this.statuses.set(reg.id, {
          id: reg.id,
          connected: false,
          toolCount: 0,
          toolNames: [],
          usingFallback: (reg.fallbackTools?.length ?? 0) > 0,
          error: reason,
        });

        if (reg.fallbackTools?.length) {
          this.tools.push(...reg.fallbackTools);
          for (const t of reg.fallbackTools) {
            this.fallbackByName.set(t.name, t);
          }
        }
      }
    }

    return this.getServerStatuses();
  }

  private async connectOne(reg: ServerRegistration): Promise<void> {
    const client = new MCPClientService(reg.spec, {
      timeoutMs: reg.timeoutMs,
      maxRetries: reg.maxRetries,
      onToolsChanged: () => {
        // 工具列表热更新（listChanged）：换掉这个 Server 的旧工具实例，
        // Agent 后续调用自动使用新的 inputSchema
        this.tools = this.tools.filter(
          (t) => this.toolOwner.get(t.name) !== reg.id,
        );
        this.attachTools(client, reg);
      },
    });

    await client.connect();
    this.clients.set(reg.id, client);
    this.attachTools(client, reg);
  }

  /** 把一个 Server 的 MCP 工具桥接进来并登记归属关系 */
  private attachTools(client: MCPClientService, reg: ServerRegistration): void {
    const prefix = reg.prefix ?? `${reg.id}_`;
    const bridged = bridgeMCPToLangChain(client, {
      serverId: reg.id,
      prefix,
      timeoutMs: reg.timeoutMs,
      maxRetries: reg.maxRetries,
      maxOutputChars: reg.maxOutputChars,
      onCall: (info) => this.recordTrace(info),
    });

    this.tools.push(...bridged);
    for (const t of bridged) {
      this.toolOwner.set(t.name, reg.id);
      this.toolRawName.set(t.name, t.name.slice(prefix.length));
    }

    this.statuses.set(reg.id, {
      id: reg.id,
      connected: true,
      toolCount: bridged.length,
      toolNames: bridged.map((t) => t.name),
      usingFallback: false,
    });
  }

  private recordTrace(info: BridgeCallInfo, ctx?: TraceContext): void {
    this.traces.add({
      requestId: ctx?.requestId ?? 'unknown',
      conversationId: ctx?.conversationId,
      userId: ctx?.userId,
      serverId: info.serverId,
      toolName: info.toolName,
      rawToolName: info.rawToolName,
      inputSize: info.inputSize,
      outputSize: info.outputSize,
      estimatedOutputTokens: info.estimatedOutputTokens,
      startedAt: Date.now() - info.durationMs,
      endedAt: Date.now(),
      durationMs: info.durationMs,
      status: info.status,
      attempts: info.attempts,
      errorMessage: info.errorMessage,
    });
  }

  getTools(): DynamicStructuredTool[] {
    return this.tools;
  }

  getServerStatuses(): ServerStatus[] {
    return Array.from(this.statuses.values());
  }

  getClient(serverId: string): MCPClientService | undefined {
    return this.clients.get(serverId);
  }

  /**
   * 12.15 按意图裁剪工具列表
   *
   * 全部工具描述都进 system prompt 会让上下文膨胀（第十章的老问题）。
   * 这里按意图白名单裁剪：闲聊不带任何工具，需求评审只带相关前缀。
   */
  selectToolsForIntent(intent?: string): DynamicStructuredTool[] {
    if (!intent) return this.tools;

    const byPrefix = (...prefixes: string[]) =>
      this.tools.filter((t) => prefixes.some((p) => t.name.startsWith(p)));

    switch (intent) {
      case 'smalltalk':
      case 'chat':
        return [];
      case 'requirement_review':
        return byPrefix('req_', 'ws_', 'search_knowledge_base');
      case 'perf_review':
        return byPrefix('ws_');
      default:
        return this.tools;
    }
  }

  /**
   * 带权限 + trace 的统一调用入口（12.10 + 12.12）
   *
   * Server 未连接时自动回落到同名 fallback 工具，状态记为 'fallback'，
   * 这样 Agent 不会因为某个外部依赖挂掉就整轮失败。
   */
  async callTool(input: CallToolInput): Promise<unknown> {
    const { toolName, args = {} } = input;
    const startedAt = Date.now();
    const decision = checkToolPermission(toolName, {
      allowedTools: input.allowedTools,
      deniedTools: input.deniedTools,
      confirmedTools: input.confirmedTools,
    });

    if (!decision.allowed) {
      this.traces.add({
        requestId: input.requestId ?? 'unknown',
        conversationId: input.conversationId,
        userId: input.userId,
        serverId: this.toolOwner.get(toolName) ?? 'unknown',
        toolName,
        rawToolName: toolName,
        inputSize: JSON.stringify(args).length,
        outputSize: 0,
        estimatedOutputTokens: 0,
        startedAt,
        endedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        status: 'denied',
        attempts: 0,
        errorMessage: decision.reason,
      });
      return JSON.stringify({ error: 'permission_denied', message: decision.reason });
    }

    // 第十八章 18.6.1：配额护栏（未注入 quota 时整段跳过，行为与改造前一致）
    const quota = this.options.quota;
    if (quota) {
      const quotaKey = this.quotaKeyFor(input);
      if (!quota.tryConsume(quotaKey)) {
        const message = new ToolQuotaError(
          `本轮工具调用已超配额（key=${quotaKey}，上限 ${quota.limit}）`,
        ).message;
        this.traces.add({
          requestId: input.requestId ?? 'unknown',
          conversationId: input.conversationId,
          userId: input.userId,
          serverId: this.toolOwner.get(toolName) ?? 'unknown',
          toolName,
          rawToolName: toolName,
          inputSize: JSON.stringify(args).length,
          outputSize: 0,
          estimatedOutputTokens: 0,
          startedAt,
          endedAt: Date.now(),
          durationMs: Date.now() - startedAt,
          status: 'denied',
          attempts: 0,
          errorMessage: message,
        });
        return JSON.stringify({ error: 'quota_exceeded', message });
      }
    }

    const serverId = this.toolOwner.get(toolName);
    const fallback = this.fallbackByName.get(toolName);

    if (!serverId) {
      if (fallback) {
        const out = await fallback.invoke(args);
        this.traces.add(this.buildTrace(input, toolName, 'unknown', out, startedAt, 'fallback', 0));
        return out;
      }
      return JSON.stringify({
        error: 'tool_not_found',
        message: `未注册的工具：${toolName}`,
      });
    }

    const client = this.clients.get(serverId);
    if (!client || !client.isConnected()) {
      if (fallback) {
        const out = await fallback.invoke(args);
        this.traces.add(this.buildTrace(input, toolName, serverId, out, startedAt, 'fallback', 0));
        return out;
      }
    }

    const rawToolName = this.toolRawName.get(toolName) ?? toolName;

    try {
      const result = await client!.callTool(rawToolName, args);
      const text = (result.content ?? [])
        .map((c: any) => (c?.type === 'text' ? c.text : JSON.stringify(c)))
        .join('\n');
      this.traces.add(
        this.buildTrace(input, toolName, serverId, text, startedAt, 'success', 1),
      );
      return text;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (fallback) {
        const out = await fallback.invoke(args);
        this.traces.add(this.buildTrace(input, toolName, serverId, out, startedAt, 'fallback', 1, message));
        return out;
      }
      this.traces.add(
        this.buildTrace(
          input,
          toolName,
          serverId,
          '',
          startedAt,
          message.includes('超时') ? 'timeout' : 'error',
          1,
          message,
        ),
      );
      return JSON.stringify({ error: 'mcp_call_failed', message });
    }
  }

  private buildTrace(
    input: CallToolInput,
    toolName: string,
    serverId: string,
    output: string,
    startedAt: number,
    status: MCPCallTrace['status'],
    attempts: number,
    errorMessage?: string,
  ): MCPCallTrace {
    const text = typeof output === 'string' ? output : JSON.stringify(output);
    return {
      requestId: input.requestId ?? 'unknown',
      conversationId: input.conversationId,
      userId: input.userId,
      serverId,
      toolName,
      rawToolName: toolName,
      inputSize: JSON.stringify(input.args ?? {}).length,
      outputSize: text.length,
      estimatedOutputTokens: Math.ceil(text.length / 3),
      startedAt,
      endedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      status,
      attempts,
      errorMessage,
    };
  }

  getTraces(): MCPCallTrace[] {
    return this.traces.list();
  }

  getTraceSummary(): MCPTraceSummary {
    return summarizeTraces(this.traces.list());
  }

  async disconnectAll(): Promise<void> {
    const clients = Array.from(this.clients.values());
    await Promise.allSettled(clients.map((c) => c.close()));
    this.clients.clear();
    this.tools = [];
    this.toolOwner.clear();
    this.toolRawName.clear();
    this.statuses.clear();
  }
}
