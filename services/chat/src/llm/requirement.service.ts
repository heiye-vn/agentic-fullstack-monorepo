import { Injectable } from '@nestjs/common';
import type { ChatOpenAI } from '@langchain/openai';
import { createChatModel } from './model.factory.js';
import { createRequirementPromptTemplate } from './requirement.prompt-builder.js';
import {
  RequirementResultSchema,
  type RequirementResult,
} from '@autix/contracts';

@Injectable()
export class RequirementService {
  /**
   * 需求抽取提示词模板（统一复用 requirement.prompt-builder 构建器）
   */
  readonly prompt = createRequirementPromptTemplate();

  /**
   * 需求结构化抽取方法
   * 1. 用 prompt.formatMessages({ input }) 格式化提示消息
   * 2. 用 model.withStructuredOutput(RequirementResultSchema) 绑定结构化模式
   * 3. 调用并返回结构化结果
   *
   * @param input 用户输入需求文本
   * @param customModel 可选传入自定义模型实例，支持单元测试与参数覆盖
   */
  async extract(
    input: string,
    customModel?: ChatOpenAI,
  ): Promise<RequirementResult> {
    const sanitizedInput = input?.trim() ?? '';
    const messages = await this.prompt.formatMessages({ input: sanitizedInput });
    const model = customModel ?? createChatModel({ streaming: false });
    const structuredModel = model.withStructuredOutput(RequirementResultSchema);
    const result = await structuredModel.invoke(messages);
    return result as RequirementResult;
  }
}
