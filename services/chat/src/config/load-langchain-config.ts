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
