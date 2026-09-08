import { ChatPromptTemplate } from '@langchain/core/prompts';
import {
  REQUIREMENT_SYSTEM_PROMPT,
  REQUIREMENT_USER_TEMPLATE,
} from './prompts/requirement.prompt.js';

/**
 * 需求分析提示模板构建器
 * 使用 ChatPromptTemplate.fromMessages 组装 system + human 消息
 */
export function createRequirementPromptTemplate(): ChatPromptTemplate {
  return ChatPromptTemplate.fromMessages([
    ['system', REQUIREMENT_SYSTEM_PROMPT],
    ['human', REQUIREMENT_USER_TEMPLATE],
  ]);
}

/** 需求提示模板单例实例 */
export const requirementPromptTemplate = createRequirementPromptTemplate();

/** requirementPrompt 别名导出，便于 LCEL 调用链直接引用 */
export const requirementPrompt = requirementPromptTemplate;
