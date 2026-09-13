import type { ModelConfig, SessionItem } from "./types";

const MODELS_STORAGE_KEY = "autix_model_configs";
const SESSIONS_STORAGE_KEY = "autix_sessions_list";
const ACTIVE_SESSION_KEY = "autix_active_session_id";

export const INITIAL_MODELS: ModelConfig[] = [
  {
    id: "model-qwen3-7-flash",
    name: "qwen3.7-flash",
    provider: "dashscope",
    modelName: "qwen3.7-flash",
    type: "general",
    priority: 0,
    visibility: "private",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "",
    temperature: 0,
    maxTokens: 2048,
    isDefault: true,
    capabilities: ["text", "code", "reasoning"],
  },
  {
    id: "model-qwen-plus",
    name: "qwen-plus",
    provider: "dashscope",
    modelName: "qwen-plus",
    type: "general",
    priority: 1,
    visibility: "private",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "",
    temperature: 0.7,
    maxTokens: 4096,
    isDefault: false,
    capabilities: ["text", "code", "reasoning"],
  },
];

export function getStoredModels(): ModelConfig[] {
  if (typeof window === "undefined") return INITIAL_MODELS;
  try {
    const raw = localStorage.getItem(MODELS_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(MODELS_STORAGE_KEY, JSON.stringify(INITIAL_MODELS));
      return INITIAL_MODELS;
    }
    const parsed = JSON.parse(raw) as ModelConfig[];
    // 若本地缓存中还是旧的 gpt-5.4 占位，平滑自动升级为真实对齐的阿里百炼配置
    if (Array.isArray(parsed) && parsed.some((m) => m.modelName === "gpt-5.4")) {
      localStorage.setItem(MODELS_STORAGE_KEY, JSON.stringify(INITIAL_MODELS));
      return INITIAL_MODELS;
    }
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : INITIAL_MODELS;
  } catch {
    return INITIAL_MODELS;
  }
}

export function saveStoredModels(models: ModelConfig[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(MODELS_STORAGE_KEY, JSON.stringify(models));
  } catch (err) {
    console.error("Failed to save models to localStorage:", err);
  }
}

export function getStoredSessions(): SessionItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SessionItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStoredSessions(sessions: SessionItem[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
  } catch (err) {
    console.error("Failed to save sessions to localStorage:", err);
  }
}

export function getActiveSessionId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_SESSION_KEY);
}

export function setActiveSessionId(sessionId: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
}
