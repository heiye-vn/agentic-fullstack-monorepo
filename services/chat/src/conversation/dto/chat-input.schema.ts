/**
 * src/conversation/dto/chat-input.schema.ts
 *
 * 对话入口的输入契约（第十八章 18.17）
 *
 * 现状：`ChatConversationDto` 是纯类、无装饰器，而本项目既没有
 * class-validator 也没有全局 ValidationPipe —— 所以 `@Body()` 拿到的东西
 * 完全未经校验。Agent 系统的输入面比普通 CRUD 更值得收紧，因为输入会被
 * 拼进 prompt、按 token 计费、还可能被用作注入载体。
 *
 * 这里用 zod 定义"什么算合法输入"，配合 ZodValidationPipe 挂在入口上：
 *   - message：必填、非空、有长度上限（防超长输入打爆 token 预算）
 *   - modelId：可选，有长度上限
 *
 * 用 `.passthrough()` 保留未声明字段：前端可能随请求附带额外参数，
 * 校验管道不该悄悄把它们吃掉——那只做"校验该校验的"，不做字段裁剪。
 */
import { z } from 'zod';

/**
 * 单条消息的最大字符数。
 *
 * 定 8000 的依据：需求分析场景里，用户可能整段粘贴 PRD，8000 字足够宽松；
 * 同时它把"恶意构造 100 万字输入"这种 Denial of Wallet 手法挡在门外。
 * 超限返回 400 而不是照单全收。
 */
export const MAX_MESSAGE_LENGTH = 8000;

/** 模型配置 ID 的最大长度（Prisma cuid 远小于此，留足余量即可） */
export const MAX_MODEL_ID_LENGTH = 100;

/** 会话标题最大长度 */
export const MAX_TITLE_LENGTH = 200;

export const ChatMessageSchema = z
  .object({
    message: z.string().min(1).max(MAX_MESSAGE_LENGTH),
    modelId: z.string().max(MAX_MODEL_ID_LENGTH).optional(),
  })
  .passthrough();

export const CreateConversationSchema = z
  .object({
    title: z.string().max(MAX_TITLE_LENGTH).optional(),
  })
  .passthrough();

export type ChatMessageInput = z.infer<typeof ChatMessageSchema>;
export type CreateConversationInput = z.infer<typeof CreateConversationSchema>;
