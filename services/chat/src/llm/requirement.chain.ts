import { StringOutputParser } from '@langchain/core/output_parsers';
import { createChatModel } from './model.factory.js';
import { requirementPrompt } from './requirement.prompt-builder.js';

/**
 * 基础 ChatModel 实例
 */
const model = createChatModel();

/**
 * 需求分析最小调用链 (LCEL)
 * 严格按照 requirementPrompt.pipe(model).pipe(new StringOutputParser()) 构建
 */
export const requirementChain = requirementPrompt
  .pipe(model)
  .pipe(new StringOutputParser());

/**
 * 工厂函数：支持覆盖模型配置构建需求分析链
 * 便于流式配置、参数覆盖及单元测试打桩
 */
export function createRequirementChain(
  overrides?: Parameters<typeof createChatModel>[0],
) {
  const customModel = createChatModel(overrides);
  return requirementPrompt.pipe(customModel).pipe(new StringOutputParser());
}
