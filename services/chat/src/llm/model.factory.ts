import { ChatOpenAI } from '@langchain/openai';
import {
  loadLangChainConfig,
  getApiKeys,
} from '../config/load-langchain-config.js';
import { getLlmTracer } from '../observability/index.js';

/**
 * 统一模型工厂
 * - 模型参数从 YAML 配置读取
 * - 密钥和 baseURL 从 process.env 读取（通过 getApiKeys()）
 * - 禁止在业务层直接 new ChatOpenAI，一律通过此函数创建
 */
export function createChatModel(
  overrides?: Partial<{
    modelName: string;
    temperature: number;
    maxTokens: number;
    streaming: boolean;
    /** 关闭 Qwen3 深度思考模式，避免与 tool_choice: required 冲突 */
    disableThinking: boolean;
    /** 覆盖 API Key（优先使用，为空则回退到 process.env） */
    apiKey: string;
    /** 覆盖 Base URL（优先使用，为空则回退到 process.env） */
    baseUrl: string;
  }>,
): ChatOpenAI {
  const config = loadLangChainConfig();
  const keys = getApiKeys();

  const apiKey = overrides?.apiKey?.trim() || keys.openaiApiKey;
  const baseURL = overrides?.baseUrl?.trim() || keys.openaiBaseUrl;

  return new ChatOpenAI({
    model: overrides?.modelName ?? config.llm.modelName,
    temperature: overrides?.temperature ?? config.llm.temperature,
    maxTokens: overrides?.maxTokens ?? config.llm.maxTokens,
    timeout: config.llm.timeoutMs,
    streaming: overrides?.streaming ?? config.features.streaming,
    apiKey,
    configuration: {
      baseURL,
    },
    // Qwen3 系列在 Thinking Mode 下不支持 tool_choice: required，
    // 需要通过 DashScope 扩展参数显式关闭（直接展开到请求 body）
    ...(overrides?.disableThinking && {
      modelKwargs: { enable_thinking: false },
    }),
    // 第十六章：把 LLM 观测回调挂在模型实例上。
    // LangChain 在每次调用时执行 CallbackManager.configure(config.callbacks, this.callbacks, ...)，
    // 构造期传入的 callbacks 会与调用期的合并，因此图节点、并行专家子图、
    // Critic-Refine 循环、ReAct 工具轮次里的每一次真实模型调用都会被覆盖，
    // 无需在十几处调用点各包一层。节点名由 LangGraph 注入的 metadata.langgraph_node 提供。
    callbacks: [getLlmTracer()],
  });
}

