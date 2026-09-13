export type ModelCapability =
  | "text"
  | "vision"
  | "voice"
  | "speech"
  | "code"
  | "reasoning"
  | "image"
  | "embedding";

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  modelName: string;
  type: string;
  priority: number;
  visibility: "private" | "public";
  baseUrl: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
  isDefault: boolean;
  capabilities: ModelCapability[];
}

export interface SessionItem {
  id: string;
  title: string;
  modelId: string;
  createdAt: number;
  updatedAt: number;
}

export type ActiveView = "chat" | "model-config" | "knowledge";
