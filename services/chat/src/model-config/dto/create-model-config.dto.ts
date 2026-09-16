import { ModelType, ModelVisibility } from '../../prisma/index.js';

/**
 * 创建模型配置入参
 *
 * 说明：本项目 chat 服务不引入 class-validator（与 CreateConversationDto 等既有 DTO 保持一致），
 * 校验依赖各字段的可选性约定 + Prisma 的类型约束，多余字段不会进入 Prisma 写入。
 */
export class CreateModelConfigDto {
  name!: string;
  provider?: string;
  model!: string;
  type?: ModelType;
  priority?: number;
  baseUrl?: string;
  apiKey?: string;
  metadata?: Record<string, unknown>;
  isActive?: boolean;
  isDefault?: boolean;
  visibility?: ModelVisibility;

  // capabilities：模型的感知能力标签数组，支持多标签。
  // 推荐值：text | vision | voice | speech | code | reasoning | image | embedding
  // 例如：["text"] / ["text", "vision"] / ["voice", "speech"]
  capabilities?: string[];
}
