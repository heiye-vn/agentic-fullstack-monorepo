import { ModelType } from '../../prisma/index.js';

/** 更新时所有字段均为可选（只更新显式传入的字段） */
export class UpdateModelConfigDto {
  name?: string;
  provider?: string;
  model?: string;
  type?: ModelType;
  priority?: number;
  baseUrl?: string;
  apiKey?: string;
  metadata?: Record<string, unknown>;
  isActive?: boolean;
  isDefault?: boolean;

  // capabilities：模型的感知能力标签数组
  capabilities?: string[];
}
