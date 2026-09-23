import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import * as yaml from 'js-yaml';

// ============================================================
// LangChain 配置类型定义
// ============================================================

export interface LlmConfig {
  modelName: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}

export interface RetrievalConfig {
  topK: number;
  scoreThreshold: number;
  embeddingModel: string;
  /**
   * 检索模式：simple = 纯向量；hybrid = 向量 + BM25 多召回再重排（第二十章 20.2，默认 hybrid）。
   */
  mode?: 'simple' | 'hybrid';
  /**
   * 检索整体超时（毫秒）。
   *
   * 20.2 的承诺是"检索失败不炸主链路"，但 try/catch 只能挡「失败」，挡不住「挂起」——
   * embedding 模型首次下载、向量库不可达又无限重试时，检索会无限期阻塞，把整条 SSE 主链拖死。
   * 因此 SearchService 会给整个检索套一层硬超时：超时即降级为空上下文。默认 8000ms。
   */
  timeoutMs?: number;
}

export interface ToolsConfig {
  enableWebSearch: boolean;
  enableCodeInterpreter: boolean;
}

export interface FeaturesConfig {
  streaming: boolean;
  memory: boolean;
  memoryWindowSize: number;
}

export interface LangChainConfig {
  llm: LlmConfig;
  retrieval: RetrievalConfig;
  tools: ToolsConfig;
  features: FeaturesConfig;
}

// ============================================================
// 环境变量读取（密钥/服务地址）
// ============================================================

export interface ApiKeys {
  openaiApiKey: string;
  openaiBaseUrl: string;
  embeddingApiKey: string;
  vectorDbUrl: string;
  vectorDbApiKey: string;
}

let envLoaded = false;
function ensureEnvLoaded() {
  if (envLoaded) return;
  const __dirname = dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: resolve(__dirname, '../../.env') });
  envLoaded = true;
}

/** 从 process.env 读取所有密钥和服务地址 */
export function getApiKeys(): ApiKeys {
  ensureEnvLoaded();
  return {
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    embeddingApiKey: process.env.EMBEDDING_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
    vectorDbUrl: process.env.VECTOR_DB_URL ?? '',
    vectorDbApiKey: process.env.VECTOR_DB_API_KEY ?? '',
  };
}

// ============================================================
// YAML 配置加载（单例缓存）
// ============================================================

let cachedConfig: LangChainConfig | null = null;

/** 加载 config/langchain.yaml 并缓存 */
export function loadLangChainConfig(): LangChainConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  // 定位到 services/chat/config/langchain.yaml
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const configPath = resolve(__dirname, '../../config/langchain.yaml');

  const fileContent = readFileSync(configPath, 'utf-8');
  const parsed = yaml.load(fileContent) as LangChainConfig;

  cachedConfig = parsed;
  return cachedConfig;
}
