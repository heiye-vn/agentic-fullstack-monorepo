/**
 * src/mcp/index.ts — 第十二章 MCP 模块出口
 */
export {
  MCPClientService,
  type MCPTransportSpec,
  type MCPClientOptions,
  type CallToolOptions,
} from './mcp-client.service.js';
export {
  bridgeMCPToLangChain,
  jsonSchemaToZod,
  serializeMCPContent,
  type BridgeOptions,
  type BridgeCallInfo,
  type MCPContentItem,
} from './mcp-to-langchain.js';
export {
  MCPManager,
  type ServerRegistration,
  type ServerStatus,
  type CallToolInput,
} from './mcp-manager.js';
export {
  MCPTraceCollector,
  estimateTokens,
  summarizeTraces,
  type MCPCallTrace,
  type MCPCallStatus,
  type MCPTraceSummary,
  type TraceContext,
} from './mcp-trace.js';
export {
  classifyToolPermission,
  checkToolPermission,
  requiresConfirmation,
  DEFAULT_TOOL_PERMISSIONS,
  type ToolPermissionLevel,
  type PermissionContext,
  type PermissionDecision,
} from './mcp-security.js';
export {
  createMcpManager,
  REQ_SERVER_ID,
  WS_SERVER_ID,
  REQ_TOOL_PREFIX,
  WS_TOOL_PREFIX,
  type McpRuntimeOptions,
} from './mcp-runtime.js';
