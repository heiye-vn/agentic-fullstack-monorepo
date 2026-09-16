import { ChatOpenAI } from '@langchain/openai';
import {
  loadLangChainConfig,
  getApiKeys,
} from '../config/load-langchain-config.js';

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
  }>,
): ChatOpenAI {
  const config = loadLangChainConfig();
  const keys = getApiKeys();

  return new ChatOpenAI({
    model: overrides?.modelName ?? config.llm.modelName,
    temperature: overrides?.temperature ?? config.llm.temperature,
    maxTokens: overrides?.maxTokens ?? config.llm.maxTokens,
    timeout: config.llm.timeoutMs,
    streaming: overrides?.streaming ?? config.features.streaming,
    apiKey: keys.openaiApiKey,
    configuration: {
      baseURL: keys.openaiBaseUrl,
    },
    // Qwen3 系列在 Thinking Mode 下不支持 tool_choice: required，
    // 需要通过 DashScope 扩展参数显式关闭（直接展开到请求 body）
    ...(overrides?.disableThinking && {
      modelKwargs: { enable_thinking: false },
    }),
  });
}

