import { Injectable, Logger } from '@nestjs/common';
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
  type AIMessage,
} from '@langchain/core/messages';
import { createChatModel } from '../model.factory.js';
import { businessTools, businessToolsByName } from '../tools/business.tools.js';

/**
 * 需求分析助手系统提示词
 * 指导模型按需调用 query_requirement、read_file、write_file 工具，完成需求分析全生命周期闭环
 */
export const FILESYSTEM_SYSTEM_PROMPT = `
你是一名资深需求分析专家与系统架构师（需求分析助手）。
你的职责是帮助用户查询需求单、比对规范标准、进行架构与完整性评估，并按要求输出标准化、确定性的分析报告。

你拥有以下三个核心业务工具：
1. query_requirement: 根据需求单号（如 REQ-2026-001）查询需求详情，获取标题、业务目标、核心功能与约束条件等；
2. read_file: 读取 workspace 目录下的指定文件内容（如 standards/requirement-spec.md 标准文档）；
3. write_file: 将内容写入 workspace 目录下的指定文件（如 reports/REQ-2026-001-analysis.md 分析报告）。

执行规范与注意事项：
- 路径参数均为相对于 workspace 目录的相对路径，严禁携带 "workspace/" 前缀（例如：使用 "standards/requirement-spec.md" 而非 "workspace/standards/requirement-spec.md"）；
- 当用户要求查询需求单详情时，主动调用 query_requirement；
- 当需要对照评审规范或标准时，主动调用 read_file 读取对应文档；
- 当需要将分析结论、判断报告保存或写入文件（调用 write_file）时，生成的 Markdown 文本必须严格遵守以下【标准报告章节骨架】，严禁自由删减核心章节或打乱层级结构：

  # 需求分析与评审报告：[需求单号]
  
  ## 一、 需求基本信息
  - 以列表展示需求单号、标题、提出方、优先级、目标用户群体。
  
  ## 二、 需求要素完整性评估
  - 必须采用 Markdown 表格展示，固定列为：| 检查项 | 标准规范要求 | 当前需求内容 | 评审结果（通过 / 待完善 / 缺失） | 审查说明 |
  - 必须逐项覆盖：需求单号、业务目标、目标用户群体、核心功能范围、约束条件、优先级六大要素；
  - 给出量化的完整性评分（满分 100 分）。
  
  ## 三、 技术架构合理性评估
  - 针对以下三个子维度进行深入架构分析：
    - 3.1 上下文窗口与存储策略（分析 Token 阈值与自动裁剪算法）
    - 3.2 会话与数据隔离机制（分析会话隔离与多租户防串话）
    - 3.3 容错回退与异常边界策略（分析网络超时、存储宕机与降级处理）
  
  ## 四、 问题清单与整改建议
  - 必须采用表格汇总发现的所有缺陷：| 序号 | 严重级别（高/中/低） | 存在问题 | 具体整改建议 |
  
  ## 五、 综合裁定与最终结论
  - 汇总评估表格：| 评估维度 | 结果 |
  - 最终裁定：明确输出【通过】/【有条件通过（建议补充后归档）】/【驳回重填】，并附带一句话总结判断。

- 每次工具调用完毕后，结合工具返回的内容深入推导。所有必要工具调用执行完毕后，给出详尽、结构清晰的最终总结。
`.trim();

export interface ToolCallItem {
  id?: string;
  name: string;
  args: Record<string, any>;
}

export interface ToolLoopStep {
  iteration: number;
  toolCall: ToolCallItem;
  toolOutput: string;
}

export interface FilesystemChatResult {
  input: string;
  finalContent: string;
  iterations: number;
  steps: ToolLoopStep[];
  model: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

@Injectable()
export class FilesystemService {
  private readonly logger = new Logger(FilesystemService.name);

  /**
   * 需求分析助手工具闭环对话 (Tool Loop)
   * 自动调度并执行模型生成的 tool_calls，回传 ToolMessage，直至模型得出最终分析结论
   *
   * @param userInput 用户输入文本
   * @param maxIterations 最大迭代次数（默认 5 次，防止死循环）
   * @param customModel 可选自定义模型实例（便于单测 Mock）
   */
  async chat(
    userInput: string,
    maxIterations = 5,
    customModel?: any,
  ): Promise<FilesystemChatResult> {
    const input = userInput?.trim() ?? '';
    if (!input) {
      return {
        input: '',
        finalContent: '请输入有效的需求分析指令或问题。',
        iterations: 0,
        steps: [],
        model: 'none',
      };
    }

    const model = customModel ?? createChatModel({ streaming: false });
    const modelWithTools = model.bindTools
      ? model.bindTools(businessTools)
      : model;

    const messages: BaseMessage[] = [
      new SystemMessage(FILESYSTEM_SYSTEM_PROMPT),
      new HumanMessage(input),
    ];

    const steps: ToolLoopStep[] = [];
    let iterations = 0;
    let latestResponse: AIMessage | null = null;

    while (iterations < maxIterations) {
      iterations++;
      this.logger.log(`[FilesystemService] 执行第 ${iterations} 轮模型交互...`);

      const response = (await modelWithTools.invoke(messages)) as AIMessage;
      latestResponse = response;
      messages.push(response);

      const rawToolCalls = response.tool_calls ?? [];
      // 若当前轮次模型未生成 tool_calls，说明模型已总结完毕，直接跳出循环
      if (rawToolCalls.length === 0) {
        this.logger.log(
          `[FilesystemService] 第 ${iterations} 轮未生成工具调用，模型思考结束`,
        );
        break;
      }

      this.logger.log(
        `[FilesystemService] 第 ${iterations} 轮捕获到 ${rawToolCalls.length} 个工具调用: ${rawToolCalls.map((t) => t.name).join(', ')}`,
      );

      // 执行当前轮次的所有工具调用
      for (const tc of rawToolCalls) {
        const toolCallItem: ToolCallItem = {
          id: tc.id,
          name: tc.name,
          args: tc.args ?? {},
        };

        const targetTool = businessToolsByName[tc.name];
        let toolOutputStr = '';

        if (targetTool) {
          try {
            const rawOutput = await targetTool.invoke(tc.args);
            toolOutputStr =
              typeof rawOutput === 'string'
                ? rawOutput
                : JSON.stringify(rawOutput);
          } catch (err) {
            toolOutputStr = JSON.stringify({
              success: false,
              error: `工具执行异常: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        } else {
          toolOutputStr = JSON.stringify({
            success: false,
            error: `未识别的工具【${tc.name}】。可用工具: ${Object.keys(businessToolsByName).join(', ')}`,
          });
        }

        steps.push({
          iteration: iterations,
          toolCall: toolCallItem,
          toolOutput: toolOutputStr,
        });

        // 将工具执行结果作为 ToolMessage 回传至对话上下文中
        messages.push(
          new ToolMessage({
            tool_call_id: tc.id ?? `call_${Date.now()}_${Math.random()}`,
            content: toolOutputStr,
            name: tc.name,
          }),
        );
      }
    }

    const finalContent = latestResponse
      ? typeof latestResponse.content === 'string'
        ? latestResponse.content
        : JSON.stringify(latestResponse.content)
      : '';

    return {
      input,
      finalContent,
      iterations,
      steps,
      model: String(
        latestResponse?.response_metadata?.model_name ??
          latestResponse?.response_metadata?.model ??
          model.model ??
          'unknown',
      ),
      usage: {
        inputTokens: latestResponse?.usage_metadata?.input_tokens,
        outputTokens: latestResponse?.usage_metadata?.output_tokens,
        totalTokens: latestResponse?.usage_metadata?.total_tokens,
      },
    };
  }
}
