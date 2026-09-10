import { Injectable, Logger } from '@nestjs/common';
import { RunnableMemoryService } from './memory/runnable-memory.service.js';
import {
  OrchestratorService,
  type OrchestrationResult,
} from './agents/orchestrator.service.js';
import { writeFileTool } from './tools/business.tools.js';

/**
 * 统一分析结果接口定义
 */
export interface AdvancedAnalysisResult {
  /** 分析状态：completed (成功完成) | clarification_needed (需要澄清) | failed (失败) */
  status: 'completed' | 'clarification_needed' | 'failed';
  /** 会话标识符 */
  sessionId: string;
  /** 是否需要澄清 */
  needsClarification: boolean;
  /** 澄清问题列表 */
  clarificationQuestions: string[];
  /** 完整分析报告（Markdown 文本，仅 completed 时非空） */
  report: string;
  /** 生成的报告相对文件路径（如 reports/REQ-2026-001-analysis.md） */
  reportPath?: string;
  /** 原始编排详细结果（包含 steps 与 fallback 等元数据） */
  rawOrchestration?: OrchestrationResult;
}

@Injectable()
export class AdvancedAnalysisService {
  private readonly logger = new Logger(AdvancedAnalysisService.name);

  constructor(
    private readonly memoryService: RunnableMemoryService,
    private readonly orchestratorService: OrchestratorService,
  ) {}

  /**
   * 统一执行多轮上下文融合的需求分析任务
   * 1. 抽取当前 sessionId 累积的历史对话并融合为完整上下文
   * 2. 调用 OrchestratorService 执行固定编排多 Agent 分析
   * 3. 若需澄清直接中断返回澄清问题列表
   * 4. 否则将分析报告持久化写入 reports/ 目录
   * 5. 调用 appendMessage() 将最终报告写回会话记忆（不重新调用模型）
   * 6. 返回完整分析报告
   *
   * @param sessionId 会话唯一标识符
   * @param input 用户本轮指令或需求描述
   */
  async analyze(
    sessionId: string,
    input: string,
  ): Promise<AdvancedAnalysisResult> {
    const trimmedInput = input?.trim() ?? '';
    this.logger.log(
      `[AdvancedAnalysisService] 开始执行需求分析，sessionId: ${sessionId}, input: ${trimmedInput}`,
    );

    // 1. 获取该会话累积的历史记录并结合当前 input 组装多轮上下文
    const history = await this.memoryService.getHistory(sessionId);
    let combinedInput = trimmedInput;

    if (history && history.length > 0) {
      const historyContext = history
        .map(
          (msg) =>
            `${msg.role === 'human' || msg.role === 'user' ? '用户' : '助手'}: ${msg.content}`,
        )
        .join('\n');

      combinedInput = `【历史对话上下文】\n${historyContext}\n\n【本轮用户请求】\n${trimmedInput}`;
      this.logger.log(
        `[AdvancedAnalysisService] 成功提取历史记录 ${history.length} 条并注入编排上下文`,
      );
    }

    // 2. 调用 OrchestratorService 执行多 Agent 分析
    const orchestration =
      await this.orchestratorService.orchestrate(combinedInput);

    // 3. 判断是否需要澄清中断
    if (
      orchestration.status === 'clarification_needed' &&
      orchestration.clarificationQuestions &&
      orchestration.clarificationQuestions.length > 0
    ) {
      this.logger.warn(
        `[AdvancedAnalysisService] 需求不完整触发澄清中断，澄清问题数: ${orchestration.clarificationQuestions.length}`,
      );

      return {
        status: 'clarification_needed',
        sessionId,
        needsClarification: true,
        clarificationQuestions: orchestration.clarificationQuestions,
        report: '',
        rawOrchestration: orchestration,
      };
    }

    // 如果多 Agent 编排本身失败
    if (orchestration.status === 'failed') {
      this.logger.error('[AdvancedAnalysisService] 多 Agent 编排执行失败');
      return {
        status: 'failed',
        sessionId,
        needsClarification: false,
        clarificationQuestions: [],
        report: '',
        rawOrchestration: orchestration,
      };
    }

    const reportContent = orchestration.report ?? '';

    // 4. 将分析报告写入 reports/ 目录
    // 优先提取需求单号作为报告文件名，否则使用 sessionId
    const reqIdMatch = combinedInput.match(/REQ-\d{4}-\d+/i);
    const sanitizedSessionId = sessionId.replace(/[^\w-]/g, '_');
    const reportFileName = reqIdMatch
      ? `${reqIdMatch[0].toUpperCase()}-analysis.md`
      : `analysis-${sanitizedSessionId}.md`;
    const relativeReportPath = `reports/${reportFileName}`;

    try {
      await writeFileTool.invoke({
        filePath: relativeReportPath,
        content: reportContent,
      });
      this.logger.log(
        `[AdvancedAnalysisService] 需求分析报告已成功持久化写入 ${relativeReportPath}`,
      );
    } catch (err: any) {
      this.logger.error(
        `[AdvancedAnalysisService] 持久化报告文件失败: ${err?.message || err}`,
      );
    }

    // 5. 用 appendMessage() 写回最终结论（不重新调用模型）
    await this.memoryService.appendMessage(
      sessionId,
      trimmedInput,
      reportContent,
    );
    this.logger.log(
      `[AdvancedAnalysisService] 已通过 appendMessage 写回会话记忆: ${sessionId}`,
    );

    // 6. 返回完整分析报告
    return {
      status: 'completed',
      sessionId,
      needsClarification: false,
      clarificationQuestions: [],
      report: reportContent,
      reportPath: relativeReportPath,
      rawOrchestration: orchestration,
    };
  }
}
