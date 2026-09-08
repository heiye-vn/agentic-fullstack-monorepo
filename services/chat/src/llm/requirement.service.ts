import { Injectable } from '@nestjs/common';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { ChatOpenAI } from '@langchain/openai';
import {
  REQUIREMENT_SYSTEM_PROMPT,
  REQUIREMENT_USER_TEMPLATE,
} from './prompts/requirement.prompt.js';
import { createChatModel } from './model.factory.js';
import {
  RequirementResultSchema,
  type RequirementResult,
} from '@autix/contracts';

@Injectable()
export class RequirementService {
  /**
   * 复用 prompts/requirement.prompt.js 中的常量
   * 用 ChatPromptTemplate.fromMessages() 构建提示模板
   */
  readonly prompt = ChatPromptTemplate.fromMessages([
    ['system', REQUIREMENT_SYSTEM_PROMPT],
    ['human', REQUIREMENT_USER_TEMPLATE],
  ]);

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
    const messages = await this.prompt.formatMessages({ input });
    const model = customModel ?? createChatModel({ streaming: false });
    const structuredModel = model.withStructuredOutput(RequirementResultSchema);
    const result = await structuredModel.invoke(messages);
    return result as RequirementResult;
  }
}
