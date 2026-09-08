import { z } from 'zod';

export { z };

export const APP_NAME = 'llm';

/**
 * 需求分析结构化定义 Schema
 */
export const RequirementSchema = z.object({
  /** 唯一核心动作（动词+对象） */
  action: z.string().describe('唯一核心动作（动词+对象）'),
  /** 明确约束条件列表（必须 / 至少 / 不得 / 不能），无约束时返回空数组 */
  constraints: z
    .array(z.string())
    .describe('明确约束条件列表（必须 / 至少 / 不得 / 不能），无约束时返回空数组'),
  /** 文本中真实出现的实体名词列表，无实体时返回空数组 */
  entities: z
    .array(z.string())
    .describe('文本中真实出现的名词实体列表，无实体时返回空数组'),
});

/**
 * 需求提取结构化结果 Schema
 */
export const RequirementResultSchema = RequirementSchema;

/**
 * 需求分析结构类型
 */
export type Requirement = z.infer<typeof RequirementSchema>;

/**
 * 需求分析结构化提取结果类型
 */
export type RequirementResult = z.infer<typeof RequirementResultSchema>;
