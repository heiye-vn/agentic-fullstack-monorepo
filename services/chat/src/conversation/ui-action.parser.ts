import { Injectable, BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/**
 * 前端回传的 UI 操作契约
 *
 * 注意：这里的字段名来自 autix-demo chat-web 的 `types/ai-ui.ts`，
 * 与本项目 `llm/ui-protocol/ui-types.ts` 里的 UIAction（componentType/actionKey/payload）
 * **不是同一套** —— 后者是 `/api/ui-chat` 自有协议。
 * 前端 AIUIRenderer 走的是 autix 那套，所以这里按前端契约定义，
 * 再在 chat-stream.service 里转换成 UIFlowService 需要的形状。
 */
export interface ChatUIAction {
  componentId: string;
  action: string;
  data: Record<string, unknown>;
  timestamp?: string;
}

export const chatUIActionSchema = z.object({
  componentId: z.string().min(1, 'componentId 不能为空'),
  action: z.string().min(1, 'action 不能为空'),
  // zod v4：record 必须显式给 key 类型和 value 类型
  data: z.record(z.string(), z.unknown()).default({}),
  timestamp: z.string().optional(),
});

/** 会话流转阶段（与前端 AIUIRenderer 的 stage 语义一致） */
export type UIStage =
  | 'select_type'
  | 'fill_detail'
  | 'confirm'
  | 'result';

/** 上一条 AI 消息里保存的 UI 响应快照 */
export interface LastUIResponse {
  messages?: unknown[];
  thinking?: string | null;
}

export interface UIContext {
  uiStage?: UIStage;
  lastUIResponse?: LastUIResponse;
  userAction: ChatUIAction;
  /** 本次操作后累计收集到的结构化数据（跨阶段累加） */
  collectedData: Record<string, unknown>;
  analysisResult?: string;
  riskResult?: string;
}

@Injectable()
export class UIActionParser {
  /**
   * 检测并解析 UI 操作，构建 UIContext
   *
   * @param body 请求 body（可能是字符串，也可能是 UIAction 对象）
   * @param lastMessageMetadata 上一条 ASSISTANT 消息的 metadata
   * @returns 非 UIAction 时返回 null
   */
  parse(
    body: unknown,
    lastMessageMetadata?: Record<string, unknown>,
  ): UIContext | null {
    if (!this.isUIAction(body)) {
      return null;
    }

    const parseResult = chatUIActionSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException(
        `Invalid UIAction format: ${parseResult.error.message}`,
      );
    }

    const userAction = parseResult.data as ChatUIAction;

    // 从上一条消息 metadata 读取上一轮的 UI 状态，保证多阶段流程能续上
    const uiStage = lastMessageMetadata?.uiStage as UIStage | undefined;
    const lastUIResponse = lastMessageMetadata?.uiResponse as
      | LastUIResponse
      | undefined;
    const previousCollectedData =
      (lastMessageMetadata?.collectedData as Record<string, unknown>) ?? {};

    return {
      uiStage,
      lastUIResponse,
      userAction,
      collectedData: { ...previousCollectedData, ...userAction.data },
      analysisResult: lastMessageMetadata?.analysisResult as string | undefined,
      riskResult: lastMessageMetadata?.riskResult as string | undefined,
    };
  }

  /**
   * 把 UI 操作转成给模型看的自然语言描述，
   * 这样即使走普通对话链路，历史里也留下人能读懂的记录
   */
  formatAsText(action: ChatUIAction): string {
    const { action: type, data } = action;

    if (data.selectedType) {
      const typeLabels: Record<string, string> = {
        new_feature: '新功能需求',
        bug_fix: '缺陷修复',
        optimization: '性能优化',
        refactoring: '代码重构',
      };
      const value = String(data.selectedType);
      return `选择需求类型：${typeLabels[value] ?? value}`;
    }

    if (data.requirementTitle || data.targetUsers) {
      const parts: string[] = [];
      if (data.requirementTitle) parts.push(`需求标题：${data.requirementTitle}`);
      if (data.targetUsers) parts.push(`目标用户：${data.targetUsers}`);
      if (data.businessGoal) parts.push(`业务目标：${data.businessGoal}`);
      if (data.functionalDescription)
        parts.push(`功能描述：${data.functionalDescription}`);
      return parts.join('\n');
    }

    if (type === 'cancel') return '取消操作';
    if (type === 'submit') return '确认提交';

    return `执行操作：${type}`;
  }

  private isUIAction(body: unknown): boolean {
    if (!body || typeof body !== 'object') return false;
    const obj = body as Record<string, unknown>;
    // UIAction 的判别字段：componentId + action
    return (
      typeof obj.componentId === 'string' && typeof obj.action === 'string'
    );
  }
}
