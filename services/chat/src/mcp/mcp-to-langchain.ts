/**
 * src/mcp/mcp-to-langchain.ts
 *
 * 第十二章 12.5 — MCP Tool → LangChain Tool 桥接器
 *
 * 这是"MCP 能不能进入现有 Agent 生态"的关键适配点，两处转换：
 * 1. JSON Schema → Zod：MCP 用 JSON Schema 描述入参，LangChain 用 Zod
 * 2. MCP content[] → string：MCP 返回结构化内容数组，LangChain 工具只吃字符串
 *
 * 另外在这里统一做两件生产必需的事：
 * - 输出体积截断（12.15：工具结果会进上下文，任由它膨胀会拖垮后续推理）
 * - 调用结果回传埋点（12.12：trace 在这一层采集最省事，不用每个工具各写一遍）
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z, type ZodObject, type ZodRawShape, type ZodTypeAny } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { MCPClientService } from './mcp-client.service.js';
import { estimateTokens, type MCPCallStatus } from './mcp-trace.js';

export interface MCPContentItem {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface BridgeCallInfo {
  serverId: string;
  toolName: string;
  rawToolName: string;
  input: Record<string, unknown>;
  output: string;
  inputSize: number;
  outputSize: number;
  estimatedOutputTokens: number;
  durationMs: number;
  status: MCPCallStatus;
  attempts: number;
  errorMessage?: string;
  truncated: boolean;
}

export interface BridgeOptions {
  /** 所属 Server 的注册 id，用于 trace 归因 */
  serverId: string;
  /** 工具名前缀，解决多 Server 重名问题，如 req_ / ws_ */
  prefix?: string;
  /** 单次调用超时，透传给 MCPClientService */
  timeoutMs?: number;
  maxRetries?: number;
  /** 输出截断阈值（字符），默认 20000 */
  maxOutputChars?: number;
  /** 每次调用结束后的回调，通常接 trace collector */
  onCall?: (info: BridgeCallInfo) => void;
}

// ============================================================================
// JSON Schema → Zod
// ============================================================================

interface JsonSchemaProperty {
  type?: string | string[];
  description?: string;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  enum?: unknown[];
}

export interface JsonSchemaObject {
  type?: 'object' | string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

function normalizeType(prop: JsonSchemaProperty): string {
  const raw = prop.type;
  if (Array.isArray(raw)) {
    // 形如 ["string","null"]：取第一个非 null 的类型
    return raw.find((t) => t !== 'null') ?? 'string';
  }
  return raw ?? 'string';
}

export function jsonSchemaToZod(schema: JsonSchemaObject): ZodObject<ZodRawShape> {
  const shape: Record<string, ZodTypeAny> = {};
  const required = new Set(schema.required ?? []);

  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    let zodType: ZodTypeAny = propertyToZod(prop);
    if (!required.has(key)) {
      zodType = zodType.optional();
    }
    if (prop.description) {
      zodType = zodType.describe(prop.description);
    }
    shape[key] = zodType;
  }

  return z.object(shape as ZodRawShape);
}

function propertyToZod(prop: JsonSchemaProperty): ZodTypeAny {
  if (Array.isArray(prop.enum) && prop.enum.length > 0) {
    const values = prop.enum.filter((v): v is string => typeof v === 'string');
    if (values.length === prop.enum.length) {
      return z.enum(values as [string, ...string[]]);
    }
    return z.union(values.map((v) => z.literal(v as string | number | boolean)) as any);
  }

  switch (normalizeType(prop)) {
    case 'string':
      return z.string();
    case 'number':
    case 'integer':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'array':
      return z.array(prop.items ? propertyToZod(prop.items) : z.unknown());
    case 'object':
      return prop.properties
        ? jsonSchemaToZod(prop as JsonSchemaObject)
        : z.record(z.string(), z.unknown());
    case 'null':
      return z.null();
    default:
      return z.unknown();
  }
}

// ============================================================================
// MCP content[] → string
// ============================================================================

export function serializeMCPContent(content: MCPContentItem[]): string {
  return (content ?? [])
    .map((c) => {
      if (c.type === 'text') return c.text ?? '';
      if (c.type === 'image') return `[image: ${c.mimeType ?? 'unknown'}]`;
      if (c.type === 'resource') return c.text ?? '[resource]';
      return JSON.stringify(c);
    })
    .join('\n');
}

// ============================================================================
// 桥接
// ============================================================================

export function bridgeMCPToLangChain(
  client: MCPClientService,
  options: BridgeOptions,
): DynamicStructuredTool[] {
  const prefix = options.prefix ?? '';
  return client
    .getTools()
    .map((tool) => mcpToolToLangChain(tool, client, options, prefix));
}

function mcpToolToLangChain(
  tool: { name: string; description?: string; inputSchema: unknown },
  client: MCPClientService,
  options: BridgeOptions,
  prefix: string,
): DynamicStructuredTool {
  const rawToolName = tool.name;
  const toolName = `${prefix}${rawToolName}`;
  const zodSchema = jsonSchemaToZod(tool.inputSchema as JsonSchemaObject);
  const maxOutputChars = options.maxOutputChars ?? 20_000;

  return new DynamicStructuredTool({
    name: toolName,
    description: tool.description || rawToolName,
    schema: zodSchema,
    metadata: { mcpServer: options.serverId, mcpRawToolName: rawToolName },
    func: async (args: Record<string, unknown>) => {
      const startedAt = Date.now();
      const inputSize = JSON.stringify(args ?? {}).length;
      let attempts = 0;

      try {
        const result = (await client.callTool(rawToolName, args ?? {}, {
          timeoutMs: options.timeoutMs,
          maxRetries: options.maxRetries,
        })) as CallToolResult;
        attempts = 1;

        const serialized = serializeMCPContent(
          (result.content ?? []) as MCPContentItem[],
        );
        const truncated = serialized.length > maxOutputChars;
        const output = truncated
          ? `${serialized.slice(0, maxOutputChars)}\n\n[输出已截断，原始长度 ${serialized.length} 字符]`
          : serialized;

        const isToolError = result.isError === true;
        const finalOutput = isToolError
          ? JSON.stringify({ error: 'tool_error', message: output })
          : output;

        options.onCall?.({
          serverId: options.serverId,
          toolName,
          rawToolName,
          input: args ?? {},
          output: finalOutput,
          inputSize,
          outputSize: finalOutput.length,
          estimatedOutputTokens: estimateTokens(finalOutput),
          durationMs: Date.now() - startedAt,
          status: isToolError ? 'error' : 'success',
          attempts,
          errorMessage: isToolError ? output.slice(0, 500) : undefined,
          truncated,
        });

        return finalOutput;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const output = JSON.stringify({
          error: 'mcp_call_failed',
          message,
          tool: rawToolName,
        });

        options.onCall?.({
          serverId: options.serverId,
          toolName,
          rawToolName,
          input: args ?? {},
          output,
          inputSize,
          outputSize: output.length,
          estimatedOutputTokens: estimateTokens(output),
          durationMs: Date.now() - startedAt,
          status: message.includes('超时') ? 'timeout' : 'error',
          attempts: attempts || 1,
          errorMessage: message,
          truncated: false,
        });

        // 返回错误串而不是抛异常：让 Agent 看到失败原因并自行改用别的工具
        return output;
      }
    },
  });
}
