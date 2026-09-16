export class ChatConversationDto {
  message!: string;

  /** 选中的模型配置 ID（来自 /api/models/available）；缺省时用 YAML 默认模型 */
  modelId?: string;
}
